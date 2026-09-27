// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function text(): string {
  return document.body.textContent ?? '';
}

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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pressKey(key: string, options?: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
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

describe('app smoke', () => {
  it('boots to the Today view', () => {
    mountApp();
    expect(text()).toContain('Personal Planner');
    expect(document.querySelector('.quick-add')).toBeTruthy();
    expect(document.querySelector('.hero-panel')).toBeTruthy();
  });

  it('adds a task through smart quick add and undoes it', () => {
    mountApp();
    const input = document.querySelector<HTMLInputElement>('.quick-add input');
    expect(input).toBeTruthy();
    setInputValue(input as HTMLInputElement, 'Buy milk tomorrow !high');
    const form = document.querySelector<HTMLFormElement>('.quick-add');
    act(() => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(text()).toContain('Buy milk');
    const undo = document.querySelector<HTMLButtonElement>('[aria-label="Undo last change"]');
    expect(undo).toBeTruthy();
    act(() => {
      undo?.click();
    });
    expect(text()).not.toContain('Buy milk');
  });

  it('opens the palette, searches, and navigates', async () => {
    mountApp();
    pressKey('k', { metaKey: true });
    expect(document.querySelector('.palette')).toBeTruthy();
    const input = document.querySelector<HTMLInputElement>('.palette input');
    expect(input).toBeTruthy();
    setInputValue(input as HTMLInputElement, 'insights');
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(text()).toContain('How your days are taking shape');
    expect(document.querySelectorAll('[aria-label="Progress charts"] .chart-card')).toHaveLength(2);
    expect(document.querySelectorAll('[aria-label="Focus and rhythm"] .chart-card')).toHaveLength(2);
    expect(document.querySelector('.palette')).toBeFalsy();
  });

  it('loads the sample day from the welcome card', () => {
    mountApp();
    const sample = [...document.querySelectorAll<HTMLButtonElement>('.welcome-actions .btn')].find((button) =>
      button.textContent?.includes('sample day'),
    );
    expect(sample).toBeTruthy();
    act(() => {
      sample?.click();
    });
    expect(text()).toContain('Finish the report');
    expect(text()).toContain('Read 20 minutes');
    expect(text()).toContain('Daily essentials');
  });

  it('adds the daily essentials from the welcome card', () => {
    mountApp();
    const add = [...document.querySelectorAll<HTMLButtonElement>('.welcome-actions .btn')].find((button) =>
      button.textContent?.includes('essential'),
    );
    expect(add).toBeTruthy();
    act(() => {
      add?.click();
    });
    expect(text()).toContain('Daily essentials');
    expect(text()).toContain('Drink water');
    expect(text()).toContain('Sleep by 11');
    expect(document.querySelector('.welcome-card')).toBeFalsy();
  });

  it('adds a habit from the built-in library', async () => {
    mountApp();
    const habitsNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) =>
      button.textContent?.includes('Habits'),
    );
    await act(async () => {
      habitsNav?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(text()).toContain('Repeat what you want to keep');
    const chip = [...document.querySelectorAll<HTMLButtonElement>('.preset-chip')].find((button) =>
      button.textContent?.includes('Drink water'),
    );
    expect(chip).toBeTruthy();
    await act(async () => {
      chip?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.querySelector('.habit-card')).toBeTruthy();
    expect(text()).toContain('Drink water');
    expect(text()).toContain('Daily must-do');
  });

  it('toggles dark mode from the sidebar', () => {
    mountApp();
    const themeButton = [...document.querySelectorAll<HTMLButtonElement>('.side-tool')].find((button) =>
      button.textContent?.includes('Dark mode'),
    );
    expect(themeButton).toBeTruthy();
    act(() => {
      themeButton?.click();
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('planner-theme')).toBe('dark');
  });

  it('opens the AI coach and shows the protected weekly schedule editor', async () => {
    mountApp();
    const aiNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) =>
      button.textContent?.includes('AI coach'),
    );
    await act(async () => {
      aiNav?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(text()).toContain('Make a plan that fits');
    expect(text()).toContain('Weekly fixed times');
    expect(text()).toContain('Add a plan picture');
    const fixedForm = document.querySelector<HTMLFormElement>('.fixed-form');
    expect(fixedForm).toBeTruthy();
    const title = fixedForm?.querySelector<HTMLInputElement>('input');
    setInputValue(title as HTMLInputElement, 'Class');
    act(() => {
      fixedForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.fixed-list-item')?.textContent).toContain('Tuesday · 08:00–09:00');
    const saved = JSON.parse(window.localStorage.getItem('personal-planner.v1') ?? '{}') as { fixedCommitments?: Array<{ title: string }> };
    expect(saved.fixedCommitments?.[0]?.title).toBe('Class');
  });

  it('explains how to configure the server-side xAI key', async () => {
    mountApp();
    const aiNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) => button.textContent?.includes('AI coach'));
    await act(async () => {
      aiNav?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const settings = [...document.querySelectorAll<HTMLButtonElement>('.ai-head-actions button')].find((button) => button.textContent?.includes('AI settings'));
    act(() => settings?.click());
    expect(text()).toContain('AI coach · xAI');
    expect(text()).toContain('XAI_API_KEY=your_xai_api_key');
    expect(text()).toContain('.env.local');
    expect(document.querySelector('.ai-key-field input')).toBeFalsy();
  });

  it('starts a focus session from the hero', () => {
    mountApp();
    const focusTile = [...document.querySelectorAll<HTMLButtonElement>('.qa-tile')].find((button) =>
      button.textContent?.includes('Focus'),
    );
    expect(focusTile).toBeTruthy();
    act(() => {
      focusTile?.click();
    });
    expect(document.querySelector('.focus-card')).toBeTruthy();
    const start = [...document.querySelectorAll<HTMLButtonElement>('.focus-actions .btn')].find((button) =>
      button.textContent?.includes('Start focusing'),
    );
    act(() => {
      start?.click();
    });
    expect(text()).toContain('keep going');
  });

  it('navigates between the main views', async () => {
    mountApp();
    const calendar = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) =>
      button.textContent?.includes('Calendar'),
    );
    await act(async () => {
      calendar?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(text()).toContain('Seven days, loosely held');
    const monthTab = [...document.querySelectorAll<HTMLButtonElement>('.cal-tabs .seg')].find((button) =>
      button.textContent?.includes('Month'),
    );
    await act(async () => {
      monthTab?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.querySelector('.month-grid')).toBeTruthy();
  });
});

function click(element: Element | null | undefined): void {
  if (!element) throw new Error('element missing');
  act(() => {
    (element as HTMLElement).click();
  });
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === label);
}

describe('new features', () => {
  it('quick adds a repeating task and completing it schedules the next one', () => {
    mountApp();
    const input = document.querySelector<HTMLInputElement>('.quick-add input');
    if (!input) throw new Error('missing quick add');
    setInputValue(input, 'Stretch every day');
    expect(text()).toContain('Every day');
    act(() => {
      input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.repeat-chip')).toBeTruthy();
    click(document.querySelector('[aria-label="Mark Stretch complete"]'));
    const saved = JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}') as { tasks: Array<{ completed: boolean; repeat: string | null }> };
    expect(saved.tasks).toHaveLength(2);
    expect(saved.tasks.filter((task) => task.repeat === 'daily' && !task.completed)).toHaveLength(1);
  });

  it('adds checklist steps in the composer and shows progress', () => {
    mountApp();
    pressKey('n');
    const title = document.querySelector<HTMLInputElement>('[role="dialog"] input[data-autofocus]');
    if (!title) throw new Error('missing title');
    setInputValue(title, 'Pack');
    const step = document.querySelector<HTMLInputElement>('[aria-label="New checklist step"]');
    if (!step) throw new Error('missing step input');
    setInputValue(step, 'Passport');
    click(document.querySelector('.subtask-add button'));
    setInputValue(step, 'Charger');
    act(() => {
      title.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(text()).toContain('0/2 steps');
    click(document.querySelector('.steps-chip'));
    click(document.querySelector('[aria-label="Mark step Passport done"]'));
    expect(text()).toContain('1/2 steps');
  });

  it('switches Tasks to a board', () => {
    window.history.replaceState(null, '', '#/tasks');
    mountApp();
    click(buttonByText('Try a sample day'));
    click(document.querySelector('[role="radio"][aria-checked="false"]'));
    const board = document.querySelector('.board');
    expect(board).toBeTruthy();
    expect(board?.textContent).toContain('Anytime');
    expect(localStorage.getItem('planner-task-layout')).toContain('board');
  });

  it('shows reminders, calendar and install settings', () => {
    mountApp();
    click(document.querySelector('[aria-label="Settings"]') ?? buttonByText('Settings'));
    expect(text()).toContain('Reminders');
    expect(text()).toContain('Export .ics');
    expect(text()).toContain('Week starts on');
  });

  it('renders notes as safe markdown with tags', () => {
    window.history.replaceState(null, '', '#/notes');
    localStorage.setItem('personal-planner.v1', JSON.stringify({ notes: [{ id: 'n', title: 'Ideas', body: '**Bold** #work <img src=x onerror=alert(1)>\n- [x] done', kind: 'idea' }] }));
    mountApp();
    expect(document.querySelector('.md-body strong')?.textContent).toBe('Bold');
    expect(document.querySelector('.md-body img')).toBeNull();
    expect(document.querySelector('.tag-row')?.textContent).toContain('#work');
  });
});
