import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { apiRoute, handleApiRequest } from './apiRouter';
import { decoySalt } from './authApi';
import { resetRateLimits } from './security';

/**
 * The router is the whole production API surface (one catch-all Vercel
 * Function), so these tests pin the routes that used to live one file each
 * under `api/`: correct dispatch, method enforcement by the handlers, and a
 * 404 for anything unmapped.
 */

const NO_ENV = {};

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://planner.test${path}`, init);
}

function jsonRequest(method: string, path: string, body: unknown): Request {
  return new Request(`https://planner.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterAll(() => resetRateLimits());

describe('Vercel API routing', () => {
  it('rewrites nested API requests to the single catch-all function', () => {
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };
    expect(config.rewrites?.[0]).toEqual({
      source: '/api/(.*)',
      destination: '/api/[...path]',
    });
  });
});

describe('apiRoute table', () => {
  it('maps every production API path and nothing else', () => {
    const paths = [
      '/api/auth/link-accept',
      '/api/auth/links',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/note',
      '/api/auth/recovery/start',
      '/api/auth/recovery/complete',
      '/api/auth/recovery/update',
      '/api/auth/salt',
      '/api/auth/session',
      '/api/auth/sessions',
      '/api/auth/share',
      '/api/auth/signup',
      '/api/auth/status',
      '/api/auth/vault',
      '/api/ics',
      '/api/sync',
      '/api/sync/status',
      '/api/ai/chat/completions',
      '/api/ai/status',
    ];
    for (const path of paths) expect(apiRoute(path, NO_ENV), path).not.toBeNull();

    for (const path of ['/api', '/api/auth', '/api/auth/nope', '/api/sync/nope', '/api/ai', '/api/not-a-route']) {
      expect(apiRoute(path, NO_ENV), path).toBeNull();
    }
  });
});

describe('handleApiRequest', () => {
  it('returns a hardened 404 for unknown paths', async () => {
    const response = await handleApiRequest(request('/api/nope'), NO_ENV);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.json()).resolves.toEqual({ error: { message: 'Not found.' } });
  });

  it('serves /api/auth/status without a database', async () => {
    const response = await handleApiRequest(request('/api/auth/status'), NO_ENV);
    expect(response.status).toBe(200);
    // No database, and not production: the in-memory fallback is in use.
    await expect(response.json()).resolves.toEqual({ configured: false, storage: 'temporary' });
  });

  it('serves /api/ai/status with and without a key', async () => {
    const without = await handleApiRequest(request('/api/ai/status'), NO_ENV);
    await expect(without.json()).resolves.toEqual({ configured: false, providers: [] });

    const withKey = await handleApiRequest(request('/api/ai/status'), { GROQ_API_KEY: 'k' });
    await expect(withKey.json()).resolves.toEqual({
      configured: true,
      // Names and capabilities only — never a key or an upstream URL.
      providers: [{ id: 'groq', label: 'Groq', vision: true }],
    });
  });

  it('lets handlers reject wrong methods with 405', async () => {
    const status = await handleApiRequest(request('/api/auth/status', { method: 'POST' }), NO_ENV);
    expect(status.status).toBe(405);

    const ics = await handleApiRequest(request('/api/ics', { method: 'POST' }), NO_ENV);
    expect(ics.status).toBe(405);

    const completions = await handleApiRequest(request('/api/ai/chat/completions'), NO_ENV);
    expect(completions.status).toBe(405);
  });

  it('reports sync as not configured without DATABASE_URL', async () => {
    const id = 'a'.repeat(64);
    const response = await handleApiRequest(request('/api/sync', { headers: { 'x-sync-id': id } }), NO_ENV);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('not_configured');
  });

  it('resolves the auth store so signup works end to end', async () => {
    resetRateLimits();
    const account = {
      username: 'rory',
      email: 'rory@example.com',
      displayName: 'Rory',
      role: 'student' as const,
      kdfSalt: 'c2FsdHNhbHRzYWx0c2E=',
      authToken: 'YXV0aFRva2VuYXV0aFRva2VuYXV0aFRva2VuMTI=',
      recoveryHashes: [
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ],
      wrappedDek: 'd3JhcHBlZERla3dyYXBwZWREZWt3cmFwcGVkRGVrMTI=',
      wrappedRecovery: [
        'd3JhcHBlZFJlY292ZXJ5d3JhcHBlZFJlY292ZXJ5MTI=',
        'd3JhcHBlZFJlY292ZXJ5d3JhcHBlZFJlY292ZXJ5MzQ=',
      ],
      ciphertext: 'dmF1bHRjaXBoZXJ0ZXh0',
    };
    const response = await handleApiRequest(jsonRequest('POST', '/api/auth/signup', account), NO_ENV);
    expect(response.status).toBe(201);

    // The salt endpoint answers through the same store (decoy for strangers).
    const salt = await handleApiRequest(jsonRequest('POST', '/api/auth/salt', { username: 'stranger' }), NO_ENV);
    expect(salt.status).toBe(200);
    await expect(salt.json()).resolves.toEqual({ kdfSalt: decoySalt('stranger') });

    const recovery = await handleApiRequest(
      jsonRequest('POST', '/api/auth/recovery/start', { username: 'rory' }),
      NO_ENV,
    );
    expect(recovery.status).toBe(200);
    await expect(recovery.json()).resolves.toEqual({
      kdfSalt: account.kdfSalt,
      wrappedRecovery: account.wrappedRecovery,
    });

    // Rotating codes needs a session, and the route is reachable in production.
    const rotate = await handleApiRequest(jsonRequest('POST', '/api/auth/recovery/update', { newRecoveryHashes: [] }), NO_ENV);
    expect(rotate.status).toBe(401);
  });
});
