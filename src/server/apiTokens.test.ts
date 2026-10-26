// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { resetRateLimits } from './security';
import {
  createApiTokenValue,
  handleApiTokens,
  handleExternalMe,
  handleExternalVault,
  hashApiToken,
  readBearerToken,
} from './apiTokens';
import { hashToken, type AuthStore, type ApiTokenRow, type UserRow, type VaultRow } from './authStore';
import { SESSION_COOKIE } from '../shared/authContract';

afterEach(() => resetRateLimits());

const USER: UserRow = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'nina',
  username_lower: 'nina',
  email_lower: 'nina@example.test',
  display_name: 'Nina',
  role: 'personal',
  created_at: '2026-10-01T00:00:00.000Z',
};

const SESSION_SECRET = 'session-secret-value';

function tokenRow(partial: Partial<ApiTokenRow> = {}): ApiTokenRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    user_id: USER.id,
    label: 'Jarvis',
    token_hash: hashApiToken('plnr_at_test-secret'),
    scope: 'readwrite',
    created_at: '2026-10-02T00:00:00.000Z',
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    ...partial,
  };
}

type StoredVault = VaultRow & { user_id: string };

/** Only the methods the token handlers touch, with the rest as loud stubs. */
function mockStore(): AuthStore & { tokens: ApiTokenRow[]; vault: StoredVault | null; touches: string[] } {
  const tokens: ApiTokenRow[] = [];
  const state = {
    tokens,
    vault: null as StoredVault | null,
    touches: [] as string[],
    findSession: async (tokenHash: string) =>
      tokenHash === hashToken(SESSION_SECRET)
        ? { session: { id: 's1', user_id: USER.id, expires_at: '2099-01-01' }, user: USER }
        : null,
    createApiToken: async (input: Parameters<AuthStore['createApiToken']>[0]) => {
      if (tokens.some((row) => row.token_hash === input.tokenHash)) return null;
      const row = tokenRow({
        id: input.id,
        user_id: input.userId,
        label: input.label,
        token_hash: input.tokenHash,
        scope: input.scope,
        expires_at: input.expiresAt,
      });
      tokens.push(row);
      return row;
    },
    listApiTokens: async (userId: string) => tokens.filter((row) => row.user_id === userId),
    revokeApiToken: async (id: string, userId: string) => {
      const row = tokens.find((item) => item.id === id && item.user_id === userId && !item.revoked_at);
      if (!row) return false;
      row.revoked_at = new Date().toISOString();
      return true;
    },
    findApiToken: async (tokenHash: string) => {
      const token = tokens.find((row) => row.token_hash === tokenHash && !row.revoked_at);
      if (!token) return null;
      if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) return null;
      return { token, user: USER };
    },
    touchApiToken: async (id: string) => {
      state.touches.push(id);
    },
    getVault: async (userId: string) => (state.vault && state.vault.user_id === userId ? state.vault : null),
    putVault: async (userId: string, baseVersion: number, ciphertext: string) => {
      const current = state.vault && state.vault.user_id === userId ? state.vault : null;
      if (!current) {
        if (baseVersion !== 0) return null;
        const row: StoredVault = { user_id: userId, version: 1, ciphertext, updated_at: new Date(), wrappedDek: '', wrappedRecovery: '' };
        state.vault = row;
        return row;
      }
      if (current.version !== baseVersion) return null;
      current.version += 1;
      current.ciphertext = ciphertext;
      current.updated_at = new Date();
      return current;
    },
  };
  return state as unknown as AuthStore & { tokens: ApiTokenRow[]; vault: StoredVault | null; touches: string[] };
}

function sameOrigin(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Origin: 'https://planner.test', Host: 'planner.test' } };
}

