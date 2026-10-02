// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl, configuredApiOrigin, hasConfiguredApi, installApiOriginShim, isNativeShell, shellPlatform } from './nativeShell';

type ShellWindow = Window & {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  plannerDesktop?: { version?: string };
};

const shell = window as ShellWindow;
const API = 'https://planner.example.com';

afterEach(() => {
  delete shell.Capacitor;
  delete shell.plannerDesktop;
});

describe('shell detection', () => {
  it('is a browser tab by default', () => {
    expect(isNativeShell()).toBe(false);
    expect(shellPlatform()).toBe('web');
  });

  it('recognises a Capacitor shell and which one it is', () => {
    shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    expect(isNativeShell()).toBe(true);
    expect(shellPlatform()).toBe('android');
    shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    expect(shellPlatform()).toBe('ios');
  });

  it('recognises the desktop build', () => {
    shell.plannerDesktop = { version: '1.0.0' };
    expect(isNativeShell()).toBe(true);
    expect(shellPlatform()).toBe('desktop');
  });

  it('never throws when a shell stub misbehaves', () => {
    shell.Capacitor = {
      isNativePlatform: () => {
        throw new Error('bridge gone');
      },
    };
    expect(isNativeShell()).toBe(false);
  });
});

describe('the API origin in a browser build', () => {
  it('leaves every call relative when the build carries no origin', () => {
    expect(configuredApiOrigin()).toBe('');
    expect(hasConfiguredApi()).toBe(false);
    expect(apiUrl('/api/sync')).toBe('/api/sync');
    expect(apiUrl('https://example.com/api/sync')).toBe('https://example.com/api/sync');
  });

  it('joins paths onto a configured origin', () => {
    expect(apiUrl('/api/sync', API)).toBe(`${API}/api/sync`);
    expect(apiUrl('api/sync', API)).toBe(`${API}/api/sync`);
    expect(apiUrl('https://elsewhere.example.com/api/sync', API)).toBe('https://elsewhere.example.com/api/sync');
  });
});

function fakeTarget() {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
  const target = { fetch: fetchMock } as unknown as typeof globalThis;
  return { target, calls, fetchMock };
}

describe('installApiOriginShim', () => {
  it('leaves fetch alone when the build carries no API origin', () => {
    const { target, fetchMock } = fakeTarget();
    const original = target.fetch;
    const undo = installApiOriginShim(target, '');
    expect(target.fetch).toBe(original);
    expect(fetchMock).not.toHaveBeenCalled();
    undo();
    expect(target.fetch).toBe(original);
  });

  it('sends /api calls to the configured origin, cookies included', async () => {
    shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    const { target, calls } = fakeTarget();
    const undo = installApiOriginShim(target, API);

    await target.fetch('/api/auth/status');
    await target.fetch('/api/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json' } });
    // The browser call sites ask for same-origin; over there that yields a
    // request with no cookies, which would silently break sign-in.
    await target.fetch('/api/auth/session', { credentials: 'same-origin' });

    expect(calls.map((call) => call.input)).toEqual([
      `${API}/api/auth/status`,
      `${API}/api/sync`,
      `${API}/api/auth/session`,
    ]);
    expect(calls[2]?.init?.credentials).toBe('include');
    expect(calls[1]?.init?.method).toBe('PUT');

    undo();
    await target.fetch('/api/auth/status');
    expect(calls[3]?.input).toBe('/api/auth/status');
    expect(calls[3]?.init).toBeUndefined();
  });

  it('leaves other requests, and absolute URLs on other hosts, alone', async () => {
    shell.Capacitor = { isNativePlatform: () => true };
    const { target, calls } = fakeTarget();
    installApiOriginShim(target, API);

    await target.fetch('/img/hero-day.jpg');
    await target.fetch(`${API}/api/groq/status`);
    await target.fetch('https://api.open-meteo.com/v1/forecast?latitude=1');

    expect(calls.map((call) => call.input)).toEqual([
      '/img/hero-day.jpg',
      `${API}/api/groq/status`,
      'https://api.open-meteo.com/v1/forecast?latitude=1',
    ]);
  });

  it('rewrites Request objects without losing the body or the method', async () => {
    shell.Capacitor = { isNativePlatform: () => true };
    const { target, calls } = fakeTarget();
    installApiOriginShim(target, API);

    const original = new Request(new URL('/api/sync', window.location.href).toString(), {
      method: 'PUT',
      headers: { 'X-Sync-Id': 'abc' },
      body: JSON.stringify({ hello: 'world' }),
    });
    await target.fetch(original);

    const sent = calls[0]?.input;
    expect(sent).toBeInstanceOf(Request);
    expect((sent as Request).url).toBe(`${API}/api/sync`);
    expect((sent as Request).method).toBe('PUT');
    expect((sent as Request).headers.get('x-sync-id')).toBe('abc');
    expect((sent as Request).credentials).toBe('include');
  });
});
