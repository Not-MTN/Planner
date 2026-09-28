// @vitest-environment jsdom
/**
 * The wiring, not just the pieces: with a real signed-in session, opening the
 * planner must push its state into the encrypted vault on the server.
 *
 * This is the test that was missing when the save effect silently failed to
 * apply — every part worked, and nothing was ever sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { createEmptyState } from '../types';
import { createMemoryAuthStore } from '../server/authStore';
import { resetRateLimits } from '../server/security';
import { decryptState } from './crypto';
import { getActiveSession, signUp, endSession } from './session';
import type { PlannerState } from '../types';

const store = createMemoryAuthStore();
let jar = '';

function route(path: string, method: string, body?: string): Promise<Response> {
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
    case 'GET /api/auth/links':
      return api.then((m) => m.handleLinks(request, store));
    default:
      return Promise.resolve(new Response('not found', { status: 404 }));
  }
}

beforeEach(() => {
  jar = '';
  resetRateLimits();
  window.localStorage.clear();
  window.localStorage.setItem('planner-tour-done', '1');
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '#/today');
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollTo = () => undefined;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
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

function stateWithOneTask(): PlannerState {
  const state = createEmptyState();
  return {
    ...state,
    tasks: [
      {
        id: 'task-1',
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
      },
    ],
  };
}

describe('saving to the vault', () => {
  it('writes the planner to the encrypted vault when it opens signed in', async () => {
    await signUp({
      username: 'mira',
      email: 'mira@example.com',
      displayName: 'Mira',
      role: 'personal',
      password: 'a-long-enough-password',
      initialState: createEmptyState(),
      remember: false,
    });
    const session = getActiveSession();
    expect(session).not.toBeNull();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <App initialState={stateWithOneTask()} />
        </StrictMode>,
      );
    });

    // The save is debounced, and the account already has a version 1 vault from
    // sign-up — so wait for a *new* version rather than any vault at all.
    let saved: { version: number; ciphertext: string } | null = null;
    let decrypted: PlannerState | null = null;
    for (let attempt = 0; attempt < 60 && decrypted?.tasks[0]?.title !== 'Buy bread'; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      const response = await fetch('/api/auth/vault', { method: 'GET' });
      if (!response.ok) continue;
      saved = (await response.json()) as { version: number; ciphertext: string };
      if (saved.version < 2) continue;
      decrypted = await decryptState(saved.ciphertext, session!.dek);
    }

    expect(decrypted?.tasks[0]?.title).toBe('Buy bread');
    act(() => root.unmount());
    container.remove();
  }, 90_000);
});