function sessionRequest(method: string, path: string, body?: unknown): Request {
  return new Request(`https://planner.test${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://planner.test',
      Cookie: `${SESSION_COOKIE}=${SESSION_SECRET}`,
      ...(body ? {} : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function bearerRequest(method: string, path: string, token: string | null, body?: unknown): Request {
  return new Request(`https://planner.test${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe('API token management', () => {
  it('refuses cross-origin and unauthenticated management calls', async () => {
    const store = mockStore();
    const cross = new Request('https://planner.test/api/auth/api-tokens', sameOrigin({ method: 'GET' }) as RequestInit);
    cross.headers.set('Origin', 'https://evil.example');
    expect((await handleApiTokens(cross, store)).status).toBe(403);

    const noSession = new Request('https://planner.test/api/auth/api-tokens', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Origin: 'https://planner.test' },
    });
    expect((await handleApiTokens(noSession, store)).status).toBe(401);
  });

  it('creates a token once with its plaintext, then lists metadata without the hash or secret', async () => {
    const store = mockStore();
    const created = await handleApiTokens(
      sessionRequest('POST', '/api/auth/api-tokens', { label: 'Jarvis', scope: 'readwrite', expiresInDays: 90 }),
      store,
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { token: string; id: string; scope: string; label: string };
    expect(body.token.startsWith('plnr_at_')).toBe(true);
    expect(body.label).toBe('Jarvis');

    const listed = await handleApiTokens(sessionRequest('GET', '/api/auth/api-tokens'), store);
    const list = (await listed.json()) as { tokens: Array<Record<string, unknown>> };
    expect(list.tokens).toHaveLength(1);
    expect(list.tokens[0]).not.toHaveProperty('token');
    expect(list.tokens[0]).not.toHaveProperty('token_hash');
    expect(list.tokens[0]?.id).toBe(body.id);
  });

  it('validates the label, scope and expiry, and enforces the per-account cap', async () => {
    const store = mockStore();
    const badLabel = await handleApiTokens(
      sessionRequest('POST', '/api/auth/api-tokens', { label: '   ', scope: 'read' }),
      store,
    );
    expect(badLabel.status).toBe(400);
    const badScope = await handleApiTokens(
      sessionRequest('POST', '/api/auth/api-tokens', { label: 'X', scope: 'admin' }),
      store,
    );
    expect(badScope.status).toBe(400);
    const badExpiry = await handleApiTokens(
      sessionRequest('POST', '/api/auth/api-tokens', { label: 'X', scope: 'read', expiresInDays: 7 }),
      store,
    );
    expect(badExpiry.status).toBe(400);

    for (let i = 0; i < 20; i += 1) {
      store.tokens.push(tokenRow({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, token_hash: `h${i}` }));
    }
    const capped = await handleApiTokens(
      sessionRequest('POST', '/api/auth/api-tokens', { label: 'one too many', scope: 'read' }),
      store,
    );
    expect(capped.status).toBe(409);
  });

  it('revokes a token so it disappears from the list and stops authenticating', async () => {
    const store = mockStore();
    store.tokens.push(tokenRow());
    const revoked = await handleApiTokens(
      sessionRequest('DELETE', '/api/auth/api-tokens', { id: tokenRow().id }),
      store,
    );
    expect(revoked.status).toBe(200);
    expect(store.tokens[0]?.revoked_at).toBeTruthy();

    const listed = await handleApiTokens(sessionRequest('GET', '/api/auth/api-tokens'), store);
    expect((await listed.json() as { tokens: unknown[] }).tokens).toHaveLength(0);

    const call = await handleExternalMe(bearerRequest('GET', '/api/external/me', 'plnr_at_test-secret'), store);
    expect(call.status).toBe(401);
  });
});

