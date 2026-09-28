// @vitest-environment jsdom
/**
 * The panels are meant to be optional extras, so these tests walk the whole
 * promise: nothing is required, adding one keeps the planner, and the dashboard
 * becomes the way in.
 */
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

async function settle(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')] as HTMLButtonElement[];
}

async function clickText(needle: string): Promise<void> {
  const button = buttons().find((item) => (item.textContent ?? '').trim().includes(needle));
  if (!button) throw new Error(`No button containing "${needle}". Buttons: ${buttons().map((b) => (b.textContent ?? '').trim()).join(' | ')}`);
  await act(async () => {
    button.click();
  });
  await settle();
}

function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('optional panels', () => {
  it('boots with no panel and offers one without forcing it', async () => {
    mountApp();
    await settle();
    expect(text()).toContain('Personal Planner');
    expect(text()).toContain('Add a panel when you want one');
    // No panel pages in the sidebar until one is added.
    expect(buttons().some((item) => (item.textContent ?? '').trim() === 'Student')).toBe(false);
  });

  it('adds the student panel, keeps the planner, and reaches it from the dashboard', async () => {
    mountApp();
    await settle();

    await clickText('See the panels');
    expect(text()).toContain('Panels are additions to your planner');

    await clickText('Add student panel');
    expect(text()).toContain('Student panel added');

    // The dashboard now links to it, and the personal planner is still there.
    await clickText('Open student panel');
    expect(text()).toContain('This week, and what’s coming');

    // Add a subject and see it land.
    await clickText('Subject');
    const input = document.querySelector('.panel-form input.input') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    setValue(input!, 'Physics');
    await clickText('Add subject');
    expect(text()).toContain('Physics');

    // Back to the dashboard: the panel is listed there, the planner is intact.
    const today = buttons().find((item) => (item.textContent ?? '').trim() === 'Today');
    await act(async () => {
      today?.click();
    });
    await settle();
    expect(text()).toContain('Personal Planner');
    expect(text()).toContain('Your panels');
    expect(text()).toContain('Student panel');
  });

  it('asks which kind of guardian before adding that panel', async () => {
    mountApp();
    await settle();
    await clickText('See the panels');
    await clickText('Add guardian panel');
    expect(text()).toContain('Which kind of guardian are you?');
    await clickText('Parent');
    expect(text()).toContain('Parent panel added');
    await clickText('Open guardian panel');
    expect(text()).toContain('The week, as results');
  });

  it('removes a panel without touching the planner', async () => {
    mountApp();
    await settle();
    await clickText('See the panels');
    await clickText('Add student panel');
    await clickText('Remove panel');
    expect(text()).toContain('Student panel removed');
    // The panel is still offered, and the sidebar no longer lists it.
    expect(text()).toContain('Not added');
    expect(buttons().some((item) => (item.textContent ?? '').trim() === 'Student')).toBe(false);

    // Back on the dashboard the invitation returns, with the planner untouched.
    const today = buttons().find((item) => (item.textContent ?? '').trim() === 'Today');
    await act(async () => {
      today?.click();
    });
    await settle();
    expect(text()).toContain('Personal Planner');
    expect(document.querySelector('.panel-hub')).toBeNull();
    expect(text()).toContain('Add a panel when you want one');
  });
});
