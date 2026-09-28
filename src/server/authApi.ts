/**
 * Account API shared by the Vercel Functions in `api/auth/*` and the Vite
 * dev/preview middleware.
 *
 * The server stores only what it must: an identifier, a verifier for the
 * client-stretched auth token, session records, and an opaque encrypted vault.
 * Passwords, planner content and vault keys never reach it.
 */
import { createHash } from 'node:crypto';
import { isSameOriginRequest } from './xaiProxy';
import { API_SECURITY_HEADERS, BodyTooLargeError, rateLimitResponse, readLimitedBody } from './security';
import {
  cleanDisplayName,
  cleanEmail,
  cleanRole,
  cleanUsername,
  isBase64,
  MAX_AUTH_BODY_BYTES,
  MAX_VAULT_BYTES,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  type LoginResponse,
  type PublicUser,
  type SessionResponse,
  type VaultResponse,
} from '../shared/authContract';
import {
  authStore,
  hashAuthToken,
  hashToken,
  newToken,
  safeEqual,
  type AuthStore,
  type UserRow,
} from './authStore';

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

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readLimitedBody(request, MAX_AUTH_BODY_BYTES);
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

  const body = await readJsonBody(request);
  if (!body) return error(400, 'Expected a JSON body.');

  const username = cleanUsername(body.username);
  const displayName = cleanDisplayName(body.displayName);
  const role = cleanRole(body.role);
  const email = cleanEmail(body.email);
  const kdfSalt = body.kdfSalt;
  const authToken = body.authToken;
  const wrappedDek = body.wrappedDek;
  const wrappedRecovery = body.wrappedRecovery;
  const ciphertext = body.ciphertext;

  if (!username) return error(400, 'Username must be 3–24 letters, numbers or underscores.');
  if (!displayName) return error(400, 'Please enter a name.');
  if (!role) return error(400, 'Please choose how you will use Planner.');
  if (email === undefined) return error(400, 'That email address does not look right.');
  if (!isBase64(kdfSalt, 16, 64)) return error(400, 'Missing or invalid KDF salt.');
  if (!isBase64(authToken, 32, 64)) return error(400, 'Missing or invalid auth token.');
  if (!isBase64(wrappedDek, 32, 256)) return error(400, 'Missing or invalid wrapped key.');
  if (!isBase64(wrappedRecovery, 32, 256)) return error(400, 'Missing or invalid recovery key.');
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
      wrappedDek,
      wrappedRecovery,
      ciphertext,
    });
    if (!result.ok) {
      return error(409, result.reason === 'username_taken' ? 'That username is taken.' : 'That email is already registered.', 'taken');
    }

    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
    await store!.createSession(result.user.id, hashToken(token), 'This device', expiresAt);

    return json(201, { user: toPublicUser(result.user) }, { 'Set-Cookie': sessionCookie(token, isHttps(request)) });
  } catch {
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/** Reports whether accounts are wired up, without revealing the connection string. */
export function handleAuthStatus(request: Request, databaseUrl: string | undefined): Response {
  if (!isSameOriginRequest(request)) return error(403, 'Cross-origin requests are not allowed.');
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'Method not allowed.', undefined);
  return json(200, { configured: Boolean(databaseUrl?.trim()) });
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
    await store!.createSession(account.user.id, hashToken(token), 'This device', expiresAt);

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
  const payload: SessionResponse = { user: null };
  if (!token) return json(200, payload);

  try {
    const found = await store!.findSession(hashToken(token));
    if (!found) return json(200, payload, { 'Set-Cookie': clearedCookie(isHttps(request)) });
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
      const body = await readJsonBody(request);
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

/** Lazy store resolution used by the Vercel Functions. */
export function resolveAuthStore(databaseUrl: string | undefined): Promise<AuthStore | null> {
  return authStore(databaseUrl);
}
