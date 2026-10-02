// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { InlineTitle } from './InlineTitle';
import { addEvent } from '../mutate';
import { createEmptyState } from '../types';
import { serialize, STORAGE_KEY } from '../storage';
import { todayISO } from '../dates';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(node: React.ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
}

function Harness({
  start = 'Buy milk',
  onCommit,
  onOpenDetails,
}: {
  start?: string;
  onCommit?: (next: string) => void;
  onOpenDetails?: () => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <InlineTitle
      value={value}
      onCommit={(next) => {
        setValue(next);
        onCommit?.(next);
      }}
      onOpenDetails={onOpenDetails}
    />
  );
}

function title(): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>('.inline-title') ?? null;
}

function editor(): HTMLTextAreaElement | null {
  return container?.querySelector<HTMLTextAreaElement>('.inline-title-input') ?? null;
}

function type(node: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(node, value);
  act(() => {
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(node: Element, key: string): void {
  act(() => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
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
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

describe('InlineTitle', () => {
  it('edits in place, and Enter saves', () => {
    const commits: string[] = [];
    mount(<Harness onCommit={(next) => commits.push(next)} />);
    expect(editor()).toBeNull();

    act(() => title()?.click());
    const area = editor();
    expect(area).toBeTruthy();
    expect(area?.value).toBe('Buy milk');
    // Caret parked at the end: the job is fixing a word, not rewriting it.
    expect(area?.selectionStart).toBe('Buy milk'.length);

    type(area as HTMLTextAreaElement, 'Buy oat milk');
    press(area as HTMLTextAreaElement, 'Enter');
    expect(commits).toEqual(['Buy oat milk']);
    expect(editor()).toBeNull();
    expect(title()?.textContent).toBe('Buy oat milk');
  });

  it('Escape cancels and keeps the old title', () => {
    const commits: string[] = [];
    mount(<Harness onCommit={(next) => commits.push(next)} />);
    act(() => title()?.click());
    const area = editor() as HTMLTextAreaElement;
    type(area, 'Something else entirely');
    press(area, 'Escape');
    expect(commits).toEqual([]);
    expect(editor()).toBeNull();
    expect(title()?.textContent).toBe('Buy milk');
  });

  it('saves when focus leaves, and never saves an empty title', () => {
    const commits: string[] = [];
    mount(<Harness onCommit={(next) => commits.push(next)} />);
    act(() => title()?.click());
    const area = editor() as HTMLTextAreaElement;
    type(area, '   ');
    act(() => area.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(commits).toEqual([]);
    expect(title()?.textContent).toBe('Buy milk');

    act(() => title()?.click());
    const again = editor() as HTMLTextAreaElement;
    type(again, '  Call mom  ');
    act(() => again.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(commits).toEqual(['Call mom']);
  });

  it('opens the full editor from the pencil, saving the inline text first', () => {
    const commits: string[] = [];
    const opened: string[] = [];
    mount(<Harness onCommit={(next) => commits.push(next)} onOpenDetails={() => opened.push('open')} />);
    act(() => title()?.click());
    const area = editor() as HTMLTextAreaElement;
    type(area, 'Buy oat milk');
    const pencil = container?.querySelector<HTMLButtonElement>('.inline-title-details');
    expect(pencil).toBeTruthy();
    act(() => pencil?.click());
    expect(commits).toEqual(['Buy oat milk']);
    expect(opened).toEqual(['open']);
  });

  it('follows a change made elsewhere once the user is not typing', () => {
    function Outside() {
      const [value, setValue] = useState('Buy milk');
      return (
        <>
          <button type="button" className="outside" onClick={() => setValue('Picked up milk')}>
            change
          </button>
          <InlineTitle value={value} onCommit={setValue} />
        </>
      );
    }
    mount(<Outside />);
    act(() => container?.querySelector<HTMLButtonElement>('.outside')?.click());
    expect(title()?.textContent).toBe('Picked up milk');

    // Mid-edit the keystrokes win: an incoming value must not yank the draft.
    act(() => title()?.click());
    type(editor() as HTMLTextAreaElement, 'Buy oat milk');
    act(() => container?.querySelector<HTMLButtonElement>('.outside')?.click());
    expect(editor()?.value).toBe('Buy oat milk');
  });
});

describe('inline titles in the app', () => {
  function text(): string {
    return document.body.textContent ?? '';
  }

  /** Views are lazy-loaded, so the render is polled rather than slept on. */
  async function mountApp(hash: string, ready: () => unknown): Promise<void> {
    window.history.replaceState(null, '', hash);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<App />);
    });
    for (let index = 0; index < 40 && !ready(); index += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    }
    expect(ready(), hash).toBeTruthy();
  }

  function stored(): { tasks?: Record<string, unknown>[]; events?: Record<string, unknown>[] } {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
  }

  it('renames a quick-added task without touching the rest of it', async () => {
    await mountApp('#/today', () => document.querySelector('.quick-add input'));

    const input = document.querySelector<HTMLInputElement>('.quick-add input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'Buy milc today 5pm !high');
    act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
    act(() => {
      document.querySelector<HTMLFormElement>('.quick-add')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(text()).toContain('Buy milc');

    const row = document.querySelector<HTMLElement>('.task');
    expect(row).toBeTruthy();
    act(() => row?.querySelector<HTMLButtonElement>('.inline-title')?.click());
    const area = row?.querySelector<HTMLTextAreaElement>('.inline-title-input') as HTMLTextAreaElement;
    expect(area).toBeTruthy();
    type(area, 'Buy milk');
    press(area, 'Enter');

    expect(text()).toContain('Buy milk');
    expect(text()).not.toContain('Buy milc');
    // Date, time and priority came from the parsed line and stay put.
    expect(text()).toContain('High');
    const task = stored().tasks?.[0];
    expect(task?.title).toBe('Buy milk');
    expect(task?.priority).toBe('high');
    expect(task?.dueTime).toBe('17:00');
    expect(task).toHaveProperty('subtasks');
  });

  it('renames an event in Today, keeping its time, note and flag', async () => {
    const today = todayISO();
    const seeded = addEvent(createEmptyState(), {
      title: 'Dentist',
      date: today,
      startTime: '09:30',
      endTime: '10:00',
      category: 'health',
      note: 'bring the card',
      important: true,
      repeat: null,
    });
    window.localStorage.setItem(STORAGE_KEY, serialize(seeded));
    await mountApp('#/today', () => document.querySelector('.event .inline-title'));

    act(() => document.querySelector<HTMLButtonElement>('.event .inline-title')?.click());
    const area = document.querySelector<HTMLTextAreaElement>('.event .inline-title-input') as HTMLTextAreaElement;
    expect(area).toBeTruthy();
    type(area, 'Dentist check-up');
    press(area, 'Enter');

    expect(text()).toContain('Dentist check-up');
    const event = stored().events?.[0];
    expect(event?.title).toBe('Dentist check-up');
    expect(event?.startTime).toBe('09:30');
    expect(event?.endTime).toBe('10:00');
    expect(event?.important).toBe(true);
    expect(event?.note).toBe('bring the card');
  });

  it('renames a chip on the calendar week board, and still opens the full form', async () => {
    const today = todayISO();
    const seeded = addEvent(createEmptyState(), {
      title: 'Standup',
      date: today,
      startTime: '09:15',
      endTime: '09:30',
      category: 'work',
      note: '',
      important: false,
      repeat: null,
    });
    window.localStorage.setItem(STORAGE_KEY, serialize(seeded));
    await mountApp(`#/calendar/week/${today}`, () => document.querySelector('.week-chip-title'));

    const chip = document.querySelector<HTMLElement>('.week-chip');
    act(() => chip?.querySelector<HTMLButtonElement>('.week-chip-title')?.click());
    const area = chip?.querySelector<HTMLTextAreaElement>('.inline-title-input') as HTMLTextAreaElement;
    expect(area).toBeTruthy();
    type(area, 'Team standup');
    press(area, 'Enter');
    expect(stored().events?.[0]?.title).toBe('Team standup');

    // The chip is no longer one button, so the pencil is how you reach the form.
    act(() => chip?.querySelector<HTMLButtonElement>('.week-chip-title')?.click());
    const pencil = chip?.querySelector<HTMLButtonElement>('.inline-title-details');
    expect(pencil).toBeTruthy();
    act(() => pencil?.click());
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(text()).toContain('Edit event');
  });
});
