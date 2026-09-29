// @vitest-environment jsdom
/**
 * The gate in front of /app. Two paths matter most when something is wrong:
 * a dead connection must still open the planner, and a live session without the
 * key must ask for the password instead of waving someone through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccountGate } from './AccountGate';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function text(): string {
  return document.body.textContent ?? '';
}

async function mount(): Promise<void> {
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
  // Let the boot request settle.
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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

describe('account gate', () => {
  it('opens the planner from the local copy when there is no connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    await mount();
    expect(text()).toContain('Personal Planner');
    expect(text()).not.toContain('Unlock your planner');
  });

  it('names a protected deployment instead of bouncing to a sign-in form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<html><head><title>Protected Deployment – Vercel</title></head><body>Log in to Vercel</body></html>', {
          status: 401,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    await mount();
    expect(text()).toContain("Can't open your planner");
    expect(text()).toContain('Vercel Authentication');
    expect(text()).toContain('Retry');
    // Never the old silent redirect to a form that cannot work.
    expect(text()).not.toContain('Unlock your planner');
    expect(text()).not.toContain('Personal Planner');
  });

  it('asks for the password when the session is known but the key is not', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/api/auth/session')) {
          return jsonResponse({
            user: { id: 'u1', username: 'omid', email: null, displayName: 'Omid', role: 'student', createdAt: new Date().toISOString() },
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    await mount();
    expect(text()).toContain('Unlock your planner');
    expect(text()).toContain('Omid');
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    // The planner itself must not be reachable yet.
    expect(text()).not.toContain('Personal Planner');
  });
});
