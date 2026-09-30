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
import { PlannerProvider, usePlanner } from '../context';
import { refreshResults } from '../auth/links';
import { createEmptyState } from '../types';
import type { GuardianLink, PlannerState } from '../types';

const calls = { relay: 0, share: 0, sync: 0, refresh: 0, notices: 0 };

vi.mock('../auth/links', () => ({
  syncStudentInbox: vi.fn(async (panels: unknown) => {
    calls.relay += 1;
    return { panels, added: { notices: [], plans: [] }, relayed: 0, changed: false };
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
  sendPlan: vi.fn(async (panels: unknown) => panels),
  dropPlan: vi.fn(async (panels: unknown) => panels),
  inviteStudent: vi.fn(async (panels: unknown) => ({ panels, invitation: null })),
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
    plans: [],
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
  vi.useRealTimers();
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

  it.each(['task', 'panel'] as const)('does not roll back a %s edit made while results are loading', async (edit) => {
    vi.useFakeTimers();
    let planner!: ReturnType<typeof usePlanner>;
    let finish!: () => void;
    let started = false;
    vi.mocked(refreshResults).mockImplementationOnce(async (panels) => new Promise((resolve) => {
      started = true;
      finish = () => resolve({
        changed: true,
        panels: { ...panels, guardian: { ...panels.guardian, links: panels.guardian.links.map((link) => ({ ...link, results: { weekOf: '2026-09-28', planned: 2, done: 1, focusMinutes: 25, subjects: [], headline: null, updatedAt: '2026-09-30T10:00:00Z' } })) } },
      });
    }));
    function Probe() { planner = usePlanner(); return null; }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root?.render(<PlannerProvider initialState={stateWithGuardian()}><Probe /></PlannerProvider>); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(started).toBe(true);
    act(() => {
      if (edit === 'task') planner.addTask({ title: 'Added while loading', category: 'Physics', priority: 'medium', dueDate: null, dueTime: null, note: '', goalId: null });
      else planner.updatePanels((current) => ({ ...current, student: { ...current.student, subjects: [{ id: 'new-subject', name: 'Physics', accent: 'blue', examDate: null, targetMinutes: 60 }] } }));
    });
    await act(async () => { finish(); await Promise.resolve(); });
    if (edit === 'task') {
      expect(planner.state.tasks[0]?.title).toBe('Added while loading');
      expect(planner.panels.guardian.links[0].results?.done).toBe(1);
    } else {
      expect(planner.panels.student.subjects[0]?.name).toBe('Physics');
      // The stale panels snapshot is deferred; a later sync will fetch it again.
      expect(planner.panels.guardian.links[0].results).toBeNull();
    }
  });

});
