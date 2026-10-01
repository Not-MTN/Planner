import { describe, expect, it } from 'vitest';
import {
  handleAccountDelete,
  handleAccountVault,
  handleLogin,
  handleLogout,
  handleRecoveryComplete,
  handleRecoveryStart,
  handleRecoveryUpdate,
  handleSalt,
  handleSession,
  handleSessions,
  handleSignup,
  handleTotpConfirm,
  handleTotpDisable,
  handleTotpLogin,
  handleTotpSetup,
  deviceLabel,
  readTwoStepToken,
  readSessionToken,
} from './authApi';
import { currentTotpCode } from './totp';
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

function del(path: string, body: unknown, cookie?: string): Request {
  return new Request(`https://planner.test${path}`, {
    method: 'DELETE',
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
  recoveryHashes: [
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  ],
  wrappedDek: 'd3JhcHBlZERla3dyYXBwZWREZWt3cmFwcGVkRGVrMTI=',
  wrappedRecovery: [
    'eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5',
    'enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6',
    'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
  ],
  ciphertext: 'dmF1bHRjaXBoZXJ0ZXh0',
};

function cookieFrom(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}

describe('device label', () => {
  const label = (agent: string | null) =>
    deviceLabel(new Request('https://planner.test/api/auth/login', { headers: agent ? { 'User-Agent': agent } : {} }));

  it('names the browser and the system without fingerprinting them', () => {
    expect(label('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')).toBe('Chrome on Mac');
    expect(label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0')).toBe('Edge on Windows');
    expect(label('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(label('Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0')).toBe('Firefox on Linux');
    // Chrome is checked before Safari: a Chromium agent mentions both.
    expect(label('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')).not.toContain('Safari');
  });

  it('falls back to something readable instead of failing', () => {
    expect(label('')).toBe('Unknown device');
    expect(label(null)).toBe('Unknown device');
    expect(label('curl/8.4.0')).toBe('Unknown device');
    expect(label('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
  });
});

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

  it('deletes an account only after password re-verification and clears its session', async () => {
    resetRateLimits();
    const store = STORE();
    const signup = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const cookie = cookieFrom(signup);

    const rejected = await handleAccountDelete(del('/api/auth/account', { authToken: 'YmFkYXV0aHRva2VuMTIzNDU2Nzg5MA==' }, cookie), store);
    expect(rejected.status).toBe(401);
    expect(await store.findAccount('sara')).not.toBeNull();

    resetRateLimits();
    const removed = await handleAccountDelete(del('/api/auth/account', { authToken: ACCOUNT.authToken }, cookie), store);
    expect(removed.status).toBe(200);
    expect(removed.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await store.findAccount('sara')).toBeNull();
    expect((await handleSession(get('/api/auth/session', cookie), store)).status).toBe(401);
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

  it('does not reveal whether a recovery identifier exists', async () => {
    resetRateLimits();
    const store = STORE();
    await handleSignup(post('/api/auth/signup', ACCOUNT), store);

    const known = await handleRecoveryStart(post('/api/auth/recovery/start', { username: 'sara' }), store);
    const unknown = await handleRecoveryStart(post('/api/auth/recovery/start', { username: 'nobody' }), store);
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    const knownBody = (await known.json()) as { kdfSalt: string; wrappedRecovery: string[] };
    const unknownBody = (await unknown.json()) as { kdfSalt: string; wrappedRecovery: string[] };
    expect(Object.keys(unknownBody).sort()).toEqual(Object.keys(knownBody).sort());
    expect(knownBody.kdfSalt).toBe(ACCOUNT.kdfSalt);
    // Every wrapped copy comes back, so the browser can try each one.
    expect(knownBody.wrappedRecovery).toEqual(ACCOUNT.wrappedRecovery);
    expect(unknownBody.kdfSalt).not.toBe(knownBody.kdfSalt);
    // The decoy is the same shape as a real answer — a list of opaque blobs —
    // so an unknown name cannot be picked out of the response.
    expect(Array.isArray(unknownBody.wrappedRecovery)).toBe(true);
    expect(unknownBody.wrappedRecovery.length).toBeGreaterThan(0);
    expect(unknownBody.wrappedRecovery[0]).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('rotates credentials and wrapped keys only with the recovery verifier, then revokes sessions', async () => {
    resetRateLimits();
    const store = STORE();
    const signup = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const oldCookie = cookieFrom(signup);
    const newRecoveryHashes = [
      'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
      'AgECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
      'AwECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
    ];
    const update = {
      username: 'sara',
      // Any code in the set opens the account, not just the first one.
      recoveryHash: ACCOUNT.recoveryHashes[2],
      newRecoveryHashes,
      kdfSalt: 'bmV3LXNhbHQtMDEyMzQ1Ng==',
      authToken: 'bm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm4=',
      wrappedDek: 'eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4',
      wrappedRecovery: [
        'eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5',
        'enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6',
        'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
      ],
    };

    const wrong = await handleRecoveryComplete(
      post('/api/auth/recovery/complete', { ...update, recoveryHash: newRecoveryHashes[0] }),
      store,
    );
    expect(wrong.status).toBe(401);

    // A set that does not line up with its verifiers is refused outright.
    resetRateLimits();
    const mismatched = await handleRecoveryComplete(
      post('/api/auth/recovery/complete', { ...update, wrappedRecovery: update.wrappedRecovery.slice(0, 2) }),
      store,
    );
    expect(mismatched.status).toBe(400);

    resetRateLimits();
    const completed = await handleRecoveryComplete(post('/api/auth/recovery/complete', update), store);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({ ok: true });

    const staleSession = await handleSession(get('/api/auth/session', oldCookie), store);
    expect(staleSession.status).toBe(401);

    const newLogin = await handleLogin(post('/api/auth/login', { username: 'sara', authToken: update.authToken }), store);
    expect(newLogin.status).toBe(200);
    const body = (await newLogin.json()) as LoginResponse;
    expect(body.kdfSalt).toBe(update.kdfSalt);
    expect(body.wrappedDek).toBe(update.wrappedDek);

    const oldLogin = await handleLogin(post('/api/auth/login', { username: 'sara', authToken: ACCOUNT.authToken }), store);
    expect(oldLogin.status).toBe(401);
  });

  it('replaces the recovery codes of a signed-in account, and only of that account', async () => {
    resetRateLimits();
    const store = STORE();
    const signup = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const cookie = cookieFrom(signup);

    const next = {
      newRecoveryHashes: ['BAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiM=', 'BQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQ='],
      kdfSalt: ACCOUNT.kdfSalt,
      authToken: ACCOUNT.authToken,
      wrappedDek: ACCOUNT.wrappedDek,
      wrappedRecovery: [
        'eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5',
        'enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6',
      ],
    };

    // Without a session there is nothing to rotate.
    const anon = await handleRecoveryUpdate(post('/api/auth/recovery/update', next), store);
    expect(anon.status).toBe(401);

    const updated = await handleRecoveryUpdate(post('/api/auth/recovery/update', next, cookie), store);
    expect(updated.status).toBe(200);

    // The old codes are gone: recovery with one of them must now fail.
    resetRateLimits();
    const stale = await handleRecoveryComplete(
      post('/api/auth/recovery/complete', {
        username: 'sara',
        recoveryHash: ACCOUNT.recoveryHashes[0],
        newRecoveryHashes: next.newRecoveryHashes,
        kdfSalt: next.kdfSalt,
        authToken: next.authToken,
        wrappedDek: next.wrappedDek,
        wrappedRecovery: next.wrappedRecovery,
      }),
      store,
    );
    expect(stale.status).toBe(401);

    // And the new set works, from any one of its codes.
    resetRateLimits();
    const fresh = await handleRecoveryComplete(
      post('/api/auth/recovery/complete', {
        username: 'sara',
        recoveryHash: next.newRecoveryHashes[1],
        newRecoveryHashes: next.newRecoveryHashes,
        kdfSalt: next.kdfSalt,
        authToken: next.authToken,
        wrappedDek: next.wrappedDek,
        wrappedRecovery: next.wrappedRecovery,
      }),
      store,
    );
    expect(fresh.status).toBe(200);
  });

  it('lists the account’s devices, marks the current one, and revokes by id only for its owner', async () => {
    resetRateLimits();
    const store = STORE();
    const signup = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const cookie = cookieFrom(signup);

    // A second sign-in from a different browser is a second device.
    resetRateLimits();
    const second = await handleLogin(post('/api/auth/login', { username: 'sara', authToken: ACCOUNT.authToken }), store);
    const secondCookie = cookieFrom(second);

    const anon = await handleSessions(get('/api/auth/sessions'), store);
    expect(anon.status).toBe(401);

    const listed = await handleSessions(get('/api/auth/sessions', cookie), store);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      current: string;
      sessions: { id: string; label: string; current?: boolean }[];
    };
    expect(body.sessions).toHaveLength(2);
    // The token hash is never sent: a stolen list must not be a sign-in.
    expect(JSON.stringify(body)).not.toContain('token');
    expect(body.sessions.some((session) => session.id === body.current)).toBe(true);

    const other = body.sessions.find((session) => session.id !== body.current)!;
    const revoked = await handleSessions(del('/api/auth/sessions', { id: other.id }, cookie), store);
    expect(revoked.status).toBe(200);
    expect((await revoked.json() as { removed: number }).removed).toBe(1);

    // That session is really gone: its cookie no longer opens the account.
    resetRateLimits();
    expect((await handleSession(get('/api/auth/session', secondCookie), store)).status).toBe(401);

    // Already gone is a plain 404, not a success.
    resetRateLimits();
    expect((await handleSessions(del('/api/auth/sessions', { id: other.id }, cookie), store)).status).toBe(404);

    const after = (await (await handleSessions(get('/api/auth/sessions', cookie), store)).json()) as {
      sessions: { id: string }[];
    };
    expect(after.sessions).toHaveLength(1);
  });

  it('signs out every other device but keeps the one being used', async () => {
    resetRateLimits();
    const store = STORE();
    const signup = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const cookie = cookieFrom(signup);

    resetRateLimits();
    await handleLogin(post('/api/auth/login', { username: 'sara', authToken: ACCOUNT.authToken }), store);
    resetRateLimits();
    await handleLogin(post('/api/auth/login', { username: 'sara', authToken: ACCOUNT.authToken }), store);

    const before = (await (await handleSessions(get('/api/auth/sessions', cookie), store)).json()) as {
      sessions: { id: string }[];
      current: string;
    };
    expect(before.sessions).toHaveLength(3);

    resetRateLimits();
    const cleared = await handleSessions(del('/api/auth/sessions', { others: true }, cookie), store);
    expect(cleared.status).toBe(200);
    expect((await cleared.json() as { removed: number }).removed).toBe(2);

    const after = (await (await handleSessions(get('/api/auth/sessions', cookie), store)).json()) as {
      sessions: { id: string }[];
      current: string;
    };
    expect(after.sessions).toHaveLength(1);
    expect(after.sessions[0]!.id).toBe(before.current);

    // A malformed id is refused before it reaches the database.
    resetRateLimits();
    expect((await handleSessions(del('/api/auth/sessions', { id: 'not-a-uuid' }, cookie), store)).status).toBe(400);
  });

  it('makes an authenticator app a second step, and signs nobody in without it', async () => {
    resetRateLimits();
    const store = STORE();
    const signup = await handleSignup(post('/api/auth/signup', ACCOUNT), store);
    const cookie = cookieFrom(signup);

    // Setting up needs a session, and hands out a secret that does nothing yet.
    const anon = await handleTotpSetup(post('/api/auth/totp/setup', undefined), store);
    expect(anon.status).toBe(401);

    const started = await handleTotpSetup(post('/api/auth/totp/setup', undefined, cookie), store);
    expect(started.status).toBe(200);
    const setup = (await started.json()) as { secret: string; formatted: string; uri: string; confirmed: boolean };
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.confirmed).toBe(false);
    expect(setup.uri).toContain('otpauth://totp/');

    // An unconfirmed secret must not change how sign-in behaves.
    resetRateLimits();
    const stillOpen = await handleLogin(post('/api/auth/login', { username: 'sara', authToken: ACCOUNT.authToken }), store);
    expect(stillOpen.status).toBe(200);
    expect('wrappedDek' in (await stillOpen.json() as object)).toBe(true);

    // Confirming needs a real code from that secret.
    resetRateLimits();
    const wrong = await handleTotpConfirm(post('/api/auth/totp/confirm', { code: '000000' }, cookie), store);
    expect(wrong.status).toBe(401);

    resetRateLimits();
    const confirmed = await handleTotpConfirm(
      post('/api/auth/totp/confirm', { code: currentTotpCode(setup.secret)! }, cookie),
      store,
    );
    expect(confirmed.status).toBe(200);

    // Now the password alone is not enough: no session, just a challenge.
    resetRateLimits();
    const gated = await handleLogin(post('/api/auth/login', { username: 'sara', authToken: ACCOUNT.authToken }), store);
    expect(gated.status).toBe(200);
    expect(await gated.json()).toEqual({ secondFactor: 'totp' });
    const challenge = cookieFrom(gated);
    expect(readTwoStepToken(get('/api/auth/session', challenge))).toBeTruthy();
    // But it is not a session: it opens nothing.
    resetRateLimits();
    expect((await handleSession(get('/api/auth/session', challenge), store)).status).toBe(401);

    // A code is what finishes the sign-in.
    resetRateLimits();
    const badCode = await handleTotpLogin(post('/api/auth/totp/login', { code: '000000' }, challenge), store);
    expect(badCode.status).toBe(401);

    resetRateLimits();
    const finished = await handleTotpLogin(
      post('/api/auth/totp/login', { code: currentTotpCode(setup.secret)! }, challenge),
      store,
    );
    expect(finished.status).toBe(200);
    const session = cookieFrom(finished);
    expect(session).toContain('planner_session=');
    resetRateLimits();
    expect((await handleSession(get('/api/auth/session', session), store)).status).toBe(200);

    // The one code cannot be spent twice.
    resetRateLimits();
    expect((await handleTotpLogin(post('/api/auth/totp/login', { code: currentTotpCode(setup.secret)! }, challenge), store)).status).toBe(401);
  });

  it('turns the second step off only with a current code', async () => {
    resetRateLimits();
    const store = STORE();
    const cookie = cookieFrom(await handleSignup(post('/api/auth/signup', ACCOUNT), store));
    const { secret } = (await (await handleTotpSetup(post('/api/auth/totp/setup', undefined, cookie), store)).json()) as { secret: string };

    resetRateLimits();
    await handleTotpConfirm(post('/api/auth/totp/confirm', { code: currentTotpCode(secret)! }, cookie), store);

    resetRateLimits();
    expect((await handleTotpDisable(post('/api/auth/totp/disable', { code: '000000' }, cookie), store)).status).toBe(401);

    // Turning it off straight away must work with the code still on screen.
    // The replay guard belongs to sign-in alone: here you already hold a
    // session, so refusing the current step would only make people wait.
    resetRateLimits();
    expect((await handleTotpDisable(post('/api/auth/totp/disable', { code: currentTotpCode(secret)! }, cookie), store)).status).toBe(200);

    // Sign-in is back to the password alone.
    resetRateLimits();
    const plain = await handleLogin(post('/api/auth/login', { username: 'sara', authToken: ACCOUNT.authToken }), store);
    expect(plain.status).toBe(200);
    expect('wrappedDek' in (await plain.json() as object)).toBe(true);
  });

  it('reports 503 when no database is configured', async () => {
    resetRateLimits();
    const response = await handleSignup(post('/api/auth/signup', ACCOUNT), null);
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('not_configured');
  });
});
