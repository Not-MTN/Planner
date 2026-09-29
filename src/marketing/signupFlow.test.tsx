// @vitest-environment jsdom
/**
 * The whole sign-up journey through the real UI: real forms, real Argon2id,
 * the real API handlers. These are the paths users actually walk — a rejected
 * username, an API failure, and the final hop into the planner — which unit
 * tests of either half never cover.
 */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Site } from './Site';
import { resetRateLimits } from '../server/security';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  class StubObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = StubObserver;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
});

let container: HTMLDivElement;
let root: Root;
let requests: string[] = [];
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  requests = [];
  resetRateLimits();
  window.localStorage.clear();

  // The planner is entered with a real page load, which jsdom cannot perform —
  // a stand-in location records the attempt instead.
  assign = vi.fn();
  vi.stubGlobal('location', { pathname: '/signup', assign });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, 'https://planner.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      requests.push(`${method} ${path}`);
      const request = new Request(`https://planner.test${path}`, {
        method,
        body: init?.body ? String(init?.body) : undefined,
      });
      const { handleApiRequest } = await import('../server/apiRouter');
      return handleApiRequest(request, {});
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderAt(path: string) {
  vi.stubGlobal('location', { pathname: path, assign });
  window.history.pushState({}, '', path);
  await act(async () => {
    root.render(
      <StrictMode>
        <Site />
      </StrictMode>,
    );
  });
}

function setValue(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setChecked(input: HTMLInputElement, checked: boolean) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
    setter?.call(input, checked);
    input.dispatchEvent(new Event('click', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(element: Element | null | undefined) {
  await act(async () => {
    (element as HTMLButtonElement | null | undefined)?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 30_000) {
  await act(async () => {
    for (let waited = 0; waited < timeoutMs && !predicate(); waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
}

const buttonStartingWith = (text: string) =>
  [...container.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim().startsWith(text));

const signUpCalls = () => requests.filter((line) => line === 'POST /api/auth/signup');

async function fillDetails({ username, name = 'Omid Hashemi', email = '' }: { username: string; name?: string; email?: string }) {
  const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[];
  setValue(inputs[0]!, name);
  setValue(inputs[1]!, username);
  setValue(inputs[2]!, email);
  setValue(inputs[3]!, 'a-long-enough-password');
  setChecked(inputs[4]!, true);
}

describe('sign-up journey', () => {
  it('explains the username rules instead of letting the server reject it vaguely', async () => {
    await renderAt('/signup');
    await fillDetails({ username: 'omid hashemi' });
    await click(container.querySelector('form.auth-fields button[type="submit"]'));

    // Still on step one, with the actual rule — and no request was made.
    expect(container.textContent).toContain('Create your planner');
    expect(container.textContent).not.toContain('Add a panel?');
    expect(container.querySelector('.auth-error')?.textContent).toBe('Use 3–24 characters: English letters, numbers, or underscores.');
    expect(signUpCalls()).toHaveLength(0);

    // A username the rules accept moves on.
    await fillDetails({ username: 'omid_hashemi' });
    await click(container.querySelector('form.auth-fields button[type="submit"]'));
    expect(container.textContent).toContain('Add a panel?');
  });

  it('shows what the server said when the API fails without a code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'The accounts database could not be reached. Try again shortly.' } }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await renderAt('/signup');
    await fillDetails({ username: 'omidhashemi' });
    await click(container.querySelector('form.auth-fields button[type="submit"]'));
    await click(buttonStartingWith('Continue'));

    await waitFor(() => Boolean(container.querySelector('.auth-error')));
    expect(container.querySelector('.auth-error')?.textContent).toBe(
      'The accounts database could not be reached. Try again shortly.',
    );
    expect(container.textContent).toContain('Add a panel?');
  }, 60_000);

  it('creates the account, then opens the planner with a real page load', async () => {
    await renderAt('/signup');
    await fillDetails({ username: 'omidhashemi' });
    await click(container.querySelector('form.auth-fields button[type="submit"]'));

    // Default role is "personal" — Continue creates the account.
    await click(buttonStartingWith('Continue'));
    await waitFor(() => container.textContent.includes('Save your recovery key'));
    expect(signUpCalls()).toHaveLength(1);
    expect(container.querySelector('.auth-error')).toBeNull();

    // The recovery key must be confirmed before the planner opens.
    const saved = [...container.querySelectorAll('input')].at(-1) as HTMLInputElement;
    setChecked(saved, true);
    await click(buttonStartingWith('Open my planner'));

    // pushState alone would leave the marketing site on screen at /app.
    expect(assign).toHaveBeenCalledWith('/app');
  }, 60_000);

  it('resets a password from the recovery screen, issues a new key, and returns to sign-in', async () => {
    const { signUp, endSession } = await import('../auth/session');
    const { createEmptyState } = await import('../types');
    const created = await signUp({
      username: 'recoverflow',
      email: 'recoverflow@example.com',
      displayName: 'Recovery Flow',
      role: 'personal',
      password: 'a-long-enough-password',
      initialState: createEmptyState(),
      remember: false,
    });
    endSession();

    await renderAt('/recover');
    const inputs = [...container.querySelectorAll('input[type="text"], input[type="password"]')] as HTMLInputElement[];
    setValue(inputs[0]!, 'recoverflow');
    setValue(inputs[1]!, 'plnr-AAAA-AAAA-AAAA-AAAA-AAAA');
    setValue(inputs[2]!, 'a-different-long-password');
    setValue(inputs[3]!, 'a-different-long-password');
    await click(container.querySelector('form.auth-fields button[type="submit"]'));
    await waitFor(() => Boolean(container.querySelector('.auth-error')));
    expect(container.querySelector('.auth-error')?.textContent).toContain('do not match');

    setValue(inputs[1]!, created.recoveryKey);
    await click(container.querySelector('form.auth-fields button[type="submit"]'));
    await waitFor(() => container.textContent?.includes('Password updated') ?? false);
    expect(container.textContent).toContain('Save this new recovery key somewhere safe.');
    expect(container.textContent).toContain('plnr-');

    const saved = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    setChecked(saved, true);
    await click(buttonStartingWith('Back to sign in'));
    expect(container.querySelector('.auth-head h1')?.textContent).toBe('Welcome back');
    expect(requests).toContain('POST /api/auth/recovery/start');
    expect(requests).toContain('POST /api/auth/recovery/complete');
  }, 60_000);

  it('opens the planner the same way after signing in', async () => {
    // An existing account, created straight through the client.
    const { signUp } = await import('../auth/session');
    const { createEmptyState } = await import('../types');
    await signUp({
      username: 'sara',
      email: '',
      displayName: 'Sara',
      role: 'personal',
      password: 'a-long-enough-password',
      initialState: createEmptyState(),
      remember: false,
    });
    requests = [];

    await renderAt('/login');
    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[];
    setValue(inputs[0]!, 'sara');
    setValue(inputs[1]!, 'a-long-enough-password');
    await click(container.querySelector('form.auth-fields button[type="submit"]'));

    await waitFor(() => assign.mock.calls.length > 0);
    expect(assign).toHaveBeenCalledWith('/app');
    expect(requests).toContain('POST /api/auth/login');
  }, 60_000);
});
