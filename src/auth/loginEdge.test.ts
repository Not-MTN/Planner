// @vitest-environment node
/**
 * The ways signing in goes wrong in real life, driven through the real client
 * and the real API handlers: wrong passwords, strange capitalisation, an email
 * instead of a name, too many attempts, a session that ends, and two devices
 * saving at once.
 *
 * These are the "login always breaks" cases. If any of them regress, this file
 * is meant to be the thing that notices.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyState } from '../types';
import { createMemoryAuthStore } from '../server/authStore';
import { resetRateLimits } from '../server/security';
import { AuthError, decryptVault, endSession, getActiveSession, pullVault, pushVault, signIn, signUp } from './session';

let store = createMemoryAuthStore();
let jar = '';
/** Every test gets its own account, so one failure cannot poison the next. */
let accountNumber = 0;

async function route(path: string, method: string, body?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jar) headers.Cookie = jar;
  const request = new Request(`https://planner.test${path}`, { method, headers, body });
  const api = import('../server/authApi');
  switch (`${method} ${path}`) {
    case 'POST /api/auth/signup':
      return api.then((m) => m.handleSignup(request, store));
    case 'POST /api/auth/salt':
      return api.then((m) => m.handleSalt(request, store));
    case 'POST /api/auth/login':
      return api.then((m) => m.handleLogin(request, store));
    case 'GET /api/auth/session':
      return api.then((m) => m.handleSession(request, store));
    case 'POST /api/auth/logout':
      return api.then((m) => m.handleLogout(request, store));
    case 'GET /api/auth/vault':
      return api.then((m) => m.handleAccountVault(request, store));
    case 'PUT /api/auth/vault':
      return api.then((m) => m.handleAccountVault(request, store));
    default:
      return Promise.resolve(new Response('not found', { status: 404 }));
  }
}

beforeEach(() => {
  store = createMemoryAuthStore();
  accountNumber += 1;
  jar = '';
  resetRateLimits();
  endSession();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, 'https://planner.test').pathname;
      const response = await route(path, (init?.method ?? 'GET').toUpperCase(), init?.body ? String(init.body) : undefined);
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) jar = /Max-Age=0/.test(setCookie) ? '' : (setCookie.split(';')[0] ?? '');
      return response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  endSession();
});

const PASSWORD = 'a-long-enough-password';

function username(): string {
  return accountNumber % 2 === 0 ? 'Elena' : 'elena';
}

function email(): string {
  return `${username()}@Example.com`;
}

async function join() {
  return signUp({
    username: username(),
    email: email(),
    displayName: 'Elena',
    role: 'personal',
    password: PASSWORD,
    initialState: createEmptyState(),
    remember: false,
  });
}

describe('signing in', () => {
  it('says the same thing for a wrong password and for a stranger', async () => {
    await join();
    endSession();

    let wrongPassword = '';
    try {
      await signIn(username(), 'not-the-password', false);
    } catch (error) {
      wrongPassword = error instanceof AuthError ? error.message : String(error);
    }
    endSession();

    let stranger = '';
    try {
      await signIn('nobody-here', 'not-the-password', false);
    } catch (error) {
      stranger = error instanceof AuthError ? error.message : String(error);
    }

    expect(wrongPassword).toBe(stranger);
    expect(wrongPassword.toLowerCase()).toContain('wrong');
  });

  it('accepts the username in any case, and the email too', async () => {
    await join();
    endSession();

    const name = username();
    for (const identifier of [name.toLowerCase(), name.toUpperCase(), name, email().toUpperCase(), email().toLowerCase()]) {
      const account = await signIn(identifier, PASSWORD, false);
      expect(account.user.username.toLowerCase()).toBe(name.toLowerCase());
      endSession();
    }
  }, 90_000);

  it('gives the vault back on the second device, encrypted the same way', async () => {
    await join();
    const first = getActiveSession()!;
    await pushVault(createEmptyState());
    endSession();

    await signIn(username(), PASSWORD, false);
    const second = getActiveSession()!;
    // Derived again, never stored: a different key object holding the same secret.
    expect(second.dek).not.toBe(first.dek);
    const pulled = await pullVault();
    expect(pulled?.version).toBeGreaterThan(0);
  });

  it('slows down after too many attempts, and lets you in afterwards', async () => {
    await join();
    endSession();

    // Straight at the endpoint with a wrong token: no password stretching, so
    // this stays quick while still exercising the same limiter.
    let lastStatus = 0;
    let lastBody = '';
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username(), authToken: 'a'.repeat(43) }),
      });
      lastStatus = response.status;
      lastBody = await response.text();
    }
    expect(lastStatus).toBe(429);
    expect(lastBody.toLowerCase()).toContain('too many');

    // The brake releases, and the right password works again.
    resetRateLimits();
    const account = await signIn(username(), PASSWORD, false);
    expect(account.user.username.toLowerCase()).toBe(username().toLowerCase());
  });

  it('ends the session when you sign out, and the old cookie stops working', async () => {
    await join();
    const response = await fetch('/api/auth/session', { method: 'GET' });
    expect(response.status).toBe(200);
    const out = await fetch('/api/auth/logout', { method: 'POST', body: '{}' });
    expect(out.status).toBe(200);
    const after = await fetch('/api/auth/session', { method: 'GET' });
    expect(after.status).toBe(401);
  });

  it('refuses a password that is too short before it ever reaches the server', async () => {
    await join();
    endSession();
    await expect(signIn(username(), 'short', false)).rejects.toBeInstanceOf(AuthError);
  });

  it('reports a conflict instead of letting one device overwrite another', async () => {
    await join();
    await pushVault(createEmptyState());
    const staleVersion = getActiveSession()!.vault.version;
    endSession();

    // The other device saves first, moving the version on.
    await signIn('elena', PASSWORD, false);
    await pushVault(createEmptyState());
    endSession();

    // Back on the first device, still believing in the older version.
    await signIn(username(), PASSWORD, false);
    const session = getActiveSession()!;
    const conflict = await fetch('/api/auth/vault', {
      method: 'PUT',
      body: JSON.stringify({ baseVersion: staleVersion, ciphertext: session.vault.ciphertext }),
    });
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBeTruthy();
  });

  it('keeps a saved vault readable after signing in again', async () => {
    await join();
    const state = createEmptyState();
    state.tasks.push({
      id: 't1',
      title: 'Buy bread',
      completed: false,
      priority: 'medium',
      dueDate: null,
      dueTime: null,
      category: 'Home',
      note: '',
      goalId: null,
      createdAt: '2026-03-02T09:00:00.000Z',
      updatedAt: '2026-03-02T09:00:00.000Z',
      subtasks: [],
      repeat: null,
      sortOrder: 0,
      waiting: null,
      estimatedMinutes: null,
    });
    await pushVault(state);
    endSession();

    // A fresh sign-in opens the same vault with a key derived from scratch.
    await signIn(username(), PASSWORD, false);
    const pulled = await pullVault();
    expect(pulled?.ciphertext).toBeTruthy();
    // decryptVault uses the session's own key, which was derived from scratch.
    const decrypted = await decryptVault();
    expect(decrypted?.tasks[0]?.title).toBe('Buy bread');
  });
});
