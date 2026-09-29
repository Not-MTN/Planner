/**
 * Vault session for the planner: boot, unlock, and the debounced save back to
 * the server.
 *
 * When someone is signed in, their vault is the source of truth. The browser
 * copy (localStorage/IndexedDB) keeps working underneath so the app still opens
 * and edits offline, but the vault is what other devices read.
 */
import { decryptState, deriveFromPassword, importDek, unwrapKeyRaw, VaultError } from './crypto';
import {
  adoptSession,
  AuthError,
  endSession,
  fetchSession,
  getActiveSession,
  pullVault,
  pushVault,
  request,
  signOut as apiSignOut,
} from './session';
import { forgetDevice, recallFromDevice, rememberOnDevice } from './device';
import { mergeStates } from '../sync';
import type { PlannerState } from '../types';
import type { PublicUser } from '../shared/authContract';

export type AccountBoot =
  | { status: 'signed-out' }
  | { status: 'locked'; user: PublicUser }
  | { status: 'ready'; user: PublicUser; state: PlannerState; version: number };

export function unlockedUser(): PublicUser | null {
  return getActiveSession()?.user ?? null;
}

export function isUnlocked(): boolean {
  return getActiveSession() !== null;
}

export function lock(): void {
  endSession();
}

/** Signs out: ends the server session, drops the key, clears the device cache. */
export async function signOut(): Promise<void> {
  const userId = getActiveSession()?.user.id;
  endSession();
  await forgetDevice(userId);
  await apiSignOut();
}

/**
 * Decides what to show on boot: straight into the planner if this device was
 * trusted, the unlock screen if we know who they are but not their key, or the
 * sign-in page.
 */
export async function bootAccount(): Promise<AccountBoot> {
  const user = await fetchSession();
  if (!user) return { status: 'signed-out' };

  const cached = await recallFromDevice(user.id);
  if (!cached) return { status: 'locked', user };

  const vault = await pullVault();
  if (!vault) return { status: 'locked', user };

  try {
    const state = await decryptState(vault.ciphertext, cached.dek);
    adoptSession(user, cached.dek, { version: vault.version, ciphertext: vault.ciphertext }, cached.raw);
    return { status: 'ready', user, state, version: vault.version };
  } catch {
    // The cached key no longer opens the vault (password changed elsewhere).
    await forgetDevice(user.id);
    return { status: 'locked', user };
  }
}

/** Verifies the password and opens the vault, optionally trusting this device. */
export async function unlockWithPassword(password: string, remember: boolean): Promise<AccountBoot> {
  const session = await fetchSession();
  if (!session) return { status: 'signed-out' };

  const { kdfSalt } = await request<{ kdfSalt: string }>('/api/auth/salt', {
    method: 'POST',
    body: JSON.stringify({ username: session.username }),
  });
  const { authToken, kek } = await deriveFromPassword(password, kdfSalt);
  const result = await request<{ wrappedDek: string; vault: { version: number; ciphertext: string } }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: session.username, authToken }),
  });

  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = await unwrapKeyRaw(result.wrappedDek, kek);
  } catch {
    throw new AuthError('bad_credentials', 'That password did not unlock this planner.');
  }

  if (remember) await rememberOnDevice(session.id, raw);
  // importDek clears its copy; keep one for passkey enrolment on this page.
  const dekRaw = new Uint8Array(raw);
  const dek = await importDek(raw, false);
  const state = await decryptState(result.vault.ciphertext, dek).catch(() => {
    throw new VaultError('That vault could not be opened.');
  });

  adoptSession(session, dek, { version: result.vault.version, ciphertext: result.vault.ciphertext }, dekRaw);
  return { status: 'ready', user: session, state, version: result.vault.version };
}

/* --------------------------------------------------------------- saving back */

const DEBOUNCE_MS = 2_500;
const MAX_WAIT_MS = 20_000;
let timer: number | null = null;
let pending: PlannerState | null = null;
let queuedAt = 0;

/** Called on every planner change; writes are batched so typing does not spam. */
export function scheduleVaultPush(state: PlannerState): void {
  if (!getActiveSession()) return;
  pending = state;
  const now = Date.now();
  if (!queuedAt) queuedAt = now;
  if (timer !== null) window.clearTimeout(timer);
  const wait = Math.max(0, Math.min(DEBOUNCE_MS, queuedAt + MAX_WAIT_MS - now));
  timer = window.setTimeout(() => void flushVaultPush(), wait);
}

export async function flushVaultPush(): Promise<void> {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const state = pending;
  pending = null;
  queuedAt = 0;
  if (!getActiveSession() || !state) return;
  await writeVault(state);
}

async function writeVault(state: PlannerState): Promise<void> {
  const session = getActiveSession();
  if (!session) return;
  try {
    await pushVault(state);
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== 'conflict') return;
    // Another device got there first: merge by id using the same rule as sync,
    // then write the merged copy back.
    const remote = await pullVault();
    if (!remote) return;
    try {
      const merged = mergeStates(state, await decryptState(remote.ciphertext, session.dek));
      await pushVault(merged);
    } catch {
      /* leave it for the next save */
    }
  }
}

/** True when the planner should keep using the browser copy instead of a vault. */
export function usesVault(): boolean {
  return getActiveSession() !== null;
}
