/**
 * Client for the account API. Holds the unlocked vault key in memory only —
 * never in storage — so a reload simply asks for the password again until the
 * trusted-device flow (phase 2) is built.
 */
import type { AuthEvent, AuthEventsResponse, LoginResponse, PublicUser, SessionResponse, VaultResponse } from '../shared/authContract';
import { hasConfiguredApi, isNativeShell } from '../shared/nativeShell';
import {
  createVaultKeys,
  decryptState,
  deriveFromPassword,
  encryptState,
  formatRecoveryCodes,
  hashRecoveryCodes,
  hashRecoveryKey,
  unwrapWithRecoveryCode,
  importDek,
  keyFromRecovery,
  newSalt,
  normalizeRecoveryKey,
  unwrapKeyRaw,
  wrapRawKey,
} from './crypto';
import { forgetDevice, rememberOnDevice } from './device';
import type { PlannerState } from '../types';

const LAST_USER_KEY = 'planner-last-user-id';
const AUTH_FLAG_KEY = 'planner-auth-flag';
const REDIRECT_KEY = 'planner-should-redirect';

function persistAuth(userId: string): void {
  try {
    localStorage.setItem(LAST_USER_KEY, userId);
    localStorage.setItem(AUTH_FLAG_KEY, '1');
    localStorage.setItem(REDIRECT_KEY, '1');
  } catch {
    /* storage blocked */
  }
}

function clearPersistedAuth(): void {
  try {
    localStorage.removeItem(LAST_USER_KEY);
    localStorage.removeItem(AUTH_FLAG_KEY);
    localStorage.removeItem(REDIRECT_KEY);
  } catch {
    /* ignore */
  }
}

