// @vitest-environment jsdom
/**
 * Link syncing belongs to the planner, not to a page.
 *
 * A student should pass a guardian's note on, and a guardian should pick up new
 * results and notices, whether or not they happen to open the panel page. This
 * test watches for those calls from the dashboard, where an earlier version of
 * the wiring only ran inside the panel views themselves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { createEmptyState } from '../types';
import type { GuardianLink, PlannerState } from '../types';

const calls = { relay: 0, share: 0, sync: 0, refresh: 0, notices: 0 };

vi.mock('../auth/links', () => ({
  relayNotices: vi.fn(async (panels: unknown) => {
    calls.relay += 1;
    return { panels, relayed: 0 };
  }),
  shareWeeklyResults: vi.fn(async (_state: unknown, panels: unknown) => {
    calls.share += 1;
    return { panels, sent: 0 };
  }),
  syncLinks: vi.fn(async (panels: unknown) => {
    calls.sync += 1;
    return { panels, changed: false };
  }),
  refreshResults: vi.fn(async (panels: unknown) => {
    calls.refresh += 1;
    return { panels, changed: false };
  }),
  readNotices: vi.fn(async (panels: unknown) => {
    calls.notices += 1;
    return { panels, changed: false };
  }),
  removeLink: vi.fn(async (panels: unknown) => ({ panels })),
  postNotice: vi.fn(async (panels: unknown) => panels),
  markNoticesRead: vi.fn((panels: unknown) => panels),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function stateWithGuardian(): PlannerState {
  const state = createEmptyState();
  const link: GuardianLink = {
    id: 'link-1',
    username: 'sam',
    displayName: 'Sam',
    status: 'linked',
    history: [],
    linkId: '22222222-2222-2222-2222-222222222222',
    code: null,
    wrappedShareKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
    results: null,
  };
  return {
    ...state,
    panels: {
      ...state.panels,
      guardian: { enabled: true, kind: 'parent', field: 'Mathematics', links: [link], notices: [] },
    },
  };
}

beforeEach(() => {
  calls.relay = 0;
  calls.share = 0;
  calls.sync = 0;
  calls.refresh = 0;
  calls.notices = 0;
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
});

describe('panel link syncing', () => {
  it('runs from the dashboard, without anyone opening the panel page', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <StrictMode>
          <App initialState={stateWithGuardian()} />
        </StrictMode>,
      );
    });

    // The planner waits a few seconds after a change before it goes looking,
    // so give it room rather than asserting immediately.
    for (let attempt = 0; attempt < 40 && calls.refresh === 0; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
    }

    expect(calls.sync).toBeGreaterThan(0);
    expect(calls.refresh).toBeGreaterThan(0);
    expect(calls.notices).toBeGreaterThan(0);
    // No student panel here, so nothing is shared or relayed.
    expect(calls.share).toBe(0);
    expect(calls.relay).toBe(0);
  }, 60_000);
});
