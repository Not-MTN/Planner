// @vitest-environment node
/**
 * The whole account chain, end to end: real Argon2id, real AES-GCM, the real
 * client (`session.ts`) and the real API handlers, with `fetch` routed straight
 * between them and a cookie jar standing in for the browser.
 *
 * If anything in "sign up → sign in → open the vault → save → read back" breaks,
 * it breaks here, in a test, instead of for someone at their first login.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyState } from '../types';
import { createMemoryAuthStore } from '../server/authStore';
import { resetRateLimits } from '../server/security';
import type { PlannerState } from '../types';

const store = createMemoryAuthStore();
let jar = '';

function route(path: string, method: string, body?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jar) headers.Cookie = jar;
  const request = new Request(`https://planner.test${path}`, { method, headers, body });
  switch (`${method} ${path}`) {
    case 'POST /api/auth/signup':
      return import('../server/authApi').then((m) => m.handleSignup(request, store));
    case 'POST /api/auth/salt':
      return import('../server/authApi').then((m) => m.handleSalt(request, store));
    case 'POST /api/auth/recovery/start':
      return import('../server/authApi').then((m) => m.handleRecoveryStart(request, store));
    case 'POST /api/auth/recovery/complete':
      return import('../server/authApi').then((m) => m.handleRecoveryComplete(request, store));
    case 'POST /api/auth/login':
      return import('../server/authApi').then((m) => m.handleLogin(request, store));
    case 'GET /api/auth/session':
      return import('../server/authApi').then((m) => m.handleSession(request, store));
    case 'POST /api/auth/logout':
      return import('../server/authApi').then((m) => m.handleLogout(request, store));
    case 'GET /api/auth/vault':
      return import('../server/authApi').then((m) => m.handleAccountVault(request, store));
    case 'PUT /api/auth/vault':
      return import('../server/authApi').then((m) => m.handleAccountVault(request, store));
    default:
      return Promise.resolve(new Response('not found', { status: 404 }));
  }
}

beforeEach(() => {
  jar = '';
  resetRateLimits();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, 'https://planner.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      const response = await route(path, method, init?.body ? String(init.body) : undefined);
      // The browser would keep this cookie for us.
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const pair = setCookie.split(';')[0] ?? '';
        jar = /Max-Age=0/.test(setCookie) ? '' : pair;
      }
      return response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PASSWORD = 'a-long-enough-password';
const USER = { username: 'omid', email: 'omid@example.com', displayName: 'Omid' };

/** A planner with something in it, so a round trip proves the data survived. */
function sampleState(): PlannerState {
  const state = createEmptyState();
  return {
    ...state,
    tasks: [
      {
        id: 't1',
        title: 'Finish the maths homework',
        completed: false,
        priority: 'high' as const,
        dueDate: '2026-03-04',
        dueTime: null,
        category: 'Maths',
        note: '',
        goalId: null,
        createdAt: '2026-03-01T09:00:00.000Z',
        updatedAt: '2026-03-01T09:00:00.000Z',
        subtasks: [],
        repeat: null,
        sortOrder: 0,
        waiting: null,
        estimatedMinutes: null,
      },
    ],
    notes: [
      { id: 'n1', title: 'Ideas', body: 'Private thoughts', kind: 'idea' as const, date: '2026-03-01', createdAt: '2026-03-01T09:00:00.000Z', updatedAt: '2026-03-01T09:00:00.000Z', attachments: [] },
    ],
    panels: {
      student: {
        enabled: true,
        field: 'Mathematics',
        grade: 'school-11',
        guardians: [],
        subjects: [],
        explanations: [],
      },
      guardian: { enabled: false, kind: null, field: null, links: [], notices: [] },
    },
  };
}

