// @vitest-environment jsdom
/**
 * The bridge between the app and the platform's own biometric check.
 *
 * Two rules are worth a test each: on the web nothing here touches a platform
 * store (there is none), and a failure the person did not cause — a key the OS
 * has thrown away because the enrolled face changed — has to arrive as
 * `invalidated`, not as a generic error the screen would answer with "try
 * again".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BiometricError,
  biometricAvailability,
  biometricEnrolled,
  biometricPlatform,
  biometricShell,
  forgetBiometricKey,
  readBiometricKey,
  saveBiometricKey,
} from './biometric';
import { fromBase64, toBase64 } from './crypto';

const platform = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  hasKey: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  forget: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => platform }));

type ShellWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
const shell = window as ShellWindow;

const KEY = new Uint8Array([7, 8, 9, 10]);

beforeEach(() => {
  platform.isAvailable.mockReset().mockResolvedValue({ available: true, kind: 'fingerprint' });
  platform.hasKey.mockReset().mockResolvedValue({ present: false });
  platform.save.mockReset().mockResolvedValue(undefined);
  platform.read.mockReset().mockResolvedValue({ value: toBase64(KEY) });
  platform.forget.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  delete shell.Capacitor;
});

describe('outside the phone apps', () => {
  it('is a quiet no-op rather than a promise the browser cannot keep', async () => {
    expect(biometricShell()).toBe(false);
    await expect(biometricAvailability()).resolves.toEqual({ available: false, kind: 'biometrics' });
    await expect(biometricEnrolled()).resolves.toBe(false);
    await expect(saveBiometricKey(KEY)).rejects.toBeInstanceOf(BiometricError);
    await expect(readBiometricKey()).rejects.toMatchObject({ code: 'unsupported' });
    await expect(forgetBiometricKey()).resolves.toBeUndefined();
    expect(platform.save).not.toHaveBeenCalled();
    expect(platform.read).not.toHaveBeenCalled();
    expect(platform.forget).not.toHaveBeenCalled();
  });
});

describe('inside a phone app', () => {
  beforeEach(() => {
    shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
  });

  it('reports what the device calls its check, without asking anyone to prove it', async () => {
    await expect(biometricAvailability()).resolves.toEqual({ available: true, kind: 'fingerprint' });
    expect(biometricPlatform()).toBe('android');

    platform.isAvailable.mockResolvedValue({ available: true, kind: 'face' });
    await expect(biometricAvailability()).resolves.toEqual({ available: true, kind: 'face' });

    // A device that answers with something unexpected is still a device that
    // can do it; the plain word is better than no row at all.
    platform.isAvailable.mockResolvedValue({ available: true, kind: 'sonic' });
    await expect(biometricAvailability()).resolves.toEqual({ available: true, kind: 'biometrics' });
  });

  it('treats a plugin that is not there as a device that cannot do it', async () => {
    platform.isAvailable.mockRejectedValue(Object.assign(new Error('not implemented'), { code: 'notImplemented' }));
    await expect(biometricAvailability()).resolves.toEqual({ available: false, kind: 'biometrics' });
    platform.hasKey.mockRejectedValue(new Error('no keychain'));
    await expect(biometricEnrolled()).resolves.toBe(false);
  });

  it('hands the vault key over as base64, and reads the same bytes back', async () => {
    await saveBiometricKey(KEY, 'Confirm it is you');
    expect(platform.save).toHaveBeenCalledWith({ value: toBase64(KEY), reason: 'Confirm it is you' });

    const read = await readBiometricKey('Unlock your planner');
    expect(platform.read).toHaveBeenCalledWith({ reason: 'Unlock your planner' });
    expect(Array.from(read)).toEqual(Array.from(KEY));
    expect(read.buffer.byteLength).toBe(KEY.buffer.byteLength);
  });

  it('reports a missing value as a key the OS has thrown away', async () => {
    platform.read.mockResolvedValue({});
    await expect(readBiometricKey()).rejects.toMatchObject({ code: 'invalidated' });
  });

  it('keeps the difference between "they changed their mind" and "the key is gone"', async () => {
    platform.read.mockRejectedValue(Object.assign(new Error('cancelled'), { code: 'userCancel' }));
    await expect(readBiometricKey()).rejects.toMatchObject({ code: 'cancelled' });

    platform.read.mockRejectedValue(Object.assign(new Error('gone'), { code: 'keyInvalidated' }));
    await expect(readBiometricKey()).rejects.toMatchObject({ code: 'invalidated' });

    platform.read.mockRejectedValue(Object.assign(new Error('no hardware'), { code: 'notEnrolled' }));
    await expect(readBiometricKey()).rejects.toMatchObject({ code: 'unavailable' });

    platform.read.mockRejectedValue(new Error('something else'));
    await expect(readBiometricKey()).rejects.toMatchObject({ code: 'failed' });
  });

  it('lets forgetting fail silently — there may be nothing left to forget', async () => {
    platform.forget.mockRejectedValue(new Error('no keychain'));
    await expect(forgetBiometricKey()).resolves.toBeUndefined();
    expect(platform.forget).toHaveBeenCalledTimes(1);
  });

  it('keeps the platform wording when it has one', async () => {
    platform.read.mockRejectedValue(Object.assign(new Error('Unlock cancelled.'), { code: 'userCancel' }));
    await expect(readBiometricKey()).rejects.toThrow('Unlock cancelled.');
  });

  it('round-trips the base64 it stores', () => {
    expect(Array.from(fromBase64(toBase64(KEY)))).toEqual(Array.from(KEY));
  });
});
