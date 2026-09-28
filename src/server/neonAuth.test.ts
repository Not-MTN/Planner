// @vitest-environment node
/**
 * The account flow against the **real** database code path.
 *
 * `createNeonAuthStore` is the code that runs in production, so these tests
 * drive it with a stand-in for the Neon driver (`fakeNeon`) instead of the
 * in-memory store. If a query ever sends a salt it does not store — or anything
 * else that makes sign-in impossible — these fail here rather than for a user.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeNeon, type FakeDb } from './fakeNeon';

let db: FakeDb;

vi.mock('@neondatabase/serverless', () => ({
  neon: () => db.sql,
}));

const { createNeonAuthStore, hashCredential, hashAuthToken } = await import('./authStore');
const { handleAccountVault, handleLogin, handleLogout, handleSession, handleSignup } = await import('./authApi');
const { resetRateLimits } = await import('./security');
interface LoginResponse {
  user: { username: string };
  kdfSalt: string;
  wrappedDek: string;
  vault: { version: number; ciphertext: string };
}

const DB_URL = 'postgresql://user:pass@example.test/neondb';

const ACCOUNT = {
  username: 'sara',
  email: 'sara@example.com',
  displayName: 'Sara',
  role: 'student' as const,
  kdfSalt: 'c2FsdHNhbHRzYWx0c2E=',
  authToken: 'YXV0aFRva2VuYXV0aFRva2VuYXV0aFRva2VuMTI=',
  wrappedDek: 'd3JhcHBlZERla3dyYXBwZWREZWt3cmFwcGVkRGVrMTI=',
  wrappedRecovery: 'd3JhcHBlZFJlY292ZXJ5d3JhcHBlZFJlY292ZXJ5MTI=',
  ciphertext: 'dmF1bHRjaXBoZXJ0ZXh0',
};

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`https://planner.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function put(path: string, body: unknown, cookie?: string): Request {
  return new Request(`https://planner.test${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie?: string): Request {
  return new Request(`https://planner.test${path}`, { headers: cookie ? { Cookie: cookie } : undefined });
}

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

beforeEach(() => {
  db = createFakeNeon();
  resetRateLimits();
});

describe('accounts on the real database path', () => {
  it('creates every row a sign-in will later need', async () => {
    const store = await createNeonAuthStore(DB_URL);
    const response = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    expect(response.status).toBe(201);
    // One row per table: a missing credential or vault would break sign-in.
    expect(db.tables.planner_users).toHaveLength(1);
    expect(db.tables.planner_credentials).toHaveLength(1);
    expect(db.tables.planner_vaults).toHaveLength(1);
    expect(db.tables.planner_sessions).toHaveLength(1);
  });

  it('stores the salt it hashed with, so a password keeps working', async () => {
    const store = await createNeonAuthStore(DB_URL);
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const credential = db.tables.planner_credentials[0]!;
    // The bug this guards: hashing with one salt and storing another.
    const expected = await hashAuthToken(ACCOUNT.authToken, String(credential.hash_salt));
    expect(credential.auth_hash).toBe(expected);
  });

  it('signs in after signing up, and returns the same wrapped key and vault', async () => {
    const store = await createNeonAuthStore(DB_URL);
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);

    const salt = await handleSaltRequest(store);
    const stretched = ACCOUNT.authToken; // already the stretched value in this fixture
    const response = await handleLogin(post('/api/auth/login', { username: ACCOUNT.username, authToken: stretched }), store);
    expect(response.status).toBe(200);
    const body = (await response.json()) as LoginResponse;
    expect(body.user.username).toBe('sara');
    expect(body.wrappedDek).toBe(ACCOUNT.wrappedDek);
    expect(body.vault.ciphertext).toBe(ACCOUNT.ciphertext);
    expect(body.vault.version).toBe(1);
    expect(body.kdfSalt).toBe(salt);
  });

  it('rejects the wrong password and an unknown account the same way', async () => {
    const store = await createNeonAuthStore(DB_URL);
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);

    const wrong = await handleLogin(
      post('/api/auth/login', { username: ACCOUNT.username, authToken: 'YXV0aFRva2VuYXV0aFRva2VuYXV0aFRva2VuOTk=' }),
      store,
    );
    expect(wrong.status).toBe(401);

    const nobody = await handleLogin(
      post('/api/auth/login', { username: 'nobody', authToken: ACCOUNT.authToken }),
      store,
    );
    expect(nobody.status).toBe(401);
    expect((await nobody.json() as { error: { message: string } }).error.message).toBe(
      (await wrong.json() as { error: { message: string } }).error.message,
    );
  });

  it('keeps a session alive, and ends it on logout', async () => {
    const store = await createNeonAuthStore(DB_URL);
    const signup = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const cookie = cookieFrom(signup);

    const me = await handleSession(get('/api/auth/session', cookie), store);
    expect((await me.json() as { user: { username: string } | null }).user?.username).toBe('sara');

    const out = await handleLogout(post('/api/auth/logout', {}, cookie), store);
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');

    const after = await handleSession(get('/api/auth/session', cookie), store);
    expect((await after.json() as { user: unknown }).user).toBeNull();
  });

  it('saves the vault, and reports a conflict instead of overwriting another device', async () => {
    const store = await createNeonAuthStore(DB_URL);
    const cookie = cookieFrom(await handleSignup(post('/api/auth/signup', ACCOUNT), store));

    const saved = await handleAccountVault(put('/api/auth/vault', { baseVersion: 1, ciphertext: 'bmV4dA==' }, cookie), store);
    expect(saved.status).toBe(200);
    expect((await saved.json() as { version: number; ciphertext: string }).version).toBe(2);

    const stale = await handleAccountVault(put('/api/auth/vault', { baseVersion: 1, ciphertext: 'c3RhbGU=' }, cookie), store);
    expect(stale.status).toBe(409);
    const conflict = (await stale.json()) as { error: { code: string }; current: { version: number } | null };
    expect(conflict.error.code).toBe('conflict');
    expect(conflict.current?.version).toBe(2);
  });

  it('leaves no half-made account behind when the username is taken', async () => {
    const store = await createNeonAuthStore(DB_URL);
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const second = await handleSignup(post('/api/auth/signup', { ...ACCOUNT, email: 'other@example.com' }), store);
    expect(second.status).toBe(409);
    // The failed attempt must not add users, credentials or vaults.
    expect(db.tables.planner_users).toHaveLength(1);
    expect(db.tables.planner_credentials).toHaveLength(1);
    expect(db.tables.planner_vaults).toHaveLength(1);
  });

  it('can change a password and still sign in afterwards', async () => {
    const store = await createNeonAuthStore(DB_URL);
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const newToken = 'bmV3VG9rZW5uZXdUb2tlbm5ld1Rva2VuMTIz';
    await store!.updateCredential(db.tables.planner_users[0]!.id as string, ACCOUNT.kdfSalt, newToken);

    const ok = await handleLogin(post('/api/auth/login', { username: ACCOUNT.username, authToken: newToken }), store);
    expect(ok.status).toBe(200);

    const stale = await handleLogin(post('/api/auth/login', { username: ACCOUNT.username, authToken: ACCOUNT.authToken }), store);
    expect(stale.status).toBe(401);
  });

  it('hashes a credential with the salt it returns', async () => {
    const { hashSalt, authHash } = await hashCredential(ACCOUNT.authToken);
    expect(authHash).toBe(await hashAuthToken(ACCOUNT.authToken, hashSalt));
  });
});

/** The salt endpoint is public; ask it the way the browser does. */
async function handleSaltRequest(store: Awaited<ReturnType<typeof createNeonAuthStore>>): Promise<string> {
  const { handleSalt } = await import('./authApi');
  const response = await handleSalt(post('/api/auth/salt', { username: ACCOUNT.username }), store);
  const body = (await response.json()) as { kdfSalt: string };
  return body.kdfSalt;
}
