/**
 * Account API shared by the Vercel Functions in `api/auth/*` and the Vite
 * dev/preview middleware.
 *
 * The server stores only what it must: an identifier, one-way verifiers for
 * the client-stretched auth token and high-entropy recovery key, session
 * records, and an opaque encrypted vault. Passwords, the recovery key itself,
 * planner content and vault keys never reach it.
 */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { isSameOriginRequest } from './groqProxy.js';
import { WebAuthnError, fromBase64Url, verifyAssertion, verifyRegistration } from './webauthn.js';
import { API_SECURITY_HEADERS, BodyTooLargeError, rateLimitResponse, readLimitedBody } from './security.js';
import {
  cleanCodeHash,
  cleanDisplayName,
  cleanEmail,
  cleanLinkId,
  cleanRole,
  cleanShareCiphertext,
  cleanUsername,
  cleanWeekOf,
  cleanWrappedShare,
  isBase64,
  MAX_AUTH_BODY_BYTES,
  MAX_VAULT_BODY_BYTES,
  MAX_VAULT_BYTES,
  MAX_LINKS_PER_SIDE,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  type LinksResponse,
  type NoteResponse,
  type LoginResponse,
  type OutgoingLink,
  type PasskeyLoginResponse,
  type PasskeyOptionsResponse,
  type PublicUser,
  type SessionResponse,
  type ShareResponse,
  type VaultResponse,
} from '../shared/authContract.js';
import {
  hashAuthToken,
  hashToken,
  newId as newStoreId,
  newToken,
  parseRecoveryWraps,
  safeEqual,
  type AuthStore,
  type LinkRow,
  type UserRow,
} from './authStore.js';

export const MISSING_DB_AUTH_MESSAGE =
  'Accounts need a database. Add your Neon connection string as DATABASE_URL under Vercel → Project Settings → Environment Variables (or in .env.local) and restart.';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Only used to keep the timing of a failed lookup equal to a failed password. */
const DEFAULT_SALT = 'cGxhbm5lci1kZWNveQ==';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
      ...headers,
    },
  });
}

function error(status: number, message: string, code?: string): Response {
  return json(status, { error: { message, ...(code ? { code } : {}) } });
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email_lower,
    displayName: row.display_name,
    role: row.role,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function isHttps(request: Request): boolean {
  const forwarded = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwarded === 'https' || forwarded === 'http') return forwarded === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return true;
  }
}

function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearedCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('=')) || null;
  }
  return null;
}

async function readJsonBody(request: Request, maxBytes: number = MAX_AUTH_BODY_BYTES): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readLimitedBody(request, maxBytes);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return null;
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * A bounded list of base64 strings.
 *
 * Recovery codes arrive as a set, so the server accepts many — but never an
 * unbounded number: a huge list would be a cheap way to make it store and hash
 * whatever it is sent.
 */
const MAX_RECOVERY_CODES = 16;

function isBase64List(
  value: unknown,
  itemMin: number,
  itemMax: number,
  minCount: number,
  maxCount: number,
): value is string[] {
  if (!Array.isArray(value) || value.length < minCount || value.length > maxCount) return false;
  return value.every((entry) => isBase64(entry, itemMin, itemMax));
}

/**
 * A short, readable name for the device that just signed in.
 *
 * Enough to tell "the laptop I use every day" from "a phone I signed into once
 * at a library" — which is the whole point of a devices list. Deliberately
 * coarse: a precise user-agent string is a fingerprint, and none of this is
 * needed to authenticate anybody.
 */
export function deviceLabel(request: Request): string {
  const agent = request.headers.get('user-agent') ?? '';
  const system = /iPhone/i.test(agent)
    ? 'iPhone'
    : /iPad|Macintosh/i.test(agent) && /Mac OS X/i.test(agent) && !/iPhone|iPad/i.test(agent)
      ? 'Mac'
      : /iPad/i.test(agent)
        ? 'iPad'
        : /Android/i.test(agent)
          ? 'Android'
          : /Windows/i.test(agent)
            ? 'Windows'
            : /Macintosh|Mac OS X/i.test(agent)
              ? 'Mac'
              : /Linux/i.test(agent)
                ? 'Linux'
                : '';
  const browser = /Edg\//i.test(agent)
    ? 'Edge'
    : /OPR\/|Opera/i.test(agent)
      ? 'Opera'
      : /Firefox\//i.test(agent)
        ? 'Firefox'
        : /Chrome\//i.test(agent)
          ? 'Chrome'
          : /Safari\//i.test(agent)
            ? 'Safari'
            : '';
  if (browser && system) return `${browser} on ${system}`;
  return browser || system || 'Unknown device';
}

function guard(request: Request, bucket: string, limit: number): Response | null {
  if (!isSameOriginRequest(request)) return error(403, 'Cross-origin requests are not allowed.');
  const limited = rateLimitResponse(request, bucket, limit, 60_000);
  return limited;
}

/* ------------------------------------------------------------------ signup */

