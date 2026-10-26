// @vitest-environment node
/**
 * The external API token store methods against the **real** Neon code path,
 * driven by the in-memory fake driver. This pins the SQL the store sends for
 * token creation, lookup, revocation and usage stamps — the same statements
 * production runs — so a schema drift fails here instead of for a user.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeNeon, type FakeDb } from './fakeNeon';

let db: FakeDb;

vi.mock('@neondatabase/serverless', () => ({
  neon: () => db.sql,
}));

import { createNeonAuthStore, type NewAccount } from './authStore';
import { createApiTokenValue, handleExternalMe, hashApiToken } from './apiTokens';
import { resetRateLimits } from './security';

const DB_URL = 'postgresql://user:pass@example.test/neondb';

function accountInput(username: string): NewAccount {
  return {
    username,
    email: `${username}@example.test`,
    displayName: username[0]!.toUpperCase() + username.slice(1),
    role: 'personal',
    kdfSalt: 'c2FsdHNhbHRzYWx0c2E=',
    authToken: 'YXV0aFRva2VuYXV0aFRva2VuYXV0aFRva2VuMTI=',
    recoveryHashes: [],
    wrappedDek: 'd3JhcHBlZERla3dyYXBwZWREZWt3cmFwcGVkRGVrMTI=',
    wrappedRecovery: ['d3JhcHBlZFJlY292ZXJ5d3JhcHBlZFJlY292ZXJ5MTI='],
    ciphertext: 'dmF1bHRjaXBoZXJ0ZXh0',
  };
}

beforeEach(() => {
  db = createFakeNeon();
  resetRateLimits();
});

describe('API tokens through the Neon store', () => {
  it('creates, finds, stamps and revokes a token end to end', async () => {
    const store = (await createNeonAuthStore(DB_URL))!;
    // One account, the same way sign-up writes it.
    const account = await store.createAccount(accountInput('nina'));
    expect(account.ok).toBe(true);
    if (!account.ok) throw new Error('account creation failed');
    const userId = account.user.id;

    const secret = createApiTokenValue();
    const row = await store.createApiToken({
      id: '33333333-3333-4333-8333-333333333333',
      userId,
      label: 'Jarvis at home',
      tokenHash: hashApiToken(secret),
      scope: 'readwrite',
      expiresAt: null,
    });
    expect(row?.scope).toBe('readwrite');

    // The handler finds the account from the bearer secret, not the hash.
    const me = await handleExternalMe(
      new Request('https://planner.test/api/external/me', { headers: { Authorization: `Bearer ${secret}` } }),
      store,
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as { account: { username: string }; token: { label: string } };
    expect(body.account.username).toBe('nina');
    expect(body.token.label).toBe('Jarvis at home');

    const listed = await store.listApiTokens(userId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.last_used_at).not.toBeNull();

    // An unknown secret opens nothing.
    expect(await store.findApiToken(hashApiToken(createApiTokenValue()))).toBeNull();

    // Revocation is immediate and survives another lookup.
    expect(await store.revokeApiToken(row!.id, userId)).toBe(true);
    expect(await store.findApiToken(hashApiToken(secret))).toBeNull();
    const afterRevoke = await handleExternalMe(
      new Request('https://planner.test/api/external/me', { headers: { Authorization: `Bearer ${secret}` } }),
      store,
    );
    expect(afterRevoke.status).toBe(401);
  });

  it('treats an expired token as unusable', async () => {
    const store = (await createNeonAuthStore(DB_URL))!;
    const account = await store.createAccount(accountInput('leo'));
    expect(account.ok).toBe(true);
    if (!account.ok) throw new Error('account creation failed');
    const secret = createApiTokenValue();
    await store.createApiToken({
      id: '44444444-4444-4444-8444-444444444444',
      userId: account.user.id,
      label: 'Old script',
      tokenHash: hashApiToken(secret),
      scope: 'read',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    expect(await store.findApiToken(hashApiToken(secret))).toBeNull();
  });
});
