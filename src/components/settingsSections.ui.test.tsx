// @vitest-environment jsdom
/**
 * Settings screens that do real work: the syllabus importer and the retention
 * window.
 *
 * The parsers and the rollup have their own tests; these hold the promises the
 * screens make. For the syllabus: nothing reaches the planner until it is asked
 * for, and the term plan that lands is the one that was previewed. For
 * retention: the window is a real setting, and the rollup really runs — a week
 * outside the window loses its detail while its numbers stay, on the next boot,
 * without anyone pressing anything.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { STORAGE_KEY, serialize } from '../storage';
import { addDays, startOfWeek, todayISO } from '../dates';
import { addTask, toggleTask } from '../mutate';
import { createEmptyState } from '../types';
import { RETENTION_KEY } from '../retention';
import { loadWeekStart, setWeekStart } from '../dates';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function text(): string {
  return document.body.textContent ?? '';
}

function click(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`No element for ${selector}`);
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function clickByText(needle: string): void {
  const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes(needle));
  if (!button) throw new Error(`No button saying "${needle}"`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function setValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
  act(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function waitForText(needle: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!text().includes(needle)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for "${needle}"`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
}

function saved(): string {
  return window.localStorage.getItem(STORAGE_KEY) ?? '';
}

const SYLLABUS = `CS 201 — Thermodynamics
Term starts 15 September 2025

Week 1: Introduction and units
Week 2: The first law
Midterm exam — 15 October 2025 — worth 30%`;

function mountApp(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
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
  mountApp();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe('planning a term from a pasted syllabus', () => {
  it('shows what it read back, and adds nothing until asked', async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    await waitForText('Today');
    click('.side-tool[data-tour="settings"]');
    await waitForText('Connections');
    click('#set-tab-connections');
    await waitForText('Plan a term from a syllabus');

    const area = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste the syllabus here"]');
    expect(area, 'the syllabus box was not on screen').toBeTruthy();
    setValue(area!, SYLLABUS);
    clickByText('Read the syllabus');

    await waitForText('Syllabus read');
    expect(text()).toContain('2 teaching weeks');
    expect(text()).toContain('1 assessment');
    expect(text()).toContain('Midterm exam');
    // Still nothing in the planner: the preview is a promise, not a write.
    expect(window.localStorage.getItem(STORAGE_KEY) ?? '').not.toContain('Thermodynamics');

    clickByText('Add to planner');
    await waitForText('imported');
    const stored = window.localStorage.getItem(STORAGE_KEY) ?? '';
    expect(stored).toContain('Week 1: Introduction and units');
    expect(stored).toContain('Midterm exam');
    expect(stored).toContain('2025-09-15');
  });

  it('says so when the text holds no weeks at all', async () => {
    await waitForText('Today');
    click('.side-tool[data-tour="settings"]');
    await waitForText('Connections');
    click('#set-tab-connections');
    await waitForText('Plan a term from a syllabus');

    const area = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste the syllabus here"]');
    setValue(area!, 'Office hours are on Tuesdays.\nBring a calculator.');
    clickByText('Read the syllabus');

    await waitForText('Nothing in that text looked like a term plan');
    expect(text()).not.toContain('Syllabus read');
  });
});

describe('the week start default', () => {
  it('is Monday when nothing has been chosen yet', () => {
    // `Number(null)` is 0, which is Sunday: reading the stored value without
    // checking for "nothing stored" made a fresh device start its weeks on
    // Sunday, against the documented default.
    window.localStorage.removeItem('planner-week-start');
    expect(loadWeekStart()).toBe(1);
    window.localStorage.setItem('planner-week-start', '0');
    expect(loadWeekStart()).toBe(0);
    window.localStorage.setItem('planner-week-start', '6');
    expect(loadWeekStart()).toBe(6);
    setWeekStart(1);
  });
});

describe('the retention window', () => {
  const today = todayISO();
  const oldWeek = addDays(startOfWeek(today), -28);

  /** A planner with one finished week of detail and one week still in the window. */
  function seedOldDetail(): void {
    let state = createEmptyState();
    state = addTask(
      state,
      { title: 'Old essay', priority: 'medium', dueDate: oldWeek, dueTime: null, category: 'learning', note: 'OLD_NOTE', goalId: null, estimatedMinutes: 90 },
      'old-task',
      `${oldWeek}T09:00:00.000Z`,
    );
    state = toggleTask(state, 'old-task', `${oldWeek}T18:00:00.000Z`, oldWeek);
    state = addTask(
      state,
      { title: 'Current work', priority: 'high', dueDate: today, dueTime: null, category: 'learning', note: 'CURRENT_NOTE', goalId: null },
      'new-task',
    );
    window.localStorage.setItem(STORAGE_KEY, serialize(state));
    window.localStorage.setItem(RETENTION_KEY, '2');
  }

  it('rolls the finished week up on boot, keeping results and dropping detail', async () => {
    // The state has to be in place before the app reads it back, so the
    // harness's own mount is undone and redone around the seed.
    act(() => root?.unmount());
    container?.remove();
    root = null;
    seedOldDetail();
    mountApp();
    await waitForText('Today');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const stored = saved();
    const parsed = JSON.parse(stored) as {
      archives?: { weekStart: string; tasksDone: number }[];
      tasks?: { id: string; note?: string }[];
    };
    expect(parsed.archives?.map((archive) => archive.weekStart)).toContain(oldWeek);
    expect(parsed.archives?.[0].tasksDone).toBe(1);
    expect(stored).not.toContain('OLD_NOTE');
    expect(stored).toContain('CURRENT_NOTE');
    expect(stored).toContain('"archives"');
    expect(stored).toContain(oldWeek);
  });

  it('is a real setting, and keep-everything is one of the choices', async () => {
    await waitForText('Today');
    click('.side-tool[data-tour="settings"]');
    await waitForText('Sync & backup');
    click('#set-tab-sync');
    await waitForText('How long detail is kept');

    clickByText('4 weeks');
    expect(window.localStorage.getItem(RETENTION_KEY)).toBe('4');
    clickByText('Keep everything');
    expect(window.localStorage.getItem(RETENTION_KEY)).toBe('0');
  });
});
