// @vitest-environment jsdom
/**
 * A planned lesson with a length is a promise about time: when a focus
 * session outgrows it, the timer says so once — and stays quiet otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlannerProvider, usePlanner } from '../context';
import { todayISO } from '../dates';
import { setLang } from '../i18n';
import { createEmptyState, type GuardianPlan, type PlannerState } from '../types';
import { FocusTimer } from './FocusTimer';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const messages: string[] = [];

function planWithLesson(minutes: number | null): PlannerState {
  const state = createEmptyState();
  const today = todayISO();
  const plan: GuardianPlan = {
    id: 'week-1',
    author: 'Dr Noor',
    linkId: 'link-1',
    cadence: 'week',
    start: today,
    title: 'A week of lessons',
    note: '',
    field: null,
    grade: null,
    restDays: [],
    items: [
      { id: 'a', title: 'Chemistry revision', date: today, time: '08:00', minutes, subject: null, url: null, done: false },
    ],
    createdAt: `${today}T08:00:00.000Z`,
    updatedAt: `${today}T08:00:00.000Z`,
  };
  state.panels.student = {
    ...state.panels.student,
    enabled: true,
    inbox: { notices: [], plans: [plan], goals: [] },
    // Today is already reported: without this, the evening report reminder
    // (hour >= 21 local) leaks into these timer-only assertions, making the
    // suite depend on the wall clock it runs under.
    reports: [
      {
        id: 'report-today',
        planId: 'week-1',
        linkId: 'link-1',
        date: today,
        doneIds: [],
        note: '',
        createdAt: `${today}T20:00:00.000Z`,
        updatedAt: `${today}T20:00:00.000Z`,
      },
    ],
  };
  return state;
}

function Beginner({ title }: { title: string }) {
  const { startFocus, notice } = usePlanner();
  // Once per mount: startFocus gets a new identity whenever focus changes,
  // so depending on it would re-focus forever.
  useEffect(() => {
    startFocus({ taskId: null, title, minutes: 25 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (notice) messages.push(notice.message);
  }, [notice]);
  return <FocusTimer />;
}

async function mount(state: PlannerState, title: string): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <StrictMode>
        <PlannerProvider initialState={state}>
          <Beginner title={title} />
        </PlannerProvider>
      </StrictMode>,
    );
  });
}

function click(label: string): void {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(label));
  if (!button) throw new Error(`No button ${label}`);
  act(() => button.click());
}

/** The clock only turns fake once the provider has booted on real timers. */
function freezeClock(): void {
  vi.useFakeTimers();
}

beforeEach(() => {
  messages.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  setLang('en');
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

describe('the time-box nudge', () => {
  it('says so once when the session outgrows the planned minutes', async () => {
    await mount(planWithLesson(1), 'Chemistry revision');
    freezeClock();
    click('Start focusing');

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(messages).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(messages).toEqual(['Wrapping up? Chemistry revision planned 1m.']);

    // The rest of the round stays quiet about the same lesson.
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(messages).toEqual(['Wrapping up? Chemistry revision planned 1m.']);
  });

  it('stays quiet for sessions that belong to no timed lesson', async () => {
    await mount(planWithLesson(1), 'Doodling dragons');
    freezeClock();
    click('Start focusing');
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(messages).toEqual([]);
  });

  it('stays quiet when the lesson planned no minutes', async () => {
    await mount(planWithLesson(null), 'Chemistry revision');
    freezeClock();
    click('Start focusing');
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(messages).toEqual([]);
  });
});