describe('accounts end to end', () => {
  it('signs up, signs in on a fresh device, and reads the planner back', async () => {
    const { signUp, signIn, endSession, decryptVault } = await import('./session');
    const original = sampleState();

    const { recoveryKey } = await signUp({ ...USER, role: 'student', password: PASSWORD, initialState: original, remember: false });
    expect(recoveryKey).toMatch(/^plnr-/);

    // The session cookie is the only thing the next page load keeps.
    endSession();

    const session = await signIn(USER.username, PASSWORD, false);
    expect(session.user.username).toBe(USER.username);
    expect(session.user.role).toBe('student');

    const reopened = await decryptVault();
    expect(reopened?.tasks[0]?.title).toBe('Finish the maths homework');
    expect(reopened?.notes[0]?.body).toBe('Private thoughts');
    // The panel choices made at sign-up travelled inside the encrypted vault.
    expect(reopened?.panels.student.field).toBe('Mathematics');
    expect(reopened?.panels.student.grade).toBe('school-11');
  }, 60_000);

  it('resets a forgotten password with the real recovery key and keeps the vault readable', async () => {
    const { signUp, signIn, endSession, decryptVault, resetPasswordWithRecovery, AuthError } = await import('./session');
    const original = sampleState();
    const recoveryUser = { ...USER, username: 'recover1', email: 'recover1@example.com' };
    const { recoveryKey } = await signUp({ ...recoveryUser, role: 'student', password: PASSWORD, initialState: original, remember: false });
    endSession();

    await expect(
      resetPasswordWithRecovery(recoveryUser.username, 'plnr-AAAA-AAAA-AAAA-AAAA-AAAA', 'another-long-password'),
    ).rejects.toBeInstanceOf(AuthError);

    const replacementPassword = 'a-different-long-password';
    const replacementRecoveryKey = await resetPasswordWithRecovery(recoveryUser.username, recoveryKey, replacementPassword);
    expect(replacementRecoveryKey).toMatch(/^plnr(-[A-Z2-9]{4}){5}$/);

    await expect(signIn(recoveryUser.username, PASSWORD, false)).rejects.toBeInstanceOf(AuthError);
    const session = await signIn(recoveryUser.username, replacementPassword, false);
    expect(session.user.username).toBe(recoveryUser.username);
    expect((await decryptVault())?.tasks[0]?.title).toBe('Finish the maths homework');
  }, 60_000);

  it('signs in with the email address instead of the username', async () => {
    const { signUp, signIn, endSession } = await import('./session');
    await signUp({ ...USER, username: 'kian', email: 'kian@example.com', role: 'personal', password: PASSWORD, initialState: sampleState(), remember: false });
    endSession();
    const session = await signIn('Kian@example.com', PASSWORD, false);
    expect(session.user.username).toBe('kian');
  }, 60_000);

  it('refuses the wrong password without saying which half was wrong', async () => {
    const { signUp, signIn, endSession, AuthError } = await import('./session');
    await signUp({ ...USER, username: 'naz', email: 'naz@example.com', role: 'personal', password: PASSWORD, initialState: sampleState(), remember: false });
    endSession();
    await expect(signIn('naz', 'not-the-password', false)).rejects.toBeInstanceOf(AuthError);
    await expect(signIn('nobody', PASSWORD, false)).rejects.toBeInstanceOf(AuthError);
  }, 60_000);

  it('saves the planner to the vault and reads it back from another device', async () => {
    const { signUp, signIn, endSession, pushVault, pullVault, decryptVault } = await import('./session');
    await signUp({ ...USER, username: 'sara2', email: 'sara2@example.com', role: 'personal', password: PASSWORD, initialState: sampleState(), remember: false });
    endSession();
    await signIn('sara2', PASSWORD, false);

    const edited = sampleState();
    edited.tasks[0]!.completed = true;
    edited.tasks[0]!.title = 'Finished the homework';
    const version = await pushVault(edited);
    expect(version).toBe(2);

    // A different device: same account, fresh key material.
    const { decryptState } = await import('./crypto');
    endSession();
    const second = await signIn('sara2', PASSWORD, false);
    const pulled = await pullVault();
    expect(pulled?.version).toBe(2);
    const state = await decryptState(String(pulled?.ciphertext), second.dek);
    expect(state.tasks[0]?.title).toBe('Finished the homework');
    expect(state.tasks[0]?.completed).toBe(true);
    void decryptVault;
  }, 60_000);

  it('rejects a second sign-up with the same username or email', async () => {
    const { signUp, AuthError } = await import('./session');
    await signUp({ ...USER, username: 'reza', email: 'reza@example.com', role: 'personal', password: PASSWORD, initialState: sampleState(), remember: false });
    await expect(
      signUp({ ...USER, username: 'reza', email: 'other@example.com', role: 'personal', password: PASSWORD, initialState: sampleState(), remember: false }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      signUp({ ...USER, username: 'other', email: 'reza@example.com', role: 'personal', password: PASSWORD, initialState: sampleState(), remember: false }),
    ).rejects.toBeInstanceOf(AuthError);
  }, 60_000);
});