export async function handleSignup(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-signup', 6) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  // The vault rides along with sign-up, so this body is far larger than the
  // ordinary auth cap — a planner with real data must still fit.
  const body = await readJsonBody(request, MAX_VAULT_BODY_BYTES);
  if (!body) return error(400, 'Expected a JSON body.');

  const username = cleanUsername(body.username);
  const displayName = cleanDisplayName(body.displayName);
  const role = cleanRole(body.role);
  const email = cleanEmail(body.email);
  const kdfSalt = body.kdfSalt;
  const authToken = body.authToken;
  const recoveryHashes = body.recoveryHashes;
  const wrappedDek = body.wrappedDek;
  const wrappedRecovery = body.wrappedRecovery;
  const ciphertext = body.ciphertext;

  if (!username) return error(400, 'Username must be 3–24 letters, numbers or underscores.');
  if (!displayName) return error(400, 'Please enter a name.');
  if (!role) return error(400, 'Please choose how you will use Planner.');
  if (email === undefined) return error(400, 'That email address does not look right.');
  if (!isBase64(kdfSalt, 16, 64)) return error(400, 'Missing or invalid KDF salt.');
  if (!isBase64(authToken, 32, 64)) return error(400, 'Missing or invalid auth token.');
  if (!isBase64List(recoveryHashes, 43, 44, 1, MAX_RECOVERY_CODES)) return error(400, 'Missing or invalid recovery verifiers.');
  if (!isBase64(wrappedDek, 32, 256)) return error(400, 'Missing or invalid wrapped key.');
  // One wrapped copy per code: the sets must line up, or a code would open
  // nothing and quietly be useless.
  if (!isBase64List(wrappedRecovery, 32, 256, 1, MAX_RECOVERY_CODES) || wrappedRecovery.length !== recoveryHashes.length) {
    return error(400, 'Missing or invalid recovery keys.');
  }
  if (typeof ciphertext !== 'string' || !ciphertext || ciphertext.length > MAX_VAULT_BYTES * 2) {
    return error(400, 'Missing or invalid vault.');
  }

  try {
    const result = await store!.createAccount({
      username,
      email,
      displayName,
      role,
      kdfSalt,
      authToken,
      recoveryHashes: recoveryHashes as string[],
      wrappedDek,
      wrappedRecovery: wrappedRecovery as string[],
      ciphertext,
    });
    if (!result.ok) {
      return error(409, result.reason === 'username_taken' ? 'That username is taken.' : 'That email is already registered.', 'taken');
    }

    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
    await store!.createSession(result.user.id, hashToken(token), deviceLabel(request), expiresAt);

    return json(201, { user: toPublicUser(result.user) }, { 'Set-Cookie': sessionCookie(token, isHttps(request)) });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/** Reports whether accounts are wired up, without revealing the connection string. */
export function handleAuthStatus(request: Request, databaseUrl: string | undefined): Response {
  if (!isSameOriginRequest(request)) return error(403, 'Cross-origin requests are not allowed.');
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'Method not allowed.', undefined);
  const configured = Boolean(databaseUrl?.trim());
  // Development and preview fall back to the in-memory store, where accounts
  // work but do not survive a restart. Saying so is more useful than a bare
  // "not configured" that contradicts a sign-up which just succeeded.
  const storage: 'database' | 'temporary' | 'none' = configured
    ? 'database'
    : process.env.NODE_ENV === 'production'
      ? 'none'
      : 'temporary';
  return json(200, { configured, storage });
}

/* -------------------------------------------------------------------- salt */

/**
 * The KDF salt is not secret, and the client needs it before it can stretch the
 * password. Unknown accounts get a deterministic decoy salt so this endpoint
 * cannot be used to discover who has an account.
 */
export function decoySalt(login: string): string {
  const digest = createHash('sha256').update(`planner-decoy:${login.trim().toLowerCase()}`).digest();
  return digest.subarray(0, 16).toString('base64');
}

export async function handleSalt(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-salt', 40) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const body = await readJsonBody(request);
  const login = typeof body?.username === 'string' ? body.username.trim() : '';
  if (!login || login.length > 200) return error(400, 'Enter your username or email.');

  try {
    const account = await store!.findAccount(login);
    return json(200, { kdfSalt: account?.kdfSalt ?? decoySalt(login) });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/** A stable encrypted-looking decoy keeps recovery lookup from confirming accounts. */
function decoyRecoveryWrap(login: string): string {
  const normalized = login.trim().toLowerCase();
  const head = createHash('sha256').update(`planner-recovery-decoy:${normalized}`).digest();
  const tail = createHash('sha256').update(`planner-recovery-decoy-tail:${normalized}`).digest();
  return Buffer.concat([head, tail.subarray(0, 28)]).toString('base64');
}

/** Returns only the salt and opaque wrapped key; unknown accounts get a decoy of the same shape. */
export async function handleRecoveryStart(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-recovery-start', 30) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const body = await readJsonBody(request);
  const login = typeof body?.username === 'string' ? body.username.trim() : '';
  if (!login || login.length > 200) return error(400, 'Enter your username or email.');

  try {
    const account = await store!.findAccount(login);
    const vault = account ? await store!.getVault(account.user.id) : null;
    return json(200, {
      kdfSalt: account?.kdfSalt ?? decoySalt(login),
      wrappedRecovery: account ? parseRecoveryWraps(vault?.wrappedRecovery) : [decoyRecoveryWrap(login)],
    });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/** Replaces the password and both wrapped DEKs only after the verifier matches. */
export async function handleRecoveryComplete(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-recovery-complete', 8) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const body = await readJsonBody(request);
  const login = typeof body?.username === 'string' ? body.username.trim() : '';
  const recoveryHash = body?.recoveryHash;
  const newRecoveryHashes = body?.newRecoveryHashes;
  const kdfSalt = body?.kdfSalt;
  const authToken = body?.authToken;
  const wrappedDek = body?.wrappedDek;
  const wrappedRecovery = body?.wrappedRecovery;
  if (
    !login || login.length > 200 ||
    !isBase64(recoveryHash, 43, 44) || !isBase64List(newRecoveryHashes, 43, 44, 1, MAX_RECOVERY_CODES) ||
    !isBase64(kdfSalt, 16, 64) || !isBase64(authToken, 32, 64) ||
    !isBase64(wrappedDek, 32, 256) ||
    !isBase64List(wrappedRecovery, 32, 256, 1, MAX_RECOVERY_CODES) ||
    wrappedRecovery.length !== newRecoveryHashes.length
  ) {
    return error(400, 'Missing or invalid recovery details.');
  }

  try {
    const updated = await store!.recoverAccount(login, recoveryHash, {
      newRecoveryHashes,
      kdfSalt,
      authToken,
      wrappedDek,
      wrappedRecovery,
    });
    if (!updated) return error(401, 'Wrong username or recovery key.', 'bad_credentials');
    return json(200, { ok: true });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/**
 * Replace the recovery codes of an account that is already signed in.
 *
 * The caller proved who it is with its password — there is no verifier to
 * check here — so all this does is swap one set of opaque verifiers and wrapped
 * keys for another.
 */
export async function handleRecoveryUpdate(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-recovery-update', 8) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const token = readSessionToken(request);
  if (!token) return error(401, 'Sign in first.', 'unauthenticated');

  const body = await readJsonBody(request);
  const newRecoveryHashes = body?.newRecoveryHashes;
  const kdfSalt = body?.kdfSalt;
  const authToken = body?.authToken;
  const wrappedDek = body?.wrappedDek;
  const wrappedRecovery = body?.wrappedRecovery;
  if (
    !isBase64List(newRecoveryHashes, 43, 44, 1, MAX_RECOVERY_CODES) ||
    !isBase64(kdfSalt, 16, 64) || !isBase64(authToken, 32, 64) ||
    !isBase64(wrappedDek, 32, 256) ||
    !isBase64List(wrappedRecovery, 32, 256, 1, MAX_RECOVERY_CODES) ||
    wrappedRecovery.length !== newRecoveryHashes.length
  ) {
    return error(400, 'Missing or invalid recovery details.');
  }

  try {
    const found = await store!.findSession(hashToken(token));
    if (!found) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');
    if (!store!.updateRecovery) return error(501, 'This server cannot rotate recovery codes yet.');
    const updated = await store!.updateRecovery(found.user.id, {
      newRecoveryHashes,
      kdfSalt,
      authToken,
      wrappedDek,
      wrappedRecovery,
    });
    if (!updated) return error(502, 'The accounts database could not be reached. Try again shortly.');
    return json(200, { ok: true });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/* ------------------------------------------------------------------- login */

export async function handleLogin(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-login', 12) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const body = await readJsonBody(request);
  if (!body) return error(400, 'Expected a JSON body.');

  const login = typeof body.username === 'string' ? body.username.trim() : '';
  const authToken = body.authToken;
  if (!login || login.length > 200) return error(400, 'Enter your username or email.');
  if (!isBase64(authToken, 32, 64)) return error(400, 'Missing or invalid credentials.');

  try {
    const account = await store!.findAccount(login);
    if (!account) {
      // Spend the same work as the success path so a missing account is not
      // measurably faster to reject.
      const decoy = await hashAuthToken(authToken, DEFAULT_SALT);
      safeEqual(decoy, decoy);
      return error(401, 'Wrong username or password.', 'bad_credentials');
    }
    const expected = await hashAuthToken(authToken, account.hashSalt);
    if (!safeEqual(expected, account.authHash)) return error(401, 'Wrong username or password.', 'bad_credentials');

    const vault = await store!.getVault(account.user.id);
    if (!vault) return error(500, 'This account has no vault. Please contact support.', 'no_vault');

    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
    await store!.createSession(account.user.id, hashToken(token), deviceLabel(request), expiresAt);

    const payload: LoginResponse = {
      user: toPublicUser(account.user),
      kdfSalt: account.kdfSalt,
      wrappedDek: vault.wrappedDek,
      vault: { version: vault.version, ciphertext: vault.ciphertext },
    };
    return json(200, payload, { 'Set-Cookie': sessionCookie(token, isHttps(request)) });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/* ----------------------------------------------------------------- session */

export async function handleSession(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-session', 240) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'Method not allowed.', undefined);

  const token = readSessionToken(request);
  // Nobody signed in is still an unauthenticated answer: a status that says
  // "success" for a request with no session is how a client ends up believing
  // it is logged in when it is not.
  if (!token) return error(401, 'You are not signed in.', 'unauthenticated');

  try {
    const found = await store!.findSession(hashToken(token));
    // An expired cookie is cleared, so the browser stops sending it.
    if (!found) {
      return json(401, { user: null } as SessionResponse, {
        'Set-Cookie': clearedCookie(isHttps(request)),
      });
    }
    return json(200, { user: toPublicUser(found.user) });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/* ------------------------------------------------------------------ logout */

export async function handleLogout(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-logout', 30) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const token = readSessionToken(request);
  if (token) {
    try {
      const found = await store!.findSession(hashToken(token));
      if (found) await store!.deleteSession(found.session.id);
    } catch {
      /* clearing the cookie is still the right outcome */
    }
  }
  return json(200, { ok: true }, { 'Set-Cookie': clearedCookie(isHttps(request)) });
}

/* ---------------------------------------------------------------- passkeys */

const PASSKEY_CHALLENGE_COOKIE = 'planner_passkey_challenge';
const PASSKEY_CHALLENGE_TTL_SECONDS = 300;
const MAX_PASSKEYS_PER_USER = 10;
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const TRANSPORTS_PATTERN = /^([a-z]+)(,[a-z]+)*$/;

type CeremonyPurpose = 'register' | 'login';

/**
 * The challenge rides in an HttpOnly cookie: the browser cannot read it, so a
 * script that somehow runs on this origin still cannot answer its own
 * challenge. `purpose` keeps a registration challenge from being replayed as a
 * sign-in one.
 */
function challengeCookie(purpose: CeremonyPurpose, challenge: string, secure: boolean): string {
  const parts = [
    `${PASSKEY_CHALLENGE_COOKIE}=${purpose}.${challenge}`,
    'Path=/api/auth/passkey',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${PASSKEY_CHALLENGE_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearedChallengeCookie(secure: boolean): string {
  return `${PASSKEY_CHALLENGE_COOKIE}=; Path=/api/auth/passkey; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function readChallenge(request: Request, purpose: CeremonyPurpose): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== PASSKEY_CHALLENGE_COOKIE) continue;
    const value = decodeURIComponent(rest.join('='));
    const [storedPurpose, ...challengeParts] = value.split('.');
    if (storedPurpose !== purpose || challengeParts.length === 0) return null;
    const joined = challengeParts.join('.');
    return CREDENTIAL_ID_PATTERN.test(joined) ? joined : null;
  }
  return null;
}

function cleanLabel(value: unknown): string {
  if (typeof value !== 'string') return 'Passkey';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 40) : 'Passkey';
}

function cleanTransports(value: unknown): string {
  if (typeof value !== 'string' || !TRANSPORTS_PATTERN.test(value) || value.length > 40) return '';
  return value
    .split(',')
    .filter((item) => ['usb', 'nfc', 'ble', 'internal', 'hybrid'].includes(item))
    .join(',');
}

/** Registration step 1: hand out a challenge, bound to this session. */
export async function handlePasskeyRegisterOptions(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-passkey-reg-options', 10) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const session = await linkUser(request, store);
  if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');

  try {
    const existing = await session.store.listPasskeys(session.user.id);
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      return error(409, 'This account already has as many passkeys as it can hold.', 'limit');
    }
    const challenge = newToken();
    return json(200, { challenge, allowCredentials: [] }, { 'Set-Cookie': challengeCookie('register', challenge, isHttps(request)) });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/** Registration step 2: verify the ceremony and store the credential. */
export async function handlePasskeyRegisterVerify(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-passkey-reg-verify', 10) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const session = await linkUser(request, store);
  if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');

  const challenge = readChallenge(request, 'register');
  if (!challenge) {
    return json(400, { error: { message: 'That passkey setup has expired. Start again.' } }, { 'Set-Cookie': clearedChallengeCookie(isHttps(request)) });
  }

  const body = await readJsonBody(request);
  if (!body) return error(400, 'Expected a JSON body.');
  const id = typeof body.id === 'string' && CREDENTIAL_ID_PATTERN.test(body.id) ? body.id : null;
  const clientDataJSON = isBase64(body.clientDataJSON, 32, 16 * 1024) ? body.clientDataJSON : null;
  const attestationObject = isBase64(body.attestationObject, 64, 256 * 1024) ? body.attestationObject : null;
  if (!id || !clientDataJSON || !attestationObject) return error(400, 'That registration response is not complete.');

  const prfWrappedDek =
    body.prfWrappedDek === undefined || body.prfWrappedDek === null
      ? null
      : isBase64(body.prfWrappedDek, 32, 1024)
        ? (body.prfWrappedDek as string)
        : null;
  if (body.prfWrappedDek !== undefined && body.prfWrappedDek !== null && !prfWrappedDek) {
    return error(400, 'That wrapped key is not valid.');
  }

  try {
    const verified = await verifyRegistration({
      request,
      clientDataJSON: fromBase64Url(clientDataJSON),
      attestationObject: fromBase64Url(attestationObject),
      expectedChallenge: challenge,
    });
    if (verified.credentialId !== id) return error(400, 'That credential id does not match its response.');

    const created = await session.store.createPasskey({
      credentialId: verified.credentialId,
      userId: session.user.id,
      publicKey: verified.publicKey,
      label: cleanLabel(body.label),
      signCount: verified.signCount,
      prfWrappedDek,
      transports: cleanTransports(body.transports),
    });
    if (!created) return error(409, 'That passkey is already registered.', 'taken');

    return json(
      201,
      { passkey: { credentialId: created.credential_id, label: created.label, prf: created.prf_wrapped_dek !== null } },
      { 'Set-Cookie': clearedChallengeCookie(isHttps(request)) },
    );
  } catch (caught) {
    const message = caught instanceof WebAuthnError ? caught.message : 'That passkey could not be registered. Try again.';
    return json(400, { error: { message } }, { 'Set-Cookie': clearedChallengeCookie(isHttps(request)) });
  }
}

/** Sign-in step 1: a challenge, narrowed to the account's passkeys if known. */
export async function handlePasskeyLoginOptions(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-passkey-login-options', 15) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const body = await readJsonBody(request);
  const login = typeof body?.username === 'string' ? body.username.trim() : '';
  if (login.length > 200) return error(400, 'Enter your username or email.');

  try {
    let allowCredentials: string[] = [];
    if (login) {
      // Unknown accounts answer with the same empty list as accounts without
      // passkeys, so this endpoint cannot be used to discover who has one.
      const account = await store!.findAccount(login);
      if (account) {
        const passkeys = await store!.listPasskeys(account.user.id);
        allowCredentials = passkeys.map((row) => row.credential_id);
      }
    }
    const challenge = newToken();
    const payload: PasskeyOptionsResponse = { challenge, allowCredentials };
    return json(200, payload, { 'Set-Cookie': challengeCookie('login', challenge, isHttps(request)) });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/** Sign-in step 2: verify the assertion, open a session, hand back the vault. */
export async function handlePasskeyLoginVerify(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-passkey-login-verify', 15) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const challenge = readChallenge(request, 'login');
  if (!challenge) {
    return json(400, { error: { message: 'That sign-in has expired. Start again.' } }, { 'Set-Cookie': clearedChallengeCookie(isHttps(request)) });
  }

  const body = await readJsonBody(request);
  if (!body) return error(400, 'Expected a JSON body.');
  const id = typeof body.id === 'string' && CREDENTIAL_ID_PATTERN.test(body.id) ? body.id : null;
  const clientDataJSON = isBase64(body.clientDataJSON, 32, 16 * 1024) ? body.clientDataJSON : null;
  const authenticatorData = isBase64(body.authenticatorData, 37, 4 * 1024) ? body.authenticatorData : null;
  const signature = isBase64(body.signature, 32, 1024) ? body.signature : null;
  if (!id || !clientDataJSON || !authenticatorData || !signature) return error(400, 'That sign-in response is not complete.');

  try {
    const passkey = await store!.findPasskey(id);
    // An unknown credential is indistinguishable from a wrong password.
    if (!passkey) return error(401, 'Wrong username or password.', 'bad_credentials');
    const user = await store!.findUserById(passkey.user_id);
    if (!user) return error(401, 'Wrong username or password.', 'bad_credentials');
    if (typeof body.userHandle === 'string' && body.userHandle && body.userHandle !== user.id) {
      return error(401, 'Wrong username or password.', 'bad_credentials');
    }

    const signCount = await verifyAssertion({
      request,
      clientDataJSON: fromBase64Url(clientDataJSON),
      authenticatorData: fromBase64Url(authenticatorData),
      signature: fromBase64Url(signature),
      publicKeyRaw: Buffer.from(passkey.public_key, 'base64'),
      expectedChallenge: challenge,
    });
    if (passkey.sign_count > 0 && signCount > 0 && signCount <= passkey.sign_count) {
      // Two authenticators answering with the same key means one was cloned.
      return error(400, "That passkey's counter moved backwards. Remove it and register it again.");
    }

    const vault = await store!.getVault(user.id);
    if (!vault) return error(500, 'This account has no vault. Please contact support.', 'no_vault');

    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
    await Promise.all([
      store!.createSession(user.id, hashToken(token), `${deviceLabel(request)} · passkey`.slice(0, 60), expiresAt),
      store!.touchPasskey(id, signCount),
    ]);

    const payload: PasskeyLoginResponse = {
      user: toPublicUser(user),
      vault: { version: vault.version, ciphertext: vault.ciphertext },
      wrappedDek: passkey.prf_wrapped_dek,
    };
    return json(200, payload, { 'Set-Cookie': sessionCookie(token, isHttps(request)) });
  } catch (caught) {
    const message = caught instanceof WebAuthnError ? caught.message : 'That sign-in could not be verified. Try again.';
    return json(400, { error: { message } }, { 'Set-Cookie': clearedChallengeCookie(isHttps(request)) });
  }
}

/** The signed-in account's passkeys — Settings → Security. */
export async function handlePasskeyList(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-passkey-list', 60) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'Method not allowed.', undefined);

  const session = await linkUser(request, store);
  if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');
  try {
    const rows = await session.store.listPasskeys(session.user.id);
    return json(200, {
      passkeys: rows.map((row) => ({
        credentialId: row.credential_id,
        label: row.label,
        prf: row.prf_wrapped_dek !== null,
        transports: row.transports,
        createdAt: new Date(row.created_at).toISOString(),
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      })),
    });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/** Permanently delete the signed-in account after password re-verification. */
export async function handleAccountDelete(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-account-delete', 5) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'DELETE') return error(405, 'Method not allowed.', undefined);
  if (!store?.deleteAccount) return error(503, 'Account deletion is not available on this server.', 'not_configured');

  const session = await linkUser(request, store);
  if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');
  const body = await readJsonBody(request);
  const authToken = isBase64(body?.authToken, 32, 64) ? body.authToken : null;
  if (!authToken) return error(400, 'Confirm your password to delete this account.');

  try {
    const account = await store.findAccount(session.user.username_lower);
    if (!account) return error(401, 'The account could not be verified.', 'bad_credentials');
    const candidate = await hashAuthToken(authToken, account.hashSalt);
    if (!safeEqual(candidate, account.authHash)) return error(401, 'That password did not match.', 'bad_credentials');
    const removed = await store.deleteAccount(session.user.id);
    if (!removed) return error(404, 'This account is already gone.', 'not_found');
    return json(200, { ok: true }, { 'Set-Cookie': clearedCookie(isHttps(request)) });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/** Remove one of your own passkeys. */
export async function handlePasskeyDelete(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-passkey-delete', 15) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'DELETE') return error(405, 'Method not allowed.', undefined);

  const session = await linkUser(request, store);
  if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');

  const body = await readJsonBody(request);
  const credentialId = typeof body?.credentialId === 'string' && CREDENTIAL_ID_PATTERN.test(body.credentialId) ? body.credentialId : null;
  if (!credentialId) return error(400, 'Expected { credentialId }.');
  try {
    const removed = await session.store.deletePasskey(session.user.id, credentialId);
    if (!removed) return error(404, 'That passkey is no longer here.', 'not_found');
    return json(200, { ok: true });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/* ---------------------------------------------------------------- sessions */

/**
 * The devices signed into this account, and the way to end them.
 *
 * In a zero-knowledge app the server cannot lock a stolen vault, but it can
 * stop handing out the encrypted vault to a session that should no longer have
 * it — which is exactly what signing a device out means here.
 */
export async function handleSessions(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-sessions', 60) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;

  const token = readSessionToken(request);
  if (!token) return error(401, 'Sign in first.', 'unauthenticated');

  try {
    const found = await store!.findSession(hashToken(token));
    if (!found) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');

    if (request.method === 'GET') {
      const sessions = await store!.listSessions(found.user.id);
      return json(200, { sessions, current: found.session.id });
    }

    if (request.method === 'DELETE') {
      const body = await readJsonBody(request);
      const id = typeof body?.id === 'string' && /^[a-f0-9-]{36}$/.test(body.id) ? body.id : null;
      const all = body?.others === true;
      if (!id && !all) return error(400, 'Expected { id } or { others: true }.');
      // Ending every other session keeps this one: the caller is still using
      // it, and locking yourself out is never what "sign out my other devices"
      // means.
      const removed = all
        ? await store!.deleteOtherSessions(found.user.id, found.session.id)
        : (await store!.deleteSessionForUser(id as string, found.user.id))
          ? 1
          : 0;
      if (removed === 0) return error(404, 'That session has already ended.', 'not_found');
      return json(200, { ok: true, removed });
    }

    return error(405, 'Method not allowed.', undefined);
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/* ------------------------------------------------------------------- vault */

/** Requires a session; returns the caller's own encrypted vault. */
export async function handleAccountVault(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-vault', 90) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;

  const token = readSessionToken(request);
  if (!token) return error(401, 'Sign in first.', 'unauthenticated');
  try {
    const found = await store!.findSession(hashToken(token));
    if (!found) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');

    if (request.method === 'GET') {
      const vault = await store!.getVault(found.user.id);
      if (!vault) return error(404, 'No vault yet.', 'not_found');
      const payload: VaultResponse = {
        version: vault.version,
        ciphertext: vault.ciphertext,
        updatedAt: new Date(vault.updated_at).toISOString(),
      };
      return json(200, payload);
    }

    if (request.method === 'PUT') {
      const body = await readJsonBody(request, MAX_VAULT_BODY_BYTES);
      if (!body) return error(400, 'Expected a JSON body.');
      const baseVersion = typeof body.baseVersion === 'number' && Number.isInteger(body.baseVersion) && body.baseVersion >= 0 ? body.baseVersion : -1;
      const ciphertext = body.ciphertext;
      if (baseVersion < 0 || typeof ciphertext !== 'string' || !ciphertext || ciphertext.length > MAX_VAULT_BYTES * 2) {
        return error(400, 'Expected { baseVersion, ciphertext }.');
      }
      const next = await store!.putVault(found.user.id, baseVersion, ciphertext);
      if (next) {
        const payload: VaultResponse = {
          version: next.version,
          ciphertext: next.ciphertext,
          updatedAt: new Date(next.updated_at).toISOString(),
        };
        return json(200, payload);
      }
      const current = await store!.getVault(found.user.id);
      return json(409, {
        error: { message: 'Another device synced first.', code: 'conflict' },
        current: current
          ? ({ version: current.version, ciphertext: current.ciphertext, updatedAt: new Date(current.updated_at).toISOString() } as VaultResponse)
          : null,
      });
    }

    return error(405, 'Method not allowed.', undefined);
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/* ------------------------------------------------------------------- links */

/**
 * Every link endpoint needs a live session. `linkUser` returns the signed-in
 * user (without the cookie handling leaking into each handler).
 */
async function linkUser(request: Request, store: AuthStore | null): Promise<{ user: UserRow; store: AuthStore } | null> {
  if (!store) return null;
  const token = readSessionToken(request);
  if (!token) return null;
  try {
    const found = await store.findSession(hashToken(token));
    return found ? { user: found.user, store } : null;
  } catch {
    return null;
  }
}

function outgoingView(row: LinkRow): OutgoingLink {
  return {
    id: row.id,
    studentUsername: row.student_username_lower,
    status: row.status,
    weekOf: row.share_week,
    updatedAt: row.share_updated_at ? new Date(row.share_updated_at).toISOString() : null,
  };
}

/** GET lists both sides: requests I have sent, and requests waiting for me. */
export async function handleLinks(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-links', 90) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method === 'GET') {
    const session = await linkUser(request, store);
    if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');
    try {
      const [outgoing, incoming] = await Promise.all([
        session.store.listOutgoingLinks(session.user.id),
        session.store.listIncomingLinks({ id: session.user.id, usernameLower: session.user.username_lower }),
      ]);
      const payload: LinksResponse = {
        outgoing: outgoing.map(outgoingView),
        incoming: incoming.map((row) => ({
          id: row.id,
          guardianUsername: row.guardian_username,
          guardianDisplayName: row.guardian_display_name,
          status: row.status,
        })),
      };
      return json(200, payload);
    } catch {
      return error(502, 'The accounts database could not be reached. Try again shortly.');
    }
  }

  if (request.method === 'POST') {
    // Guardian: ask a student to be followed.
    const session = await linkUser(request, store);
    if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');
    const body = await readJsonBody(request);
    if (!body) return error(400, 'Expected a JSON body.');
    const username = cleanUsername(body.username);
    const codeHash = cleanCodeHash(body.codeHash);
    const wrappedShare = cleanWrappedShare(body.wrappedShare);
    if (!username) return error(400, 'That username does not look right.');
    if (!codeHash) return error(400, 'Missing or invalid link code.');
    if (!wrappedShare) return error(400, 'Missing or invalid link key.');
    if (username.toLowerCase() === session.user.username_lower) return error(400, 'You cannot follow yourself.');

    try {
      const existing = await session.store.listOutgoingLinks(session.user.id);
      if (existing.length >= MAX_LINKS_PER_SIDE) {
        return error(409, 'You already follow as many students as this panel can hold.', 'limit');
      }
      const row = await session.store.createLink({
        id: newStoreId(),
        guardianId: session.user.id,
        studentUsernameLower: username.toLowerCase(),
        codeHash,
        wrappedShare,
      });
      if (!row) return error(409, 'You have already invited that student.', 'taken');
      return json(201, { link: outgoingView(row) });
    } catch {
      return error(502, 'The accounts database could not be reached. Try again shortly.');
    }
  }

  if (request.method === 'DELETE') {
    // Either side can end a link.
    const session = await linkUser(request, store);
    if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');
    const body = await readJsonBody(request);
    const linkId = cleanLinkId(body?.linkId);
    if (!linkId) return error(400, 'Expected { linkId }.');
    try {
      const removed = await session.store.deleteLink(linkId, session.user.id);
      if (!removed) return error(404, 'That link is no longer there.', 'not_found');
      return json(200, { ok: true });
    } catch {
      return error(502, 'The accounts database could not be reached. Try again shortly.');
    }
  }

  return error(405, 'Method not allowed.', undefined);
}

/** Student: hand over the code their guardian gave them and open the link. */
export async function handleLinkAccept(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-link-accept', 20) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;
  if (request.method !== 'POST') return error(405, 'Method not allowed.', undefined);

  const session = await linkUser(request, store);
  if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');
  const body = await readJsonBody(request);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code || code.length > 64) return error(400, 'Enter the code your guardian gave you.');

  // The code itself never touches the database: only its hash does, and the key
  // the results are sealed with is derived from it in the browser.
  const codeHash = await hashLinkCode(code);
  if (!codeHash) return error(400, 'That code is not right. Check it and try again.', 'bad_code');

  try {
    const row = await session.store.acceptLink(codeHash, { id: session.user.id, usernameLower: session.user.username_lower });
    if (!row) return error(404, 'No invitation matches that code.', 'not_found');
    const guardian = await guardianOf(session.store, row.guardian_id);
    return json(200, {
      linkId: row.id,
      guardianUsername: guardian?.username ?? '',
      guardianDisplayName: guardian?.display_name ?? '',
      wrappedShare: row.wrapped_share,
    });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

async function guardianOf(store: AuthStore, guardianId: string): Promise<UserRow | null> {
  try {
    return await store.findUserById(guardianId);
  } catch {
    return null;
  }
}

/** sha256 of the normalised code, base64 — mirrors linkCodeHash in the browser. */
/**
 * sha256 of the code in its canonical form (plnr-XXXX-XXXX-XXXX), base64.
 * This must match linkCodeHash in the browser exactly — the canonical form is
 * what both sides hash, and the code itself is never stored.
 */
export function hashLinkCode(code: string): string | null {
  const clean = code.toUpperCase().replace(/^PLNR[-\s]*/, '').replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{12}$/.test(clean)) return null;
  const canonical = `plnr-${clean.match(/.{4}/g)!.join('-')}`;
  return createHash('sha256').update(canonical).digest('base64');
}

/* ------------------------------------------------------------------ notices */

/**
 * A note travels one hop: a guardian writes for the student, the student writes
 * for the guardian. The student's own device re-seals it for their other
 * guardians, so two adults who follow the same student can tell each other what
 * they changed — without the server ever reading a word.
 */
export async function handleNote(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-note', 60) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;

  const session = await linkUser(request, store);
  if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');

  if (request.method === 'PUT') {
    const body = await readJsonBody(request);
    const linkId = cleanLinkId(body?.linkId);
    const weekOf = cleanWeekOf(body?.weekOf);
    if (!linkId || !weekOf) return error(400, 'Expected { linkId, weekOf }.');
    // Empty clears the note after it has been collected.
    const ciphertext = body?.ciphertext === null || body?.ciphertext === '' ? null : cleanShareCiphertext(body?.ciphertext);
    if (body?.ciphertext !== null && body?.ciphertext !== '' && !ciphertext) return error(400, 'That note could not be sent.');

    // Who is writing decides where it lands: the guardian's note waits for the
    // student, the student's note waits for their guardian.
    const asGuardian = await session.store.getShare(linkId, session.user.id);
    const to = asGuardian ? 'student' : 'guardian';
    try {
      const row = await session.store.putNote(linkId, session.user.id, to, ciphertext, weekOf);
      if (!row) return error(404, 'That link is not active.', 'not_found');
      return json(200, { ok: true, weekOf: row.note_week });
    } catch {
      return error(502, 'The accounts database could not be reached. Try again shortly.');
    }
  }

  if (request.method === 'GET') {
    const linkId = cleanLinkId(new URL(request.url).searchParams.get('linkId'));
    if (!linkId) return error(400, 'Expected ?linkId=.');
    try {
      const note = await session.store.getNote(linkId, session.user.id);
      if (!note) return error(404, 'That link is not there.', 'not_found');
      const payload: NoteResponse = { linkId, ciphertext: note.ciphertext, weekOf: note.weekOf };
      return json(200, payload);
    } catch {
      return error(502, 'The accounts database could not be reached. Try again shortly.');
    }
  }

  return error(405, 'Method not allowed.', undefined);
}

/* ------------------------------------------------------------------- share */

/** Student writes this week's results; guardian reads them. Both see only ciphertext. */
export async function handleShare(request: Request, store: AuthStore | null): Promise<Response> {
  const blocked = guard(request, 'auth-share', 120) ?? (store ? null : error(503, MISSING_DB_AUTH_MESSAGE, 'not_configured'));
  if (blocked) return blocked;

  const session = await linkUser(request, store);
  if (!session) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');

  if (request.method === 'PUT') {
    const body = await readJsonBody(request);
    const linkId = cleanLinkId(body?.linkId);
    const ciphertext = cleanShareCiphertext(body?.ciphertext);
    const weekOf = cleanWeekOf(body?.weekOf);
    if (!linkId || !ciphertext || !weekOf) return error(400, 'Expected { linkId, ciphertext, weekOf }.');
    try {
      const row = await session.store.putShare(linkId, session.user.id, ciphertext, weekOf);
      if (!row) return error(404, 'That link is not active.', 'not_found');
      return json(200, { ok: true, weekOf: row.share_week });
    } catch {
      return error(502, 'The accounts database could not be reached. Try again shortly.');
    }
  }

  if (request.method === 'GET') {
    const linkId = cleanLinkId(new URL(request.url).searchParams.get('linkId'));
    if (!linkId) return error(400, 'Expected ?linkId=.');
    try {
      const row = await session.store.getShare(linkId, session.user.id);
      if (!row) return error(404, 'That link is not there.', 'not_found');
      const payload: ShareResponse = {
        linkId: row.id,
        ciphertext: row.share_ciphertext,
        weekOf: row.share_week,
        updatedAt: row.share_updated_at ? new Date(row.share_updated_at).toISOString() : null,
      };
      return json(200, payload);
    } catch {
      return error(502, 'The accounts database could not be reached. Try again shortly.');
    }
  }

  return error(405, 'Method not allowed.', undefined);
}
