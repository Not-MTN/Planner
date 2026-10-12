// @vitest-environment jsdom
/**
 * The front door: an open or login with no address lands on the panel picker,
 * and each choice opens the panel it names.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, act } from 'react';
import { settle as settleTicks, waitFor, waitForBoot } from '../testing/wait';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { createEmptyState, type PlannerState } from '../types';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function text(): string {
  return document.body.textContent ?? '';
}

function mountApp(hash: string, state?: PlannerState): void {
  window.history.replaceState(null, '', hash);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <StrictMode>
        <App initialState={state} />
      </StrictMode>,
    );
  });
}

/** Booting reads IndexedDB, so wait until the app is ready — never a fixed sleep. */
async function boot(): Promise<void> {
  await waitForBoot(text);
}

async function settle(times = 3): Promise<void> {
  await settleTicks(times);
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')] as HTMLButtonElement[];
}

async function clickText(needle: string): Promise<void> {
  const button = buttons().find((item) => (item.textContent ?? '').trim().includes(needle));
  if (!button) throw new Error(`No button containing "${needle}".`);
  await act(async () => {
    button.click();
  });
  await settle();
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('planner-tour-done', '1');
  window.sessionStorage.clear();
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

function studentState(): PlannerState {
  const state = createEmptyState();
  state.panels.student = { ...state.panels.student, enabled: true, field: 'Physics', grade: 'school-11' };
  return state;
}

describe('the panel picker', () => {
  it('is what an open with no address lands on', async () => {
    mountApp('/');
    await boot();
    expect(window.location.hash).toBe('#/home');
    expect(text()).toContain('Choose your panel');
    expect(text()).toContain('Open personal panel');
    // A panel that has not been added is offered once, as Add a panel — the
    // picker lists the panels somebody actually has.
    expect(text()).toContain('Add a panel');
    expect(text()).not.toContain('Add student panel');
    expect(text()).not.toContain('Open student panel');
    // Choosing is the whole page; no personal workspace chrome before a choice.
    expect(document.querySelector('.sidebar')).toBeNull();
    expect(document.querySelector('.tabbar')).toBeNull();
    expect(document.querySelector('.mobile-bar')).toBeNull();
    expect(buttons().some((item) => (item.textContent ?? '').trim() === 'Home')).toBe(false);
  });

  it('opens the personal panel and offers the way back', async () => {
    mountApp('#/home');
    await boot();
    await clickText('Open personal panel');
    await waitFor(() => !!document.querySelector('.quick-add input'), 10_000, 'the personal panel to open');
    expect(window.location.hash).toBe('#/today');
    expect(text()).toContain('Personal Planner');
    expect(text()).toContain('Switch panel');
  });

  it('opens the student panel once it is added', async () => {
    mountApp('#/home', studentState());
    await boot();
    expect(text()).toContain('Open student panel');
    await clickText('Open student panel');
    await waitFor(() => !!document.querySelector('.student-panel-view'), 15_000, 'the student panel to open');
    expect(window.location.hash).toBe('#/student');
    expect(text()).toContain('Switch panel');
  });

  it('sends a panel that is not added to where it is added', async () => {
    mountApp('#/home');
    await boot();
    await clickText('Add a panel');
    await waitFor(() => text().includes('Panels are additions to your planner'), 10_000, 'the panels page to open');
    expect(window.location.hash).toBe('#/panels');
  });
});
