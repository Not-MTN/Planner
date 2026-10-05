// @vitest-environment jsdom
/**
 * The settings row that turns biometric unlock on and off.
 *
 * What matters here is not the switch itself but what turning it on does: it
 * hands the vault key to the platform, and it takes the *other* fast way in
 * away. A phone that keeps opening the planner silently would make the row a
 * lie, so `forgetDevice` has to be called with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BiometricSetting } from './BiometricSetting';
import { toBase64 } from '../auth/crypto';

const platform = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  hasKey: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  forget: vi.fn(),
}));

const app = vi.hoisted(() => ({
  flash: vi.fn(),
  getActiveSession: vi.fn(),
  accountUser: vi.fn(),
  forgetDevice: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => platform }));
vi.mock('../context', () => ({ usePlanner: () => ({ flash: app.flash }) }));
vi.mock('../auth/session', () => ({ getActiveSession: app.getActiveSession }));
vi.mock('../auth/vault', () => ({ accountUser: app.accountUser }));
vi.mock('../auth/device', () => ({ forgetDevice: app.forgetDevice }));

type ShellWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
const shell = window as ShellWindow;
const KEY = new Uint8Array([5, 4, 3, 2, 1]);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const switchButton = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('button[role="switch"]');

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <StrictMode>
        <BiometricSetting />
      </StrictMode>,
    );
  });
  await settle();
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function clickSwitch(): Promise<void> {
  const button = switchButton();
  if (!button) throw new Error('No biometric switch on screen');
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  platform.isAvailable.mockReset().mockResolvedValue({ available: true, kind: 'face' });
  platform.hasKey.mockReset().mockResolvedValue({ present: false });
  platform.save.mockReset().mockResolvedValue(undefined);
  platform.read.mockReset().mockResolvedValue({ value: toBase64(KEY) });
  platform.forget.mockReset().mockResolvedValue(undefined);
  app.flash.mockReset();
  app.getActiveSession.mockReset().mockReturnValue({ dekRaw: KEY });
  app.accountUser.mockReset().mockReturnValue({ id: 'user-1' });
  app.forgetDevice.mockReset().mockResolvedValue(undefined);
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  delete shell.Capacitor;
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

describe('the biometric unlock row', () => {
  it('is not there in a browser tab', async () => {
    await mount();
    expect(document.body.textContent?.trim()).toBe('');
    expect(switchButton()).toBeNull();
  });

  it('is not there on a device without the hardware', async () => {
    shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    platform.isAvailable.mockResolvedValue({ available: false, kind: 'biometrics' });
    await mount();
    expect(switchButton()).toBeNull();
  });

  it('turns on by handing the vault key over and disarming the silent copy', async () => {
    shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    await mount();
    expect(document.body.textContent).toContain('Face ID');
    expect(switchButton()?.getAttribute('aria-checked')).toBe('false');
    expect(switchButton()?.textContent).toContain('Off');

    await clickSwitch();

    expect(platform.save).toHaveBeenCalledWith({ value: toBase64(KEY), reason: 'Confirm it is you' });
    // The silent "keep this device signed in" copy is what this replaces.
    expect(app.forgetDevice).toHaveBeenCalledWith('user-1');
    expect(switchButton()?.getAttribute('aria-checked')).toBe('true');
    expect(switchButton()?.textContent).toContain('On');
    expect(app.flash).toHaveBeenCalledWith('Turned on for this device.');
  });

  it('says nothing about the platform when there is no key in memory yet', async () => {
    shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    app.getActiveSession.mockReturnValue(null);
    await mount();

    await clickSwitch();

    expect(platform.save).not.toHaveBeenCalled();
    expect(app.flash).toHaveBeenCalledWith('Unlock with your password once, then turn this on.');
    expect(switchButton()?.getAttribute('aria-checked')).toBe('false');
  });

  it('turns off by dropping the stored key', async () => {
    shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    platform.hasKey.mockResolvedValue({ present: true });
    await mount();
    expect(switchButton()?.getAttribute('aria-checked')).toBe('true');

    await clickSwitch();

    expect(platform.forget).toHaveBeenCalledTimes(1);
    expect(switchButton()?.getAttribute('aria-checked')).toBe('false');
    expect(app.flash).toHaveBeenCalledWith('Turned off for this device.');
  });
});
