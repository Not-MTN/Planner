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
  getLastUserId,
  pullVault,
  pushVault,
  request,
  signOut as apiSignOut,
} from './session';
import { forgetDevice, getLastTrustedUserId, recallFromDevice, rememberOnDevice } from './device';
import { BiometricError, forgetBiometricKey, readBiometricKey } from './biometric';
import { mergeStates } from '../sync';
import type { PlannerState } from '../types';
import type { PublicUser } from '../shared/authContract';

export type AccountBoot =
  | { status: 'signed-out' }
  | { status: 'locked'; user: PublicUser }
  | { status: 'ready'; user: PublicUser; state: PlannerState; version: number }
  | { status: 'offline-trusted'; userId: string };

const LAST_USER_INFO_KEY = 'planner-last-user-info';

function storeLastUserInfo(user: PublicUser): void {
  try {
    localStorage.setItem(LAST_USER_INFO_KEY, JSON.stringify(user));
  } catch {}
}

function loadLastUserInfo(): PublicUser | null {
  try {
    const raw = localStorage.getItem(LAST_USER_INFO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublicUser;
    if (parsed && typeof parsed.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}
/**
 * Who this device belongs to, even when the vault key is not in memory right
 * now (offline boot, trusted-device boot): the live session first, then the
 * user info stored on the last sign-in. The shell uses it for the account chip
 * and to decide whether "Log out" is worth showing.
 */
export function accountUser(): PublicUser | null {
  return getActiveSession()?.user ?? loadLastUserInfo();
}

export function forgetAccountUser(): void {
  try {
    localStorage.removeItem(LAST_USER_INFO_KEY);
  } catch {}
}
export function lock(): void {
  endSession();
}

/** Signs out: ends the server session, drops the key, clears the device cache. */
export async function signOut(): Promise<void> {
  const userId = getActiveSession()?.user.id ?? getLastUserId() ?? undefined;
  endSession();
  // Signing out means the next person to pick up this phone cannot open the
  // planner with a face that is already enrolled on it.
  await forgetBiometricKey();
  await forgetDevice(userId);
  try {
    localStorage.removeItem(LAST_USER_INFO_KEY);
  } catch {}
  await apiSignOut();
}

/**
 * Decides what to show on boot: straight into the planner if this device was
 * trusted, the unlock screen if we know who they are but not their key, or the
 * sign-in page.
 *
 * New behavior: if the server session is gone but this device was trusted before,
 * we still open the planner with the local copy (offline-trusted) instead of forcing
 * a full sign-in. The user keeps working; sync will resume once they re-authenticate.
 */
export async function bootAccount(): Promise<AccountBoot> {
  let user: PublicUser | null = null;
  try {
    user = await fetchSession();
    if (user) storeLastUserInfo(user);
  } catch (err) {
    // Network failure: keep using local copy (offline). If we have a trusted device,
    // we can still try to open with cached key later, but for now treat as offline.
    if (err instanceof AuthError && err.code === 'network') throw err;
    // Deployment gate, missing API, not configured — these are blocking errors that
    // must be shown to the user, not swallowed as signed-out.
    if (
      err instanceof AuthError &&
      (err.code === 'deployment_gate' ||
        err.code === 'api_missing' ||
        err.code === 'not_configured' ||
        err.code === 'local_only_build' ||
        // The server is there and refusing this app's origin. Falling through
        // would land on a sign-in page whose calls are refused the same way.
        err.code === 'origin_refused')
    ) {
      throw err;
    }
    // Other errors: fall through to trusted-device check
    user = null;
  }

  if (!user) {
    // No active session cookie. Check if this device was trusted before.
    const lastId = (await getLastTrustedUserId()) ?? getLastUserId();
    if (lastId) {
      const cached = await recallFromDevice(lastId);
      if (cached) {
        // Try to pull vault — if it works, we have a fresh session via cookie somehow restored
        try {
          const vault = await pullVault();
          if (vault) {
            const storedUser = loadLastUserInfo();
            // If we have stored user info, use it; otherwise create a minimal user shell
            const effectiveUser: PublicUser = storedUser ?? {
              id: lastId,
              username: 'user',
              email: null,
              displayName: 'Planner',
              role: 'personal',
              createdAt: new Date().toISOString(),
            };
            try {
              const state = await decryptState(vault.ciphertext, cached.dek);
              adoptSession(effectiveUser, cached.dek, { version: vault.version, ciphertext: vault.ciphertext }, cached.raw);
              return { status: 'ready', user: effectiveUser, state, version: vault.version };
            } catch {
              // Cached key invalid, fall through to locked if we have user info
              if (storedUser) return { status: 'locked', user: storedUser };
            }
          }
        } catch {
          // pullVault failed (likely unauthenticated). If we have cached key, allow offline-trusted
          const storedUser = loadLastUserInfo();
          if (storedUser) {
            // We have user info and cached key, but no session — allow offline with local data
            // The AccountGate will treat this as offline and show the app with local copy
            // But we can attempt to adopt session with cached dek and a placeholder vault version 0
            // so future pushes will trigger re-auth
            try {
              // We don't have vault ciphertext offline, so just return offline-trusted
              return { status: 'offline-trusted', userId: lastId };
            } catch {}
          }
          // Even without stored user info, if we have a trusted device, don't force sign-in
          return { status: 'offline-trusted', userId: lastId };
        }
        // If we got here, cached exists but vault pull didn't work and we have no stored user info
        const storedUser = loadLastUserInfo();
        if (storedUser) return { status: 'locked', user: storedUser };
      }
    }
    return { status: 'signed-out' };
  }

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

/**
 * Opens the vault with the key the operating system has been holding behind a
 * face or a fingerprint. No password, and no wrapped copy from the server: the
 * platform store holds the vault key itself, so the server only supplies the
 * ciphertext it always did.
 *
 * Failure is told apart rather than flattened. A cancelled prompt leaves
 * everything as it was; a key the OS has thrown away (the enrolled fingers or
 * face changed) is deleted here, because it can never work again and a retry
 * would only fail the same way.
 */
export async function unlockWithBiometrics(reason?: string): Promise<AccountBoot> {
  const session = await fetchSession();
  if (!session) return { status: 'signed-out' };

  // This is the call that asks the device to identify its owner.
  const raw = await readBiometricKey(reason);
  try {
    const vault = await pullVault();
    if (!vault) {
      throw new BiometricError('failed', 'Your planner could not be opened on this device. Use your password instead.');
    }
    // importDek clears its copy; keep one for passkey enrolment on this page.
    const dekRaw = new Uint8Array(raw);
    const dek = await importDek(raw, false);
    const state = await decryptState(vault.ciphertext, dek).catch(async () => {
      // The vault no longer opens with this key — the password was changed,
      // which makes a new one. Keeping it would fail identically next time.
      await forgetBiometricKey();
      throw new BiometricError('invalidated', 'This device\u2019s saved unlock is out of date. Enter your password once to turn it on again.');
    });
    adoptSession(session, dek, { version: vault.version, ciphertext: vault.ciphertext }, dekRaw);
    return { status: 'ready', user: session, state, version: vault.version };
  } finally {
    raw.fill(0);
  }
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
