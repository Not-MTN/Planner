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
  MAX_VAULT_BYTES,
  MAX_LINKS_PER_SIDE,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  type LinksResponse,
  type NoteResponse,
  type LoginResponse,
  type OutgoingLink,
  type PublicUser,
  type SessionResponse,
  type ShareResponse,
  type VaultResponse,
} from '../shared/authContract';
import {
  authStore,
  hashAuthToken,
  hashToken,
  newId as newStoreId,
  newToken,
  safeEqual,
  type AuthStore,
  type LinkRow,
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

/** Lazy store resolution used by the Vercel Functions. */
export function resolveAuthStore(databaseUrl: string | undefined): Promise<AuthStore | null> {
  return authStore(databaseUrl);
}
