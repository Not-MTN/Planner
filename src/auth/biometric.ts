/**
 * Opening the vault with a face or a fingerprint instead of a password.
 *
 * The password path asks the server for the wrapped key and unwraps it in the
 * browser. There is no such thing to unwrap with a fingerprint, so this takes
 * the other route: the vault key itself is handed to the operating system's
 * protected storage — the Android Keystore, the iOS Keychain — where it can
 * only be read back after the platform's own biometric check. Nothing about the
 * key is stored by Planner, and on the web there is no such storage to use, so
 * every function here is a no-op outside the phone apps. (`docs/APPS.md` §9.)
 *
 * Two rules shape the code below:
 *
 *   1. A capability check never prompts and never throws. Asking whether a
 *      device *could* do this is not asking the person to do it, and a device
 *      without a fingerprint sensor is an ordinary device.
 *   2. Anything that fails tells the caller which failure it was — cancelled,
 *      unavailable, or a key the OS has thrown away because the fingerprints
 *      changed. The last one needs a different sentence on screen, because
 *      "try again" would be wrong advice.
 */
import { registerPlugin } from '@capacitor/core';
import { t } from '../i18n';
import { fromBase64, toBase64 } from './crypto';
import { isNativeMobileShell, shellPlatform } from '../shared/nativeShell';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'biometrics';

export interface BiometricAvailability {
  /** The device has the hardware and somebody enrolled in it. */
  available: boolean;
  /** What to call it on screen: Face ID, a fingerprint, or the plain word. */
  kind: BiometricKind;
}

export type BiometricFailure = 'unsupported' | 'unavailable' | 'cancelled' | 'invalidated' | 'failed';

export class BiometricError extends Error {
  readonly code: BiometricFailure;
  constructor(code: BiometricFailure, message: string) {
    super(message);
    this.code = code;
  }
}

/** The shape of the native plugin; see android/…/PlannerBiometricPlugin.java. */
interface PlannerBiometricPlugin {
  isAvailable(): Promise<{ available?: boolean; kind?: string }>;
  hasKey(): Promise<{ present?: boolean }>;
  save(options: { value: string; reason?: string }): Promise<void>;
  read(options?: { reason?: string }): Promise<{ value?: string }>;
  forget(): Promise<void>;
}

const native = registerPlugin<PlannerBiometricPlugin>('PlannerBiometric');

function kindOf(value: string | undefined): BiometricKind {
  if (value === 'face' || value === 'fingerprint' || value === 'iris') return value;
  return 'biometrics';
}

/** What to call the platform's check in a sentence: Face ID, a fingerprint… */
export function biometricKindLabel(kind: BiometricKind): string {
  if (kind === 'face') return t('Face ID');
  if (kind === 'fingerprint') return t('your fingerprint');
  return t('biometrics');
}

/** True when this build could have biometric unlock at all. */
export function biometricShell(): boolean {
  return isNativeMobileShell();
}

/**
 * Whether this device can offer it, and what to call it. Never prompts: the
 * platform reports whether hardware is present and enrolled without asking
 * anyone to prove who they are.
 */
export async function biometricAvailability(): Promise<BiometricAvailability> {
  if (!biometricShell()) return { available: false, kind: 'biometrics' };
  try {
    const result = await native.isAvailable();
    return { available: result?.available === true, kind: kindOf(result?.kind) };
  } catch {
    // No plugin in this build (an older shell, or the desktop app): not an
    // error, just a device that does not have the feature.
    return { available: false, kind: 'biometrics' };
  }
}

/** True when a key for this account is already stored behind the biometric check. */
export async function biometricEnrolled(): Promise<boolean> {
  if (!biometricShell()) return false;
  try {
    const result = await native.hasKey();
    return result?.present === true;
  } catch {
    return false;
  }
}

/**
 * Hand the vault key to the OS. This is the one call that writes it anywhere:
 * everything else in the app keeps it in memory, and the OS store is the only
 * place it is meant to survive a reload — behind a check the OS performs.
 */
export async function saveBiometricKey(raw: Uint8Array, reason?: string): Promise<void> {
  if (!biometricShell()) throw new BiometricError('unsupported', 'This device cannot unlock with biometrics.');
  try {
    await native.save({ value: toBase64(raw), reason });
  } catch (caught) {
    throw new BiometricError('failed', messageOf(caught, 'That could not be turned on just now.'));
  }
}

/** Reads the key back, which is what makes the platform ask for a face or a finger. */
export async function readBiometricKey(reason?: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!biometricShell()) throw new BiometricError('unsupported', 'This device cannot unlock with biometrics.');
  let value: string | undefined;
  try {
    value = (await native.read({ reason }))?.value;
  } catch (caught) {
    throw new BiometricError(classify(caught), messageOf(caught, 'That did not unlock your planner.'));
  }
  if (!value) throw new BiometricError('invalidated', 'The saved unlock is no longer on this device.');
  return fromBase64(value);
}

/** Drops the stored key: turning the setting off, or signing out. */
export async function forgetBiometricKey(): Promise<void> {
  if (!biometricShell()) return;
  try {
    await native.forget();
  } catch {
    /* nothing stored, or nothing to store it in */
  }
}

/**
 * Which failure this was, from whatever the plugin threw.
 *
 * The distinction that matters is `invalidated`: the OS deletes the stored key
 * when the enrolled fingerprints or face change, and that is not something
 * retrying can fix. The plugin reports it by code; a call that never reached a
 * plugin (no biometric plugin in this build) is `unsupported` instead.
 */
function classify(caught: unknown): BiometricFailure {
  const code = (caught as { code?: unknown })?.code;
  if (typeof code === 'string') {
    if (code === 'cancelled' || code === 'userCancel' || code === 'systemCancel' || code === 'appCancel') return 'cancelled';
    if (code === 'invalidated' || code === 'keyInvalidated') return 'invalidated';
    if (code === 'unavailable' || code === 'notAvailable' || code === 'notEnrolled') return 'unavailable';
    if (code === 'unsupported' || code === 'notImplemented') return 'unsupported';
  }
  if (caught instanceof Error && /not implemented/i.test(caught.message)) return 'unsupported';
  return 'failed';
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/** For diagnostics and the settings hint: which platform this is running on. */
export function biometricPlatform(): string {
  return shellPlatform();
}
