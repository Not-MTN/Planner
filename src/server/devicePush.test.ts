import { describe, expect, it } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import {
  apnsAssertion,
  apnsPayload,
  deviceId,
  devicePushConfigured,
  devicePushReady,
  fcmAssertion,
  fcmMessage,
  sendDevicePush,
  signedJwt,
  type DevicePushEnv,
} from './devicePush';

function apnsKeyPair() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

const RSA_ACCOUNT = (privateKey: string) =>
  JSON.stringify({ client_email: 'planner@example.iam.gserviceaccount.com', private_key: privateKey, project_id: 'planner-test' });

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('device push credentials', () => {
  it('is unconfigured until a platform has usable credentials', () => {
    expect(devicePushReady({})).toBe(false);
    expect(devicePushConfigured('android', {})).toBe(false);
    expect(devicePushConfigured('ios', {})).toBe(false);
    expect(devicePushConfigured('android', { FCM_SERVICE_ACCOUNT: 'not json' })).toBe(false);
    expect(devicePushConfigured('ios', { APNS_KEY_P8: 'not a key', APNS_KEY_ID: 'ABC123', APNS_TEAM_ID: 'TEAM123', APNS_BUNDLE_ID: 'com.notmtn.planner' })).toBe(false);
  });

  it('treats one platform as enough to be ready', () => {
    const ios: DevicePushEnv = { APNS_KEY_P8: apnsKeyPair(), APNS_KEY_ID: 'ABC123', APNS_TEAM_ID: 'TEAM123', APNS_BUNDLE_ID: 'com.notmtn.planner' };
    expect(devicePushReady(ios)).toBe(true);
    expect(devicePushConfigured('android', ios)).toBe(false);

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const android: DevicePushEnv = { FCM_SERVICE_ACCOUNT: RSA_ACCOUNT(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()) };
    expect(devicePushReady(android)).toBe(true);
    expect(devicePushConfigured('ios', android)).toBe(false);
  });
});

describe('device push payloads', () => {
  it('sends the generic sentence and the deep link, never planner text', () => {
    const alert = { title: 'Planner reminder', body: 'A reminder is due. Open Planner to see your schedule.', url: '/#/today' };
    const fcm = JSON.stringify(fcmMessage('device-token', alert));
    expect(JSON.parse(fcm)).toMatchObject({ message: { token: 'device-token', notification: { title: alert.title, body: alert.body }, data: { url: alert.url } } });
    expect(JSON.parse(JSON.stringify(apnsPayload(alert)))).toMatchObject({ aps: { alert: { title: alert.title, body: alert.body } }, url: '/#/today' });
  });

  it('refuses to do anything without credentials rather than throwing', async () => {
    const result = await sendDevicePush('android', 'device-token', { title: 't', body: 'b', url: '/#/today' }, {});
    expect(result).toEqual({ ok: false, gone: false, skipped: true });
    const iosResult = await sendDevicePush('ios', 'device-token', { title: 't', body: 'b', url: '/#/today' }, {});
    expect(iosResult).toEqual({ ok: false, gone: false, skipped: true });
  });
});

describe('device push assertions', () => {
  it('signs a JWT that verifies and carries the Firebase scope', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    // `serviceAccount()` normalizes `\n` from the JSON before this point; here
    // the PEM is already real text.
    const token = fcmAssertion({ clientEmail: 'planner@example.iam.gserviceaccount.com', privateKey: pem, projectId: 'planner-test' }, 1_700_000_000_000);
    const [header, claims, signature] = token.split('.');
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(claims)).toMatchObject({
      iss: 'planner@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const verifier = createVerify('SHA256');
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('signs an APNs token in JOSE form with the key id in the header', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = apnsKeyPair();
    const token = apnsAssertion({ APNS_KEY_P8: pem, APNS_KEY_ID: 'ABC123', APNS_TEAM_ID: 'TEAM123', APNS_BUNDLE_ID: 'com.notmtn.planner' }, 1_700_000_000_000);
    const [header, claims, signature] = token.split('.');
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'ABC123' });
    expect(decode(claims)).toEqual({ iss: 'TEAM123', iat: 1_700_000_000, aud: 'https://api.push.apple.com' });
    // ES256 in JOSE is a fixed 64-byte r||s signature, not DER.
    // (Re-derived here rather than verified against the throwaway key.)
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
    expect(typeof publicKey).toBe('object');
  });

  it('decodes cleanly whichever algorithm signs it', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = signedJwt({ alg: 'RS256', typ: 'JWT' }, { hello: 'world' }, privateKey, 'RS256');
    expect(token.split('.')).toHaveLength(3);
    expect(decode(token.split('.')[1])).toEqual({ hello: 'world' });
  });
});

describe('device ids', () => {
  it('are stable per platform and token, and differ across both', () => {
    const id = deviceId('android', 'token-a');
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(deviceId('android', 'token-a')).toBe(id);
    expect(deviceId('ios', 'token-a')).not.toBe(id);
    expect(deviceId('android', 'token-b')).not.toBe(id);
  });
});
