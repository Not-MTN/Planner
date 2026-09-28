// @vitest-environment jsdom
/**
 * The panels are meant to be optional extras, so these tests walk the whole
 * promise: nothing is required, adding one keeps the planner, and the dashboard
 * becomes the way in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function setSelect(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  act(() => {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
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

  it('will not add the student panel without what you study and where you are', async () => {
    mountApp();
    await settle();
    await clickText('See the panels');
    await clickText('Add student panel');
    // The form is open and the panel is still off: details come first.
    await clickText('Add student panel');
    expect(text()).toContain('Add what you study and where you are in it.');
    expect(text()).toContain('Not added');
  });

  it('adds the student panel, keeps the planner, and reaches it from the dashboard', async () => {
    mountApp();
    await settle();

    await clickText('See the panels');
    expect(text()).toContain('Panels are additions to your planner');

    await clickText('Add student panel');
    const field = document.querySelector('.panel-form input.input') as HTMLInputElement | null;
    const grade = document.querySelector('.panel-form select.input') as HTMLSelectElement | null;
    expect(field).toBeTruthy();
    expect(grade).toBeTruthy();
    setValue(field!, 'Physics');
    setSelect(grade!, 'school-11');
    await clickText('Add student panel');
    expect(text()).toContain('Student panel added');
    expect(document.body.textContent).toContain('Physics');

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

  it('asks the AI from the student panel, and sends only this week', async () => {
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/api/xai/chat/completions')) {
          sent.push(String(init?.body ?? ''));
          const content = JSON.stringify({
            summary: 'A steady week.',
            focus: ['Revise chapter 4 for 25 minutes'],
            watchOut: 'Thursday is already full.',
          });
          return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    mountApp();
    await settle();
    await clickText('See the panels');
    await clickText('Add student panel');
    setValue(document.querySelector('.panel-form input.input') as HTMLInputElement, 'Physics');
    setSelect(document.querySelector('.panel-form select.input') as HTMLSelectElement, 'school-11');
    await clickText('Add student panel');
    await clickText('Open student panel');

    await clickText('Ask');
    for (let attempt = 0; attempt < 12 && !text().includes('Revise chapter 4'); attempt += 1) await settle(2);

    expect(text()).toContain('A steady week.');
    expect(text()).toContain('Revise chapter 4 for 25 minutes');
    expect(text()).toContain('Thursday is already full.');

    // One request, and it carried the week rather than the whole planner.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Physics');
    expect(sent[0]).not.toContain('SECRET');
    vi.unstubAllGlobals();
  });

  it('asks which kind of guardian before adding that panel', async () => {
    mountApp();
    await settle();
    await clickText('See the panels');
    await clickText('Add guardian panel');
    expect(text()).toContain('Which kind of guardian are you?');
    await clickText('Parent');
    const field = document.querySelector('.panel-form input.input') as HTMLInputElement | null;
    expect(field).toBeTruthy();
    setValue(field!, 'Mathematics');
    await clickText('Add guardian panel');
    expect(text()).toContain('Parent panel added');
    await clickText('Open guardian panel');
    expect(text()).toContain('The week, as results');
  });

  it('removes a panel without touching the planner', async () => {
    mountApp();
    await settle();
    await clickText('See the panels');
    await clickText('Add student panel');
    setValue(document.querySelector('.panel-form input.input') as HTMLInputElement, 'Physics');
    setSelect(document.querySelector('.panel-form select.input') as HTMLSelectElement, 'school-11');
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
