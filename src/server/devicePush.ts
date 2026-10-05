/**
 * Device push: FCM for Android, APNs for iOS.
 *
 * The server never sees the planner — only an opaque device token, the same
 * schedule the browser path uploads, and a generic sentence to deliver. The
 * message carries no task, event, or habit text, exactly like the Web Push
 * path, so a notification that lands on a lock screen says nothing a bystander
 * could not already guess.
 *
 * Credentials are optional and per platform:
 *
 *   Android  FCM_SERVICE_ACCOUNT   the service-account JSON, verbatim
 *   iOS      APNS_KEY_ID           the 10-character key id (.p8 key, APNs auth key)
 *            APNS_TEAM_ID          the Apple Developer team id
 *            APNS_KEY_P8           the .p8 file's contents (\n accepted)
 *            APNS_BUNDLE_ID        com.notmtn.planner
 *
 * `sendDevicePush` reports three outcomes rather than throwing, because each
 * one means something different to the dispatcher: sent (delete the job),
 * gone (the app was uninstalled — delete the device), skipped (this server has
 * no credentials for that platform, and the job should not pile up forever).
 */
import { createHash, createPrivateKey, createSign, type KeyObject } from 'node:crypto';
import http2 from 'node:http2';

export interface DevicePushEnv {
  FCM_SERVICE_ACCOUNT?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_KEY_P8?: string;
  APNS_BUNDLE_ID?: string;
}

export type DevicePlatform = 'android' | 'ios';

export interface DeviceAlert {
  title: string;
  body: string;
  url: string;
}

export interface DeviceSendResult {
  ok: boolean;
  /** The token is no longer registered with the platform. */
  gone: boolean;
  /** This server has no credentials for that platform, so nothing was sent. */
  skipped: boolean;
  status?: number;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const APNS_ORIGIN = 'https://api.push.apple.com';
const REQUEST_TIMEOUT_MS = 10_000;

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Header and payload, signed. `dsaEncoding` keeps an ES256 signature in JOSE's r||s form. */
export function signedJwt(header: Record<string, unknown>, claims: Record<string, unknown>, key: KeyObject, algorithm: 'RS256' | 'ES256'): string {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  // `dsaEncoding: 'ieee-p1363'` keeps an ES256 signature in JOSE's r||s form;
  // RS256 ignores it. Passing the key object (not a PEM string) means the
  // caller has already validated that the credential parses as a private key.
  const signature = signer.sign(key.type === 'private' && algorithm === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key);
  return `${signingInput}.${base64url(signature)}`;
}

interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  projectId: string;
}

function serviceAccount(env: DevicePushEnv): ServiceAccount | null {
  const raw = env.FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string; project_id?: string };
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    return { clientEmail: parsed.client_email, privateKey: parsed.private_key.replace(/\\n/g, '\n'), projectId: parsed.project_id };
  } catch {
    return null;
  }
}

function apnsKey(env: DevicePushEnv): KeyObject | null {
  const raw = env.APNS_KEY_P8?.trim();
  if (!raw || !env.APNS_KEY_ID?.trim() || !env.APNS_TEAM_ID?.trim() || !env.APNS_BUNDLE_ID?.trim()) return null;
  try {
    return createPrivateKey({ key: raw.replace(/\\n/g, '\n'), format: 'pem' });
  } catch {
    return null;
  }
}

/** True when this server could deliver to that platform at all. */
export function devicePushConfigured(platform: DevicePlatform, env: DevicePushEnv): boolean {
  return platform === 'android' ? serviceAccount(env) !== null : apnsKey(env) !== null;
}

export function devicePushReady(env: DevicePushEnv): boolean {
  return devicePushConfigured('android', env) || devicePushConfigured('ios', env);
}

/** The FCM (HTTP v1) message body. Content-free by construction. */
export function fcmMessage(token: string, alert: DeviceAlert): Record<string, unknown> {
  return {
    message: {
      token,
      notification: { title: alert.title, body: alert.body },
      data: { url: alert.url },
      android: { priority: 'HIGH', notification: { channel_id: 'planner-reminders' } },
    },
  };
}

/** The APNs payload. `url` travels beside `aps`, where the app reads it. */
export function apnsPayload(alert: DeviceAlert): Record<string, unknown> {
  return { aps: { alert: { title: alert.title, body: alert.body }, sound: 'default' }, url: alert.url };
}