export function getLastUserId(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

export function isAuthFlagSet(): boolean {
  try {
    return localStorage.getItem(AUTH_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function shouldAutoRedirect(): boolean {
  try {
    return localStorage.getItem(REDIRECT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markRedirectDone(): void {
  try {
    localStorage.removeItem(REDIRECT_KEY);
  } catch {
    /* ignore */
  }
}

export type AuthErrorCode =
  | 'bad_credentials'
  | 'taken'
  | 'email_taken'
  | 'not_configured'
  | 'unauthenticated'
  | 'conflict'
  | 'network'
  /**
   * A hosting sign-in page (Vercel Authentication, password protection, a
   * Cloudflare interstitial) answered instead of the API. Signing in cannot
   * work until that gate is turned off, so the user must be told exactly that.
   */
  | 'deployment_gate'
  /** Nothing serves the accounts API at this address: the route or function is missing. */
  | 'api_missing'
  /**
   * A packaged app built with no server address. The shell answers every
   * unknown path with the app's own HTML, so nothing of ours is ever reached;
   * the planner still works, and saying so beats blaming the deployment.
   */
  | 'local_only_build'
  /** The password was accepted, and a code from the authenticator app is owed. */
  | 'totp_required'
  /** An invitation code was right, but sat unused until it stopped working. */
  | 'invite_expired'
  /** A code typed during set-up or removal did not match. */
  | 'totp_invalid'
  | 'unknown';

/**
 * Shown when the deployment sits behind a hosting gate. Retrying is pointless,
 * so the copy names the cause and the setting that fixes it.
 */
export const DEPLOYMENT_GATE_MESSAGE =
  'This deployment is behind a hosting sign-in page, so the app cannot reach its own API. Turn off Vercel Authentication (Project Settings → Deployment Protection), or open the production domain, then try again.';

/** Shown when the API route itself is missing (functions not deployed, alias pointing nowhere). */
export const API_MISSING_MESSAGE =
  'The accounts API did not answer at this address, so signing in cannot work. Redeploy the app so its api/ functions are included, then try again.';

/**
 * Shown by the packaged apps when they were built without a server address.
 * The planner is perfectly usable there — everything stays on the device —
 * so the sentence leads with that, then says what signing in would need.
 */
export const LOCAL_ONLY_MESSAGE =
  'This copy of Planner is built for offline use, with no server address, so accounts, sync and AI are unavailable — the planner itself still works, and everything you write is saved on this device. To sign in, install a build made with a server address (PLANNER_API_ORIGIN or PLANNER_APP_URL), or use the website.';

/** Text a hosting gate leaves in the body, so a plain "not JSON" can be named. */
const GATE_MARKERS =
  /vercel authentication|deployment protection|protected deployment|log in to vercel|sso-api|cloudflare|just a moment|checking your browser|attention required|enable javascript and cookies/i;

function looksLikeGate(raw: string): boolean {
  return GATE_MARKERS.test(raw);
}

/** One line describing what actually came back, for the UI's technical detail. */
function describeResponse(response: Response, raw: string): string {
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim() || 'no content-type';
  const snippet = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${response.status} ${type}${snippet ? ` — “${snippet}”` : ''}`;
}

/** Classifies a response that carried no JSON error of ours. */
function unexpectedBody(response: Response, raw: string): AuthErrorCode {
  // A packaged app with no server address answers every path with its own
  // HTML — that is the app's shell, not a broken deployment, and it is worth
  // naming precisely. Checked first: it is the most specific cause.
  if (isNativeShell() && !hasConfiguredApi()) return 'local_only_build';
  if (looksLikeGate(raw)) return 'deployment_gate';
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  // A 404 with nothing in it, or the app's own HTML shell, means the route is
  // not served here — a platform answer, not one of our handlers.
  if (response.status === 404 || type.includes('text/html')) return 'api_missing';
  return 'unknown';
}

function unexpectedMessage(code: AuthErrorCode, response: Response): string {
  if (code === 'local_only_build') return LOCAL_ONLY_MESSAGE;
  if (code === 'deployment_gate') return DEPLOYMENT_GATE_MESSAGE;
  if (code === 'api_missing') return API_MISSING_MESSAGE;
  return `The server answered with ${response.status} instead of JSON.`;
}

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  /**
   * What the server actually said (untranslated), when it said anything. UI
   * copy has the final word for known codes; everything else shows this
   * instead of a vague "something went wrong".
   */
  readonly detail: string | null;
  constructor(code: AuthErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export interface ActiveSession {
  user: PublicUser;
  /** Non-extractable AES-GCM key for the vault. Memory only. */
  dek: CryptoKey;
  /**
   * The same key's bytes, kept only in this page's memory so a passkey can be
   * enrolled later (the DEK itself is non-extractable and cannot be wrapped).
   * Never written to storage; cleared on sign-out.
   */
  dekRaw: Uint8Array | null;
  vault: { version: number; ciphertext: string };
}

let active: ActiveSession | null = null;

export function getActiveSession(): ActiveSession | null {
  return active;
}

function forget(active: ActiveSession | null): void {
  active?.dekRaw?.fill(0);
  // The reference is about to die anyway; this just shortens the window.
  if (active) active.dekRaw = null;
}

export function endSession(): void {
  forget(active);
  active = null;
}

/** Adopts a session that was unlocked outside of signIn (device cache, unlock screen). */
export function adoptSession(
  user: PublicUser,
  dek: CryptoKey,
  vault: { version: number; ciphertext: string },
  dekRaw: Uint8Array | null = null,
): void {
  active = { user, dek, dekRaw, vault };
}

const REQUEST_TIMEOUT_MS = 25_000;

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const controller = !init.signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS)
    : null;
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      // A hosting sign-in page answers with a redirect. Keeping it manual means
      // the browser hands us an opaque redirect we can name, instead of a CORS
      // failure that looks exactly like a dead connection.
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
      ...init,
    });
  } catch {
    if (timedOut) {
      throw new AuthError(
        'network',
        'The server took too long to respond. Please try again.',
        `${method} ${path} timed out.`,
      );
    }
    throw new AuthError('network', 'Could not reach the server. Check your connection and try again.');
  } finally {
    if (timer !== null) clearTimeout(timer);
  }

  // `opaqueredirect` / status 0: something in front of the app redirected this
  // request away before the API ever saw it. Nothing in this API redirects.
  if (response.type === 'opaqueredirect' || response.status === 0) {
    throw new AuthError(
      'deployment_gate',
      DEPLOYMENT_GATE_MESSAGE,
      `${method} ${path} was redirected to a sign-in page before it reached the API.`,
    );
  }

  let raw = '';
  try {
    raw = await response.text();
  } catch {
    raw = '';
  }
  let body: unknown = null;
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: string } } | null)?.error;
    const detail = `${method} ${path} → ${describeResponse(response, raw)}`;

    if (!error) {
      // Nothing of ours answered. Say what did: a hosting gate, a missing
      // route, or some other non-JSON page — never a vague "unexpected".
      const code = unexpectedBody(response, raw);
      throw new AuthError(code, unexpectedMessage(code, response), detail);
    }

    // Our router answers an unrouted path with a bare "Not found." and no code;
    // that is a deployment gap, not something the user can retry away.
    if (response.status === 404 && !error.code) {
      throw new AuthError('api_missing', API_MISSING_MESSAGE, detail);
    }

    const code = (error.code ?? 'unknown') as AuthErrorCode;
    const mapped: AuthErrorCode =
      code === 'taken' ? (error.message?.toLowerCase().includes('email') ? 'email_taken' : 'taken') : code;
    const serverMessage = typeof error.message === 'string' && error.message.trim() ? error.message : null;
    const message = serverMessage ?? `The server answered with ${response.status}.`;
    throw new AuthError(mapped, message, serverMessage ?? detail);
  }

  // A 2xx that is not JSON means the route served something else entirely
  // (typically the app shell). Callers must not receive a null body.
  if (raw.trim() && body === null) {
    const code = unexpectedBody(response, raw);
    throw new AuthError(code, unexpectedMessage(code, response), `${method} ${path} → ${describeResponse(response, raw)}`);
  }
  return body as T;
}

export interface SignUpInput {
  username: string;
  email: string;
  displayName: string;
  role: 'personal' | 'student' | 'guardian';
  password: string;
  /** Existing local planner data to carry into the new account. */
  initialState: PlannerState;
  /** Trust this device so the planner opens without the password again. Default true. */
  remember?: boolean;
}

export async function signUp(input: SignUpInput): Promise<{ recoveryCodes: string[]; session: ActiveSession }> {
  const recoveryCodes = formatRecoveryCodes();
  const recoveryHashes = hashRecoveryCodes(recoveryCodes);
  const { salt, authToken, dek, dekRaw, wrappedDek, wrappedRecovery } = await createVaultKeys(input.password, recoveryCodes);
  const ciphertext = await encryptState(input.initialState, dek);

  const result = await request<{ user: PublicUser }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      username: input.username,
      email: input.email || null,
      displayName: input.displayName,
      role: input.role,
      kdfSalt: salt,
      authToken,
      recoveryHashes,
      wrappedDek,
      wrappedRecovery,
      ciphertext,
    }),
  });

  active = { user: result.user, dek, dekRaw, vault: { version: 1, ciphertext } };
  // This is the device they signed up on, so open straight into the planner.
  if (input.remember !== false) await rememberOnDevice(result.user.id, dekRaw);
  persistAuth(result.user.id);
  return { recoveryCodes, session: active };
}

/**
 * A sign-in that got as far as a correct password and stopped there.
 *
 * The key derived from the password is held only until the six-digit code
 * arrives, and is dropped the moment it is used or the attempt is abandoned.
 */
let pendingSecondFactor: { kek: CryptoKey | null; remember: boolean } | null = null;
export async function signIn(identifier: string, password: string, remember = true): Promise<ActiveSession> {
  // The salt is stored with the account, so fetch it before stretching. Unknown
  // accounts receive a decoy salt and simply fail the next step.
  const { kdfSalt } = await request<{ kdfSalt: string }>('/api/auth/salt', {
    method: 'POST',
    body: JSON.stringify({ username: identifier.trim() }),
  });
  const { authToken, kek } = await deriveFromPassword(password, kdfSalt);

  const result = await request<LoginResponse & { secondFactor?: 'totp' }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: identifier.trim(), authToken }),
  });

  // The account has an authenticator app: nothing is signed in yet, and the
  // session does not exist until the code arrives.
  if (result.secondFactor === 'totp') {
    pendingSecondFactor = { kek, remember };
    throw new AuthError('totp_required', 'Enter the code from your authenticator app.');
  }

  const raw = await unwrapKeyRaw(result.wrappedDek, kek);
  if (remember) await rememberOnDevice(result.user.id, raw);
  else {
    // Even if not remembering the vault key, we still want to clear any old device cache for other accounts
    // but keep this session persisted via cookie
    try {
      const last = getLastUserId();
      if (last && last !== result.user.id) await forgetDevice(last);
    } catch {}
  }
  // importDek clears its copy; keep one for passkey enrolment on this page.
  const dekRaw = new Uint8Array(raw);
  const dek = await importDek(raw, false);
  active = { user: result.user, dek, dekRaw, vault: result.vault };
  persistAuth(result.user.id);
  return active;
}

/**
 * Re-wrap the vault key for a new set of recovery codes.
 *
 * Every code is a separate lock on the vault, so a fresh set means a fresh
 * wrapped copy per code. The old set stops working the moment the server
 * accepts these.
 */
async function rotateRecoveryCodes(
  raw: Uint8Array<ArrayBuffer>,
  request: {
    salt: string;
    authToken: string;
    wrappedDek: string;
    extra?: Record<string, unknown>;
  },
): Promise<{ recoveryCodes: string[]; body: Record<string, unknown> }> {
  const recoveryCodes = formatRecoveryCodes();
  const wrappedRecovery: string[] = [];
  for (const code of recoveryCodes) {
    const kek = await keyFromRecovery(code, request.salt);
    wrappedRecovery.push(await wrapRawKey(raw, kek));
  }
  return {
    recoveryCodes,
    body: {
      ...request.extra,
      newRecoveryHashes: hashRecoveryCodes(recoveryCodes),
      kdfSalt: request.salt,
      authToken: request.authToken,
      wrappedDek: request.wrappedDek,
      wrappedRecovery,
    },
  };
}

/**
 * Change a forgotten password using one of the account's recovery codes. The
 * vault key is unwrapped and re-wrapped in this browser; only its encrypted
 * copies and one-way recovery verifiers are sent to the server.
 *
 * Recovery issues a whole new set of codes. The one just used is spent, and
 * there is no way to know which of the others may have leaked along with the
 * forgotten password, so all of them are replaced.
 */
export async function resetPasswordWithRecovery(
  identifier: string,
  recoveryCodeInput: string,
  newPassword: string,
): Promise<string[]> {
  const identifierValue = identifier.trim();
  const recoveryCode = normalizeRecoveryKey(recoveryCodeInput);
  if (!identifierValue || !recoveryCode) {
    throw new AuthError('bad_credentials', 'Wrong username or recovery key.');
  }

  const { kdfSalt: oldSalt, wrappedRecovery: oldWrapped } = await request<{
    kdfSalt: string;
    wrappedRecovery: string | string[];
  }>('/api/auth/recovery/start', { method: 'POST', body: JSON.stringify({ username: identifierValue }) });
  // Accounts created before codes came in sets still hold a single wrapped
  // copy; old and new shapes are treated the same from here on.
  const oldWrappedRecovery = Array.isArray(oldWrapped) ? oldWrapped : [oldWrapped];

  let raw: Uint8Array<ArrayBuffer> | null = null;
  try {
    // Any one of the codes opens the vault. The server cannot tell which, so
    // each wrapped copy is tried in turn.
    const opened = await unwrapWithRecoveryCode(recoveryCode, oldWrappedRecovery, oldSalt);
    if (!opened) {
      // The endpoint deliberately returns a decoy for unknown accounts. Keep
      // the same message for an unknown identifier and a wrong recovery code.
      throw new AuthError('bad_credentials', 'Wrong username or recovery key.');
    }
    raw = opened.raw;

    const salt = newSalt();
    const { authToken, kek } = await deriveFromPassword(newPassword, salt);
    const wrappedDek = await wrapRawKey(raw, kek);
    const recoveryHash = hashRecoveryKey(recoveryCode);
    const { recoveryCodes, body } = await rotateRecoveryCodes(raw, {
      salt,
      authToken,
      wrappedDek,
      extra: { username: identifierValue, recoveryHash },
    });

    await request<{ ok: true }>('/api/auth/recovery/complete', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    endSession();
    return recoveryCodes;
  } finally {
    raw?.fill(0);
  }
}

/**
 * Replace the signed-in account's recovery codes with a fresh set.
 *
 * The password is required: it is the only proof of identity that also unlocks
 * the vault, and the server holds nothing that could re-wrap the key itself.
 * Codes are replaced wholesale, because one leaked code is indistinguishable
 * from a leaked set.
 */
export async function regenerateRecoveryCodes(password: string): Promise<string[]> {
  const current = active;
  if (!current) throw new AuthError('unauthenticated', 'Unlock your account to continue.');
  if (!password) throw new AuthError('bad_credentials', 'Enter your password to continue.');

  const { kdfSalt } = await request<{ kdfSalt: string }>('/api/auth/salt', {
    method: 'POST',
    body: JSON.stringify({ username: current.user.username }),
  });
  const { authToken, kek } = await deriveFromPassword(password, kdfSalt);
  const login = await request<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: current.user.username, authToken }),
  });

  let raw: Uint8Array<ArrayBuffer> | null = null;
  try {
    raw = await unwrapKeyRaw(login.wrappedDek, kek);
    const { recoveryCodes, body } = await rotateRecoveryCodes(raw, {
      salt: kdfSalt,
      authToken,
      wrappedDek: login.wrappedDek,
    });
    await request<{ ok: true }>('/api/auth/recovery/update', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return recoveryCodes;
  } finally {
    raw?.fill(0);
  }
}

/**
 * Who is signed in, or null when nobody is.
 *
 * "Not signed in" is an ordinary answer, so a 401 becomes null. A network or
 * database failure is thrown instead of swallowed: an offline device should keep
 * using its local copy rather than be sent to the sign-in page.
 */
export async function fetchSession(): Promise<PublicUser | null> {
  try {
    const result = await request<SessionResponse>('/api/auth/session');
    if (result.user) {
      try {
        persistAuth(result.user.id);
      } catch {}
    }
    return result.user;
  } catch (error) {
    if (error instanceof AuthError && error.code === 'unauthenticated') {
      // Do not clear persisted flag here immediately — the device cache might still allow offline unlock.
      // Only clear redirect flag so we don't loop.
      try {
        localStorage.removeItem(REDIRECT_KEY);
      } catch {}
      return null;
    }
    throw error;
  }
}

/** One signed-in device, as the account holder sees it. */
export type { AuthEvent };

/**
 * A line from the account's history, newest first.
 *
 * An empty list means "offline" or "nothing recorded yet", never "nothing
 * happened" — the log is a convenience, not an audit trail.
 */
export async function listAuthEvents(): Promise<AuthEvent[]> {
  try {
    const result = await request<AuthEventsResponse>('/api/auth/events');
    return result.events ?? [];
  } catch (error) {
    if (error instanceof AuthError && error.code === 'unauthenticated') return [];
    throw error;
  }
}

export interface DeviceSession {
  id: string;
  /** A short description captured at sign-in, e.g. "Chrome on Mac". */
  label: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** True for the session this browser is using right now. */
  current: boolean;
}

/**
 * Every device signed into this account, newest first.
 *
 * The list is only available while signed in, and an expired session simply
 * disappears from it — so a missing list means "offline", not "no devices".
 */
export async function listDeviceSessions(): Promise<DeviceSession[]> {
  try {
    const result = await request<{ sessions: DeviceSession[]; current: string }>('/api/auth/sessions');
    const current = result.current;
    return (result.sessions ?? []).map((session) => ({ ...session, current: session.id === current }));
  } catch (error) {
    if (error instanceof AuthError && error.code === 'unauthenticated') return [];
    throw error;
  }
}

/**
 * Sign one device out. The vault stays encrypted and untouched; the revoked
 * session simply stops being able to fetch it, and has to ask for the password
 * again.
 */
export async function revokeDeviceSession(id: string): Promise<void> {
  await request<{ ok: true }>('/api/auth/sessions', { method: 'DELETE', body: JSON.stringify({ id }) });
}

/** Sign every other device out, keeping this one. */
export async function revokeOtherDeviceSessions(): Promise<number> {
  const result = await request<{ ok: true; removed: number }>('/api/auth/sessions', {
    method: 'DELETE',
    body: JSON.stringify({ others: true }),
  });
  return result.removed;
}

/**
 * Finishes a password sign-in with a code from the authenticator app.
 *
 * Throws `totp_required` again when the code is wrong or already used, so the
 * caller can simply ask for another one.
 */
export async function completeTotpSignIn(code: string): Promise<ActiveSession> {
  const pending = pendingSecondFactor;
  if (!pending?.kek) throw new AuthError('unauthenticated', 'Start signing in again.');

  let result: LoginResponse;
  try {
    result = await request<LoginResponse>('/api/auth/totp/login', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim() }),
    });
  } catch (error) {
    if (error instanceof AuthError && error.code === 'bad_credentials') {
      throw new AuthError('totp_required', 'That code is not right, or has already been used. Wait for the next one.');
    }
    throw error;
  }
  // Spent either way: the challenge is single-use on the server.
  pendingSecondFactor = null;

  const raw = await unwrapKeyRaw(result.wrappedDek, pending.kek);
  if (pending.remember) await rememberOnDevice(result.user.id, raw);
  else {
    try {
      const last = getLastUserId();
      if (last && last !== result.user.id) await forgetDevice(last);
    } catch {}
  }
  const dekRaw = new Uint8Array(raw);
  const dek = await importDek(raw, false);
  active = { user: result.user, dek, dekRaw, vault: result.vault };
  persistAuth(result.user.id);
  return active;
}

/** Finishes a passkey sign-in with a code. The vault opens on the gate as usual. */
export async function completePasskeyTotpSignIn(code: string): Promise<void> {
  try {
    await request<LoginResponse>('/api/auth/totp/login', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim() }),
    });
  } catch (error) {
    if (error instanceof AuthError && error.code === 'bad_credentials') {
      throw new AuthError('totp_required', 'That code is not right, or has already been used. Wait for the next one.');
    }
    throw error;
  }
  pendingSecondFactor = null;
}

export interface TotpSetup {
  secret: string;
  formatted: string;
  uri: string;
  confirmed: boolean;
}

/** The account's authenticator app, if it has one. */
export async function fetchTotpStatus(): Promise<TotpSetup | null> {
  const result = await request<{ enrolled: boolean } & Partial<TotpSetup>>('/api/auth/totp/setup');
  if (!result.enrolled || !result.secret) return null;
  return {
    secret: result.secret,
    formatted: result.formatted ?? result.secret,
    uri: result.uri ?? '',
    confirmed: Boolean(result.confirmed),
  };
}

/** Issues a new secret. It does nothing until a code from it is accepted. */
export async function startTotpSetup(): Promise<TotpSetup> {
  return request<TotpSetup>('/api/auth/totp/setup', { method: 'POST' });
}

/** Proves the app is set up by accepting one code from it. */
export async function confirmTotpSetup(code: string): Promise<void> {
  try {
    await request<{ ok: true }>('/api/auth/totp/confirm', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim() }),
    });
  } catch (error) {
    if (error instanceof AuthError && error.code === 'bad_credentials') {
      throw new AuthError('totp_invalid', 'That code is not right, or has already been used. Wait for the next one.');
    }
    throw error;
  }
}

/** Turns the second step off. A current code is required. */
export async function disableTotp(code: string): Promise<void> {
  try {
    await request<{ ok: true }>('/api/auth/totp/disable', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim() }),
    });
  } catch (error) {
    if (error instanceof AuthError && error.code === 'bad_credentials') {
      throw new AuthError('totp_invalid', 'That code is not right, or has already been used. Wait for the next one.');
    }
    throw error;
  }
}

export interface ApiStatus {
  /** The server can see a database. */
  configured: boolean;
  /** `temporary` is the development/preview memory fallback: accounts work, but a restart forgets them. */
  storage?: 'database' | 'temporary' | 'none';
}

/**
 * Pre-flight check for the sign-in screens: is the accounts API reachable, and
 * does this server have a database? It throws the same classified AuthError as
 * every other call, so a hosting gate or a missing route can be named before
 * anyone types a password into a form that cannot possibly work.
 */
export async function fetchApiStatus(): Promise<ApiStatus> {
  return request<ApiStatus>('/api/auth/status', { method: 'GET' });
}

export async function deleteAccount(password: string): Promise<void> {
  const current = active;
  if (!current) throw new AuthError('unauthenticated', 'Unlock your account before deleting it.');
  if (!password) throw new AuthError('bad_credentials', 'Enter your password to continue.');
  const { kdfSalt } = await request<{ kdfSalt: string }>('/api/auth/salt', {
    method: 'POST',
    body: JSON.stringify({ username: current.user.username }),
  });
  const { authToken } = await deriveFromPassword(password, kdfSalt);
  await request<{ ok: true }>('/api/auth/account', {
    method: 'DELETE',
    body: JSON.stringify({ authToken }),
  });

  const userId = current.user.id;
  forget(current);
  active = null;
  clearPersistedAuth();
  try {
    await forgetDevice(userId);
  } catch {
    /* the account and server session are already gone */
  }
}

export async function signOut(): Promise<void> {
  const userId = active?.user.id ?? getLastUserId() ?? undefined;
  forget(active);
  active = null;
  clearPersistedAuth();
  try {
    await forgetDevice(userId);
  } catch {}
  try {
    await request<{ ok: true }>('/api/auth/logout', { method: 'POST' });
  } catch {
    /* the local session is already cleared */
  }
}

export async function pullVault(): Promise<{ version: number; ciphertext: string } | null> {
  try {
    const result = await request<VaultResponse>('/api/auth/vault');
    if (active) active = { ...active, vault: { version: result.version, ciphertext: result.ciphertext } };
    return { version: result.version, ciphertext: result.ciphertext };
  } catch (error) {
    if (error instanceof AuthError && error.code === 'unknown') return null;
    throw error;
  }
}

export async function pushVault(state: PlannerState): Promise<number | null> {
  if (!active) return null;
  const ciphertext = await encryptState(state, active.dek);
  const result = await request<VaultResponse>('/api/auth/vault', {
    method: 'PUT',
    body: JSON.stringify({ baseVersion: active.vault.version, ciphertext }),
  });
  active = { ...active, vault: { version: result.version, ciphertext: result.ciphertext } };
  return result.version;
}

export async function decryptVault(): Promise<PlannerState | null> {
  if (!active) return null;
  return decryptState(active.vault.ciphertext, active.dek);
}