describe('external API bearer authentication', () => {
  it('rejects a missing, malformed or unknown bearer token', async () => {
    const store = mockStore();
    expect((await handleExternalMe(bearerRequest('GET', '/api/external/me', null), store)).status).toBe(401);
    expect(readBearerToken(new Request('https://planner.test', { headers: { Authorization: 'Basic abc' } }))).toBeNull();
    expect((await handleExternalMe(bearerRequest('GET', '/api/external/me', 'plnr_at_unknown'), store)).status).toBe(401);
  });

  it('identifies the account behind a valid token and stamps last-used', async () => {
    const store = mockStore();
    store.tokens.push(tokenRow());
    const res = await handleExternalMe(bearerRequest('GET', '/api/external/me', 'plnr_at_test-secret'), store);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: { username: string }; token: { scope: string } };
    expect(body.account.username).toBe('nina');
    expect(body.token.scope).toBe('readwrite');
    expect(store.touches).toContain(store.tokens[0]!.id);
  });

  it('refuses expired tokens', async () => {
    const store = mockStore();
    store.tokens.push(tokenRow({ expires_at: '2000-01-01T00:00:00.000Z' }));
    const res = await handleExternalMe(bearerRequest('GET', '/api/external/me', 'plnr_at_test-secret'), store);
    expect(res.status).toBe(401);
  });
});

describe('external vault access', () => {
  it('returns 404 before a vault exists, then the encrypted blob', async () => {
    const store = mockStore();
    store.tokens.push(tokenRow({ scope: 'read' }));
    const empty = await handleExternalVault(bearerRequest('GET', '/api/external/vault', 'plnr_at_test-secret'), store);
    expect(empty.status).toBe(404);

    store.vault = {
      user_id: USER.id,
      version: 3,
      ciphertext: 'encrypted-blob',
      updated_at: new Date('2026-10-03T00:00:00.000Z'),
      wrappedDek: '',
      wrappedRecovery: '',
    };
    const res = await handleExternalVault(bearerRequest('GET', '/api/external/vault', 'plnr_at_test-secret'), store);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ version: 3, ciphertext: 'encrypted-blob' });
  });

  it('blocks writes for a read-only token and accepts them for a read-write token', async () => {
    const readOnly = mockStore();
    readOnly.tokens.push(tokenRow({ scope: 'read' }));
    const blocked = await handleExternalVault(
      bearerRequest('PUT', '/api/external/vault', 'plnr_at_test-secret', { baseVersion: 0, ciphertext: 'blob' }),
      readOnly,
    );
    expect(blocked.status).toBe(403);

    const writable = mockStore();
    writable.tokens.push(tokenRow({ scope: 'readwrite' }));
    const created = await handleExternalVault(
      bearerRequest('PUT', '/api/external/vault', 'plnr_at_test-secret', { baseVersion: 0, ciphertext: 'first' }),
      writable,
    );
    expect(created.status).toBe(200);
    expect((await created.json()) as unknown).toMatchObject({ version: 1, ciphertext: 'first' });

    // Stale base version: the current blob comes back with a 409, nothing is overwritten.
    const stale = await handleExternalVault(
      bearerRequest('PUT', '/api/external/vault', 'plnr_at_test-secret', { baseVersion: 0, ciphertext: 'clobber' }),
      writable,
    );
    expect(stale.status).toBe(409);
    const conflict = (await stale.json()) as { current: { version: number; ciphertext: string } };
    expect(conflict.current.version).toBe(1);
    expect(writable.vault?.ciphertext).toBe('first');
  });

  it('validates the write body', async () => {
    const store = mockStore();
    store.tokens.push(tokenRow());
    const bad = await handleExternalVault(
      bearerRequest('PUT', '/api/external/vault', 'plnr_at_test-secret', { baseVersion: -1, ciphertext: '' }),
      store,
    );
    expect(bad.status).toBe(400);
  });
});

describe('token value helpers', () => {
  it('makes recognizable, unique secrets with a stable hash', () => {
    const one = createApiTokenValue();
    const two = createApiTokenValue();
    expect(one.startsWith('plnr_at_')).toBe(true);
    expect(one).not.toBe(two);
    expect(hashApiToken(one)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiToken(one)).toBe(hashApiToken(one));
    expect(hashApiToken(one)).not.toBe(hashApiToken(two));
  });
});