export function fcmAssertion(service: ServiceAccount, now = Date.now()): string {
  const issued = Math.floor(now / 1000);
  return signedJwt({ alg: 'RS256', typ: 'JWT' }, {
    iss: service.clientEmail,
    scope: FCM_SCOPE,
    aud: TOKEN_URL,
    iat: issued,
    exp: issued + 3600,
  }, createPrivateKey({ key: service.privateKey, format: 'pem' }), 'RS256');
}

export function apnsAssertion(env: DevicePushEnv & { APNS_KEY_ID: string; APNS_TEAM_ID: string }, now = Date.now()): string {
  const issued = Math.floor(now / 1000);
  return signedJwt({ alg: 'ES256', kid: env.APNS_KEY_ID }, {
    iss: env.APNS_TEAM_ID,
    iat: issued,
    aud: 'https://api.push.apple.com',
  }, apnsKey(env) as KeyObject, 'ES256');
}

const accessTokens = new Map<string, { token: string; expiresAt: number }>();

/** Exchanges the service account for an OAuth token, cached until shortly before it expires. */
async function fcmAccessToken(service: ServiceAccount, now = Date.now()): Promise<string> {
  const cached = accessTokens.get(service.clientEmail);
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: fcmAssertion(service, now) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
  if (!response.ok || !body.access_token) throw new Error(`FCM token exchange failed (${response.status}).`);
  accessTokens.set(service.clientEmail, { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

async function sendFcm(service: ServiceAccount, token: string, alert: DeviceAlert): Promise<{ ok: boolean; gone: boolean; status: number }> {
  const accessToken = await fcmAccessToken(service);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(service.projectId)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fcmMessage(token, alert)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // 404 UNREGISTERED is a token that no longer exists; 400 with
  // INVALID_ARGUMENT is what FCM answers for a malformed or stale token.
  const gone = response.status === 404 || response.status === 400;
  return { ok: response.ok, gone, status: response.status };
}

async function sendApns(env: DevicePushEnv & { APNS_KEY_ID: string; APNS_TEAM_ID: string; APNS_BUNDLE_ID: string }, token: string, alert: DeviceAlert): Promise<{ ok: boolean; gone: boolean; status: number }> {
  const client = http2.connect(APNS_ORIGIN);
  try {
    return await new Promise((resolve, reject) => {
      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${encodeURIComponent(token)}`,
        authorization: `bearer ${apnsAssertion({ ...env, APNS_KEY_ID: env.APNS_KEY_ID, APNS_TEAM_ID: env.APNS_TEAM_ID }, Date.now())}`,
        'apns-topic': env.APNS_BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
      let status = 0;
      const timer = setTimeout(() => {
        request.close();
        reject(new Error('APNs request timed out.'));
      }, REQUEST_TIMEOUT_MS);
      request.on('response', (headers) => {
        status = Number(headers[':status'] ?? 0);
      });
      request.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      request.on('end', () => {
        clearTimeout(timer);
        // 410 means the device token is stale; 400 with BadDeviceToken is what
        // a token from another environment (sandbox vs production) looks like.
        resolve({ ok: status === 200, gone: status === 410 || status === 400, status });
      });
      request.end(JSON.stringify(apnsPayload(alert)));
    });
  } finally {
    client.close();
  }
}

export async function sendDevicePush(platform: DevicePlatform, token: string, alert: DeviceAlert, env: DevicePushEnv): Promise<DeviceSendResult> {
  try {
    if (platform === 'android') {
      const service = serviceAccount(env);
      if (!service) return { ok: false, gone: false, skipped: true };
      const result = await sendFcm(service, token, alert);
      return { ...result, skipped: false };
    }
    if (!apnsKey(env)) return { ok: false, gone: false, skipped: true };
    const result = await sendApns(env as DevicePushEnv & { APNS_KEY_ID: string; APNS_TEAM_ID: string; APNS_BUNDLE_ID: string }, token, alert);
    return { ...result, skipped: false };
  } catch (error) {
    // Configuring credentials wrong should not lose the job silently; the
    // dispatcher logs it and keeps the row for the next run.
    console.error(`[planner] device push failed (${platform}): ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, gone: false, skipped: false };
  }
}

/** A stable, non-reversible id for a device token — what the job tables key on. */
export function deviceId(platform: DevicePlatform, token: string): string {
  return createHash('sha256').update(`device:${platform}:${token}`).digest('hex');
}
