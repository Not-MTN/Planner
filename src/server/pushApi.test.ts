import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { handlePushConfig, handlePushDevice, handlePushDispatch, validDeviceRegistration } from './pushApi';

const IOS_CREDENTIALS = {
  APNS_KEY_P8: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  APNS_KEY_ID: 'ABC123',
  APNS_TEAM_ID: 'TEAM123',
  APNS_BUNDLE_ID: 'com.notmtn.planner',
};

const request = (path: string, headers: Record<string, string> = {}) => new Request(`https://planner.example${path}`, { headers: { Origin: 'https://planner.example', ...headers } });

describe('push API configuration and dispatch guard', () => {
  it('never publishes a push configuration as ready when deployment prerequisites are missing', async () => {
    const response = handlePushConfig(request('/api/push/config'), 'public', undefined, undefined, undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false, publicKey: null, transports: { web: false, device: false } });
  });

  it('requires the cron bearer secret before looking up or sending queued notifications', async () => {
    const response = await handlePushDispatch(request('/api/push/dispatch'), { CRON_SECRET: 'long-secret' });
    expect(response.status).toBe(401);
  });

  it('names each transport so a phone is not told to wait for Web Push keys', async () => {
    const response = handlePushConfig(request('/api/push/config'), undefined, undefined, 'postgres://localhost/planner', 'long-secret', IOS_CREDENTIALS);
    expect(await response.json()).toEqual({ configured: true, publicKey: null, transports: { web: false, device: true } });
  });

  it('reports both transports as unavailable when neither has credentials', async () => {
    const response = handlePushConfig(request('/api/push/config'), undefined, undefined, 'postgres://localhost/planner', 'long-secret', {});
    expect(await response.json()).toEqual({ configured: false, publicKey: null, transports: { web: false, device: false } });
  });
});

describe('device push registration', () => {
  it('is same-origin only, refuses other methods, and answers 503 until the deployment is configured', async () => {
    const crossOrigin = new Request('https://planner.example/api/push/device', { method: 'POST', headers: { Origin: 'https://elsewhere.example' } });
    expect((await handlePushDevice(crossOrigin, IOS_CREDENTIALS)).status).toBe(403);
    const wrongMethod = new Request('https://planner.example/api/push/device', { method: 'GET', headers: { Origin: 'https://planner.example' } });
    expect((await handlePushDevice(wrongMethod, IOS_CREDENTIALS)).status).toBe(405);
    const unconfigured = new Request('https://planner.example/api/push/device', { method: 'POST', headers: { Origin: 'https://planner.example' } });
    expect((await handlePushDevice(unconfigured, {})).status).toBe(503);
  });

  it('accepts an opaque token with its secret and rejects anything else', () => {
    expect(validDeviceRegistration({ platform: 'android', token: 'fcm-token-abcdefghijklmnop', secret: 'a'.repeat(43) })).toBe(true);
    expect(validDeviceRegistration({ platform: 'ios', token: 'a1b2c3d4e5f6a7b8c9d0', secret: 'x'.repeat(32) })).toBe(true);
    // Wrong platform, short token, short secret, or extra types are all refused.
    expect(validDeviceRegistration({ platform: 'web', token: 'fcm-token-abcdefghijklmnop', secret: 'a'.repeat(43) })).toBe(false);
    expect(validDeviceRegistration({ platform: 'android', token: 'short', secret: 'a'.repeat(43) })).toBe(false);
    expect(validDeviceRegistration({ platform: 'android', token: 'fcm-token-abcdefghijklmnop', secret: 'too-short' })).toBe(false);
    expect(validDeviceRegistration({ platform: 'android', token: 12, secret: 'a'.repeat(43) })).toBe(false);
    expect(validDeviceRegistration(null)).toBe(false);
  });
});
