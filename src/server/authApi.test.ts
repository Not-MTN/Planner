import { describe, expect, it } from 'vitest';
import {
  handleAccountVault,
  handleLogin,
  handleLogout,
  handleSalt,
  handleSession,
  handleSignup,
  readSessionToken,
} from './authApi';
import { createMemoryAuthStore } from './authStore';
import { resetRateLimits } from './security';
import type { LoginResponse, PublicUser } from '../shared/authContract';

const STORE = () => createMemoryAuthStore();

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
  return new Request(`https://planner.test${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

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

function cookieFrom(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}

describe('account API', () => {
  it('creates an account, a session cookie and a vault', async () => {
    resetRateLimits();
    const store = STORE();
    const response = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { user: PublicUser };
    expect(body.user.username).toBe('sara');
    expect(body.user.role).toBe('student');
    expect(cookieFrom(response)).toContain('planner_session=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  it('rejects a duplicate username and a duplicate email', async () => {
    resetRateLimits();
    const store = STORE();
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);

    const sameName = await handleSignup(post('/api/auth/signup', { ...ACCOUNT, email: 'other@example.com' }), store);
    expect(sameName.status).toBe(409);
    expect((await sameName.json() as { error: { code: string } }).error.code).toBe('taken');

    const sameEmail = await handleSignup(post('/api/auth/signup', { ...ACCOUNT, username: 'other' }), store);
    expect(sameEmail.status).toBe(409);
  });

  it('accepts a vault-sized body that is larger than the ordinary auth cap', async () => {
    resetRateLimits();
    const store = STORE();
    // A planner with real local data encrypts to far more than the 64 KB cap
    // that guards the small auth endpoints — sign-up must still go through.
    const bigCiphertext = 'x'.repeat(100 * 1024);
    const signup = await handleSignup(post('/api/auth/signup', { ...ACCOUNT, ciphertext: bigCiphertext }), store);
    expect(signup.status).toBe(201);

    const cookie = cookieFrom(signup);
    const updated = await handleAccountVault(
      put('/api/auth/vault', { baseVersion: 1, ciphertext: bigCiphertext }, cookie),
      store,
    );
    expect(updated.status).toBe(200);
  });

  it('validates the payload instead of trusting the client', async () => {
    resetRateLimits();
    const store = STORE();
    const bad = [
      { ...ACCOUNT, username: 'a' },
      { ...ACCOUNT, role: 'wizard' },
      { ...ACCOUNT, kdfSalt: 'not base64!!' },
      { ...ACCOUNT, authToken: 'short' },
      { ...ACCOUNT, email: 'nope' },
      { ...ACCOUNT, ciphertext: '' },
    ];
    for (const body of bad) {
      const response = await handleSignup(post('/api/auth/signup', body), store);
      expect(response.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it('rejects cross-origin writes', async () => {
    resetRateLimits();
    const request = new Request('https://planner.test/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify(ACCOUNT),
    });
    const response = await handleSignup(request, STORE());
    expect(response.status).toBe(403);
  });

  it('hands back the salt, and a decoy for an unknown account', async () => {
    resetRateLimits();
    const store = STORE();
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);

    const known = await (await handleSalt(post('/api/auth/salt', { username: 'sara' }), store)).json();
    expect(known).toEqual({ kdfSalt: ACCOUNT.kdfSalt });

    const unknown = (await (await handleSalt(post('/api/auth/salt', { username: 'nobody' }), store)).json()) as { kdfSalt: string };
    expect(unknown.kdfSalt).not.toBe(ACCOUNT.kdfSalt);
    // The decoy must be stable, or it could be used to detect retries.
    const again = (await (await handleSalt(post('/api/auth/salt', { username: 'nobody' }), store)).json()) as { kdfSalt: string };
    expect(again.kdfSalt).toBe(unknown.kdfSalt);
  });

  it('signs in with the stretched token and rejects a wrong one', async () => {
    resetRateLimits();
    const store = STORE();
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);

    const ok = await handleLogin(post('/api/auth/login', { username: 'sara', authToken: ACCOUNT.authToken }), store);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as LoginResponse;
    expect(body.kdfSalt).toBe(ACCOUNT.kdfSalt);
    expect(body.wrappedDek).toBe(ACCOUNT.wrappedDek);
    expect(body.vault.ciphertext).toBe(ACCOUNT.ciphertext);

    const wrong = await handleLogin(post('/api/auth/login', { username: 'sara', authToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }), store);
    expect(wrong.status).toBe(401);
    expect((await wrong.json() as { error: { code: string } }).error.code).toBe('bad_credentials');

    const missing = await handleLogin(post('/api/auth/login', { username: 'ghost', authToken: ACCOUNT.authToken }), store);
    expect(missing.status).toBe(401);
  });

  it('accepts email as well as username at sign-in', async () => {
    resetRateLimits();
    const store = STORE();
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const response = await handleLogin(post('/api/auth/login', { username: 'Sara@Example.com', authToken: ACCOUNT.authToken }), store);
    expect(response.status).toBe(200);
  });

  it('guards the vault behind a session and refuses other accounts', async () => {
    resetRateLimits();
    const store = STORE();
    const signup = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const cookie = cookieFrom(signup);
    expect(readSessionToken(get('/api/auth/vault', cookie))).toBeTruthy();

    const anon = await handleAccountVault(get('/api/auth/vault'), store);
    expect(anon.status).toBe(401);

    const mine = await handleAccountVault(get('/api/auth/vault', cookie), store);
    expect(mine.status).toBe(200);
    const vault = (await mine.json()) as { version: number; ciphertext: string };
    expect(vault.ciphertext).toBe(ACCOUNT.ciphertext);

    const updated = await handleAccountVault(
      put('/api/auth/vault', { baseVersion: vault.version, ciphertext: 'bmV3Y2lwaGVy' }, cookie),
      store,
    );
    expect(updated.status).toBe(200);
    expect((await updated.json() as { version: number }).version).toBe(2);

    // A stale base version must conflict rather than overwrite another device.
    const stale = await handleAccountVault(
      put('/api/auth/vault', { baseVersion: vault.version, ciphertext: 'c3RhbGU=' }, cookie),
      store,
    );
    expect(stale.status).toBe(409);
  });

  it('reports the signed-in user and clears it on logout', async () => {
    resetRateLimits();
    const store = STORE();
    const signup = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const cookie = cookieFrom(signup);

    const me = (await (await handleSession(get('/api/auth/session', cookie), store)).json()) as { user: PublicUser | null };
    expect(me.user?.username).toBe('sara');

    // No cookie at all is an unauthenticated request, not a successful one.
    const anon = await handleSession(get('/api/auth/session'), store);
    expect(anon.status).toBe(401);

    // So is a cookie whose session has ended: it is cleared for the browser too.
    const stale = await handleSession(get('/api/auth/session', 'planner_session=not-a-real-session'), store);
    expect(stale.status).toBe(401);
    expect(stale.headers.get('set-cookie')).toContain('Max-Age=0');

    const out = await handleLogout(post('/api/auth/logout', undefined, cookie), store);
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');

    const after = (await (await handleSession(get('/api/auth/session', cookie), store)).json()) as { user: PublicUser | null };
    expect(after.user).toBeNull();
  });

  it('reports 503 when no database is configured', async () => {
    resetRateLimits();
    const response = await handleSignup(post('/api/auth/signup', ACCOUNT), null);
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('not_configured');
  });
});
