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
    expect(document.querySelector('.palette')).toBeFalsy();
  });

  it('loads the sample day from the empty Today view', () => {
    mountApp();
    const sample = document.querySelector<HTMLButtonElement>('.hero-sample');
    expect(sample).toBeTruthy();
    act(() => {
      sample?.click();
    });
    expect(text()).toContain('Finish the report');
    expect(text()).toContain('Read 20 minutes');
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
