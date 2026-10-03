// @vitest-environment jsdom
/**
 * The screen a downloaded app lands on when the server refuses it.
 *
 * The server this repo ships points at does not list the shell origins in
 * `PLANNER_APP_ORIGINS`, so every call from the installed app is refused. The
 * browser hides that answer, the app called it "offline", and the gate opened
 * an anonymous planner — which is exactly what "the app has no login page"
 * looked like from the outside. Now the gate names the cause, keeps the retry,
 * and offers the local planner as a choice rather than a silent fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { API } = vi.hoisted(() => ({ API: 'https://planner.example.com' }));

vi.mock('../shared/nativeShell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/nativeShell')>();
  return {
    ...actual,
    isNativeShell: () => true,
    hasConfiguredApi: () => true,
    configuredApiOrigin: () => API,
  };
});

import { AccountGate } from './AccountGate';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function text(): string {
  return document.body.textContent ?? '';
}

async function settle(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

beforeEach(() => {
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
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('a shell the server refuses', () => {
  it('explains the refused origin instead of opening a planner with no way in', async () => {
    // The real call is refused at the CORS layer; the no-cors probe reaches the
    // server, which is what tells the two apart.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.mode === 'no-cors') return new Response(null, { status: 403 });
        throw new TypeError('Failed to fetch');
      }),
    );

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <StrictMode>
          <AccountGate />
        </StrictMode>,
      );
    });
    await settle();

    expect(text()).toContain("Can't open your planner");
    expect(text()).toContain('refused the app');
    expect(text()).toContain('PLANNER_APP_ORIGINS');
    expect(text()).toContain('Retry');
    // The local planner is offered, not forced — and it is not what greets you.
    expect(text()).toContain('Use Planner offline');

    const offline = [...document.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').includes('Use Planner offline'),
    );
    expect(offline).toBeTruthy();
    act(() => {
      offline?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(text()).toContain('Personal Planner');
  });
});
