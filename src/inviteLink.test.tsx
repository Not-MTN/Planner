// @vitest-environment jsdom
/**
 * Arriving from a scanned invite.
 *
 * A guardian's QR code is a web address with the code in its hash, and it has
 * to survive the trip either way it is opened: in a browser tab, or handed to
 * the installed app by Android or iOS (see shared/deepLinks.ts — both end up on
 * the same address). What the student should find is the panel the code is for,
 * with the code already in the box, and the address no longer carrying it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { waitForBoot } from './testing/wait';
import { App } from './App';

const CODE = 'plnr-abcd-efgh-ijkl';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function text(): string {
  return document.body.textContent ?? '';
}

async function boot(): Promise<void> {
  await waitForBoot(text);
  await act(async () => undefined);
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')] as HTMLButtonElement[];
}

function codeInput(): HTMLInputElement | null {
  return [...document.querySelectorAll('input.input')].find((input) =>
    (input as HTMLInputElement).placeholder?.startsWith('plnr-'),
  ) as HTMLInputElement | null;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('planner-tour-done', '1');
  window.sessionStorage.clear();
  // The address a guardian's QR code carries.
  window.history.replaceState(null, '', `#/panels?invite=${CODE}`);
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

describe('a code that arrives as a link', () => {
  it('opens the student panel rather than the chooser', async () => {
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
    await boot();

    // Not the "which panel would you like?" chooser: the code is addressed to
    // the student panel, so that is the page, even before the panel is on.
    expect(text()).toContain('The student panel is not added');
    expect(text()).toContain('Add the student panel, then press Link to accept the code you scanned.');
  });

  it('keeps the code in the address until it has an answer', async () => {
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
    await boot();

    // Reloading in the middle of deciding is a normal thing to do, and the
    // address is where the code survives that — it is the link the guardian
    // handed over, so it is no more public here than it was in the QR code.
    expect(window.location.hash).toBe(`#/panels?invite=${CODE}`);
  });

  it('fills the code in once the panel it belongs to is added', async () => {
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
    await boot();

    const add = buttons().find((item) => (item.textContent ?? '').trim() === 'Add student panel');
    expect(add).toBeTruthy();
    await act(async () => {
      add?.click();
    });
    await boot();

    const input = codeInput();
    expect(input?.value).toBe(CODE);
    expect(text()).toContain('That code came from a QR code. Press Link to accept it.');
  });
});
