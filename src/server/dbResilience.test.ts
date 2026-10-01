// @vitest-environment node
/**
 * The database must never take the whole function down with it.
 *
 * A DATABASE_URL pasted into an environment-variable field often carries paste
 * artifacts (wrapping quotes, angle brackets, whitespace). The Neon driver
 * throws on those *while the store is being created*, which used to escape the
 * router and crash the serverless function — the platform then answered an
 * opaque HTML 500 the client could only report as "an unexpected response".
 * These tests pin the contract: store creation never throws, a broken URL
 * becomes a JSON 502 with the secret redacted from logs, and a mangled-but-
 * recoverable URL is cleaned before the driver sees it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeNeon, type FakeDb } from './fakeNeon';

let db: FakeDb;

vi.mock('@neondatabase/serverless', () => ({
  neon: (url: string) => {
    if (String(url).includes('unparseable')) {
      // Mirrors the real driver's error, which embeds the full connection string.
      throw new Error(`Database connection string provided to \`neon()\` is not a valid URL. Connection string: ${url}`);
    }
    return db.sql;
  },
}));

const { createNeonAuthStore, cleanDatabaseUrl, DatabaseConfigError } = await import('./authStore');
const { handleSignup, handleSalt } = await import('./authApi');
const { handleSync, neonStore } = await import('./sync');
const { resetRateLimits } = await import('./security');

const PLAIN_URL = 'postgresql://user:secretpass@example.test/neondb?sslmode=require';

const ACCOUNT = {
  username: 'paste_tester',
  email: 'paste@example.com',
  displayName: 'Paste Tester',
  role: 'personal' as const,
  kdfSalt: 'c2FsdHNhbHRzYWx0c2E=',
  authToken: 'YXV0aFRva2VuYXV0aFRva2VuYXV0aFRva2VuMTI=',
  recoveryHashes: ['AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='],
  wrappedDek: 'd3JhcHBlZERla3dyYXBwZWREZWt3cmFwcGVkRGVrMTI=',
  wrappedRecovery: ['d3JhcHBlZFJlY292ZXJ5d3JhcHBlZFJlY292ZXJ5MTI='],
  ciphertext: 'dmF1bHRjaXBoZXJ0ZXh0',
};

function signupRequest(_databaseUrl?: string): Request {
  return new Request('https://planner.test/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ACCOUNT),
  });
}

beforeEach(() => {
  db = createFakeNeon();
  resetRateLimits();
});

afterEach(() => {
  resetRateLimits();
  vi.restoreAllMocks();
});

describe('cleanDatabaseUrl', () => {
  it('strips the paste artifacts environment values collect', () => {
    expect(cleanDatabaseUrl(`  ${PLAIN_URL}  \n`)).toBe(PLAIN_URL);
    expect(cleanDatabaseUrl(`"${PLAIN_URL}"`)).toBe(PLAIN_URL);
    expect(cleanDatabaseUrl(`'${PLAIN_URL}'`)).toBe(PLAIN_URL);
    expect(cleanDatabaseUrl(`<${PLAIN_URL}>`)).toBe(PLAIN_URL);
    expect(cleanDatabaseUrl(PLAIN_URL)).toBe(PLAIN_URL);
  });
});

describe('a quoted DATABASE_URL still signs up', () => {
  it('cleans the value before the driver parses it', async () => {
    const store = await createNeonAuthStore(`"${PLAIN_URL}"`);
    expect(store).not.toBeNull();
    const response = await handleSignup(signupRequest(), store);
    expect(response.status).toBe(201);
  });
});

describe('an unparseable DATABASE_URL answers JSON 502, never a crash', () => {
  it('store creation resolves; the first query surfaces a DatabaseConfigError', async () => {
    const store = await createNeonAuthStore('unparseable://user:sup3rs3cret@example.test/db');
    expect(store).not.toBeNull();
    await expect(store!.findAccount('anyone')).rejects.toBeInstanceOf(DatabaseConfigError);
  });

  it('handleSignup reports 502 with a redacted log line', async () => {
    const store = await createNeonAuthStore('unparseable://user:sup3rs3cret@example.test/db');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleSignup(signupRequest(), store);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain('database could not be reached');
    expect(log).toHaveBeenCalled();
    const logged = log.mock.calls.map((line) => line.join(' ')).join('\n');
    expect(logged).not.toContain('secretpass');
    expect(logged).not.toContain('unparseable://user:sup3rs3cret@example.test/db');
  });

  it('handleSalt reports 502 the same way', async () => {
    const store = await createNeonAuthStore('unparseable://user:sup3rs3cret@example.test/db');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleSalt(
      new Request('https://planner.test/api/auth/salt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'someone' }),
      }),
      store,
    );
    expect(response.status).toBe(502);
  });

  it('handleSync reports 502 instead of crashing the function', async () => {
    const store = await neonStore('unparseable://user:sup3rs3cret@example.test/db');
    expect(store).not.toBeNull();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleSync(
      new Request('https://planner.test/api/sync', {
        method: 'GET',
        headers: { 'x-sync-id': 'a'.repeat(64) },
      }),
      store,
    );
    expect(response.status).toBe(502);
  });
});

describe('a plain DATABASE_URL syncs end to end', () => {
  it('neonStore handles the sync table through the real store code', async () => {
    const store = await neonStore(PLAIN_URL);
    expect(store).not.toBeNull();
    const id = 'a'.repeat(64);
    expect(await store!.get(id)).toBeNull();
    const row = await store!.put(id, 0, 'cipher');
    expect(row?.version).toBe(1);
    const bumped = await store!.put(id, 1, 'cipher2');
    expect(bumped?.version).toBe(2);
    await store!.remove(id);
    expect(await store!.get(id)).toBeNull();
  });
});
