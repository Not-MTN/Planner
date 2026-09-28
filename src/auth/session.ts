/**
 * Client for the account API. Holds the unlocked vault key in memory only —
 * never in storage — so a reload simply asks for the password again until the
 * trusted-device flow (phase 2) is built.
 */
import type { LoginResponse, PublicUser, SessionResponse, VaultResponse } from '../shared/authContract';
import { createVaultKeys, decryptState, deriveFromPassword, encryptState, formatRecoveryKey, importDek, unwrapKeyRaw } from './crypto';
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
  | 'unknown';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ActiveSession {
  user: PublicUser;
  /** Non-extractable AES-GCM key for the vault. Memory only. */
  dek: CryptoKey;
  vault: { version: number; ciphertext: string };
}

let active: ActiveSession | null = null;

export function getActiveSession(): ActiveSession | null {
  return active;
}

export function endSession(): void {
  active = null;
}

/** Adopts a session that was unlocked outside of signIn (device cache, unlock screen). */
export function adoptSession(user: PublicUser, dek: CryptoKey, vault: { version: number; ciphertext: string }): void {
  active = { user, dek, vault };
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new AuthError('network', 'Could not reach the server. Check your connection and try again.');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* fall through to the status check */
  }

  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: string } } | null)?.error;
    const code = (error?.code ?? 'unknown') as AuthErrorCode;
    const mapped: AuthErrorCode =
      code === 'taken' ? (error?.message?.toLowerCase().includes('email') ? 'email_taken' : 'taken') : code;
    throw new AuthError(mapped, error?.message ?? 'Something went wrong. Please try again.');
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
      wrappedDek,
      wrappedRecovery,
      ciphertext,
    }),
  });

  active = { user: result.user, dek, vault: { version: 1, ciphertext } };
  // This is the device they signed up on, so open straight into the planner.
  if (input.remember !== false) await rememberOnDevice(result.user.id, dekRaw);
  dekRaw.fill(0);
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
  const dek = await importDek(raw, false);
  raw.fill(0);
  active = { user: result.user, dek, vault: result.vault };
  return active;
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

export async function signOut(): Promise<void> {
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
