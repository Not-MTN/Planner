/**
 * Client for the account API. Holds the unlocked vault key in memory only —
 * never in storage — so a reload simply asks for the password again until the
 * trusted-device flow (phase 2) is built.
 */
import type { LoginResponse, PublicUser, SessionResponse, VaultResponse } from '../shared/authContract';
import {
  createVaultKeys,
  decryptState,
  deriveFromPassword,
  encryptState,
  formatRecoveryKey,
  hashRecoveryKey,
  importDek,
  keyFromRecovery,
  newSalt,
  normalizeRecoveryKey,
  unwrapKeyRaw,
  wrapRawKey,
} from './crypto';
import { rememberOnDevice } from './device';
import type { PlannerState } from '../types';

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
  if (looksLikeGate(raw)) return 'deployment_gate';
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  // A 404 with nothing in it, or the app's own HTML shell, means the route is
  // not served here — a platform answer, not one of our handlers.
  if (response.status === 404 || type.includes('text/html')) return 'api_missing';
  return 'unknown';
}

function unexpectedMessage(code: AuthErrorCode, response: Response): string {
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

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      // A hosting sign-in page answers with a redirect. Keeping it manual means
      // the browser hands us an opaque redirect we can name, instead of a CORS
      // failure that looks exactly like a dead connection.
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new AuthError('network', 'Could not reach the server. Check your connection and try again.');
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

export async function signUp(input: SignUpInput): Promise<{ recoveryKey: string; session: ActiveSession }> {
  const recoveryKey = formatRecoveryKey();
  const recoveryHash = hashRecoveryKey(recoveryKey);
  const { salt, authToken, dek, dekRaw, wrappedDek, wrappedRecovery } = await createVaultKeys(input.password, recoveryKey);
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
      recoveryHash,
      wrappedDek,
      wrappedRecovery,
      ciphertext,
    }),
  });

  active = { user: result.user, dek, dekRaw, vault: { version: 1, ciphertext } };
  // This is the device they signed up on, so open straight into the planner.
  if (input.remember !== false) await rememberOnDevice(result.user.id, dekRaw);
  return { recoveryKey, session: active };
}

export async function signIn(identifier: string, password: string, remember = true): Promise<ActiveSession> {
  // The salt is stored with the account, so fetch it before stretching. Unknown
  // accounts receive a decoy salt and simply fail the next step.
  const { kdfSalt } = await request<{ kdfSalt: string }>('/api/auth/salt', {
    method: 'POST',
    body: JSON.stringify({ username: identifier.trim() }),
  });
  const { authToken, kek } = await deriveFromPassword(password, kdfSalt);

  const result = await request<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: identifier.trim(), authToken }),
  });

  const raw = await unwrapKeyRaw(result.wrappedDek, kek);
  if (remember) await rememberOnDevice(result.user.id, raw);
  // importDek clears its copy; keep one for passkey enrolment on this page.
  const dekRaw = new Uint8Array(raw);
  const dek = await importDek(raw, false);
  active = { user: result.user, dek, dekRaw, vault: result.vault };
  return active;
}

/**
 * Change a forgotten password using the recovery key. The vault key is unwrapped
 * and re-wrapped in this browser; only its encrypted copies and one-way recovery
 * verifier are sent to the server.
 */
export async function resetPasswordWithRecovery(
  identifier: string,
  recoveryKeyInput: string,
  newPassword: string,
): Promise<string> {
  const identifierValue = identifier.trim();
  const recoveryKey = normalizeRecoveryKey(recoveryKeyInput);
  if (!identifierValue || !recoveryKey) {
    throw new AuthError('bad_credentials', 'Wrong username or recovery key.');
  }

  const { kdfSalt: oldSalt, wrappedRecovery: oldWrappedRecovery } = await request<{ kdfSalt: string; wrappedRecovery: string }>(
    '/api/auth/recovery/start',
    { method: 'POST', body: JSON.stringify({ username: identifierValue }) },
  );

  let raw: Uint8Array<ArrayBuffer> | null = null;
  try {
    const oldRecoveryKek = await keyFromRecovery(recoveryKey, oldSalt);
    try {
      raw = await unwrapKeyRaw(oldWrappedRecovery, oldRecoveryKek);
    } catch {
      // The endpoint deliberately returns a decoy for unknown accounts. Keep
      // the same message for an unknown identifier and a wrong recovery key.
      throw new AuthError('bad_credentials', 'Wrong username or recovery key.');
    }

    const salt = newSalt();
    const { authToken, kek } = await deriveFromPassword(newPassword, salt);
    const nextRecoveryKey = formatRecoveryKey();
    const recoveryHash = hashRecoveryKey(recoveryKey);
    const nextRecoveryHash = hashRecoveryKey(nextRecoveryKey);
    const wrappedDek = await wrapRawKey(raw, kek);
    const nextRecoveryKek = await keyFromRecovery(nextRecoveryKey, salt);
    const wrappedRecovery = await wrapRawKey(raw, nextRecoveryKek);

    await request<{ ok: true }>('/api/auth/recovery/complete', {
      method: 'POST',
      body: JSON.stringify({
        username: identifierValue,
        recoveryHash,
        newRecoveryHash: nextRecoveryHash,
        kdfSalt: salt,
        authToken,
        wrappedDek,
        wrappedRecovery,
      }),
    });
    endSession();
    return nextRecoveryKey;
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
    return result.user;
  } catch (error) {
    if (error instanceof AuthError && error.code === 'unauthenticated') return null;
    throw error;
  }
}

/**
 * Pre-flight check for the sign-in screens: is the accounts API reachable, and
 * does this server have a database? It throws the same classified AuthError as
 * every other call, so a hosting gate or a missing route can be named before
 * anyone types a password into a form that cannot possibly work.
 */
export async function fetchApiStatus(): Promise<{ configured: boolean }> {
  return request<{ configured: boolean }>('/api/auth/status', { method: 'GET' });
}

export async function signOut(): Promise<void> {
  forget(active);
  active = null;
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
