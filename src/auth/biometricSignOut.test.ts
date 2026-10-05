// @vitest-environment jsdom
/**
 * Signing out has to take the stored biometric unlock with it.
 *
 * The whole point of the feature is that the OS will hand the vault key back to
 * whoever passes the check on this phone. Leaving that behind after somebody
 * signs out would mean the next person holding the phone can open the previous
 * person's planner with a face that is already enrolled on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetBiometricKey } from './biometric';
import { getActiveSession } from './session';
import { signOut } from './vault';

const platform = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  hasKey: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  forget: vi.fn(),
}));

const device = vi.hoisted(() => ({
  forgetDevice: vi.fn(),
  getLastTrustedUserId: vi.fn(),
  recallFromDevice: vi.fn(),
  rememberOnDevice: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => platform }));
vi.mock('./device', () => device);

type ShellWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
const shell = window as ShellWindow;

beforeEach(() => {
  shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
  platform.forget.mockReset().mockResolvedValue(undefined);
  platform.read.mockReset().mockResolvedValue({ value: 'AAAA' });
  device.forgetDevice.mockReset().mockResolvedValue(undefined);
  device.getLastTrustedUserId.mockReset().mockReturnValue(null);
  device.recallFromDevice.mockReset().mockResolvedValue(null);
  device.rememberOnDevice.mockReset().mockResolvedValue(undefined);
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
});

afterEach(() => {
  delete shell.Capacitor;
  vi.unstubAllGlobals();
});

describe('signing out of a phone app', () => {
  it('removes the key the OS was holding for this device', async () => {
    await signOut();
    // The sign-out is layered — the app's own path and the session module both
    // drop the device cache, as they already did before this feature — and both
    // levels clear the platform store. The call is idempotent: deleting a key
    // that is not there is not an error.
    expect(platform.forget).toHaveBeenCalled();
    expect(getActiveSession()).toBeNull();
  });

  it('still ends the session when the platform store has nothing to drop', async () => {
    platform.forget.mockRejectedValue(new Error('no keychain'));
    await expect(signOut()).resolves.toBeUndefined();
    expect(getActiveSession()).toBeNull();
  });

  it('forgets quietly even outside the phone apps', async () => {
    delete shell.Capacitor;
    await expect(forgetBiometricKey()).resolves.toBeUndefined();
    expect(platform.forget).not.toHaveBeenCalled();
  });
});
