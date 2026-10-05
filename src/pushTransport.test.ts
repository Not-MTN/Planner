// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { backgroundPushSupported, pushTransport } from './push';

interface CapacitorWindow extends Window {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
}

function asShell(platform: 'android' | 'ios' | 'web'): void {
  (window as CapacitorWindow).Capacitor = {
    isNativePlatform: () => platform !== 'web',
    getPlatform: () => platform,
  };
}

afterEach(() => {
  delete (window as CapacitorWindow).Capacitor;
});

describe('background push transport', () => {
  it('uses Web Push in a browser tab and the device service inside a phone app', () => {
    expect(pushTransport()).toBe('web');
    expect(backgroundPushSupported()).toBe(false); // jsdom has no service worker or PushManager

    asShell('android');
    expect(pushTransport()).toBe('device');
    expect(backgroundPushSupported()).toBe(true);

    asShell('ios');
    expect(pushTransport()).toBe('device');
    expect(backgroundPushSupported()).toBe(true);
  });
});
