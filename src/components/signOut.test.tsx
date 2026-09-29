// @vitest-environment jsdom
/**
 * The sign-out affordances: once a vault session exists, the side panel, the
 * More panel and Settings all offer a way out, and pressing it asks first.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { adoptSession, endSession } from '../auth/session';
import type { PublicUser } from '../shared/authContract';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const text = (): string => document.body.textContent ?? '';

async function waitForText(needle: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!text().includes(needle)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for "${needle}"`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
}

function click(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`No element for ${selector}`);
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const user: PublicUser = {
  id: '11111111-2222-3333-4444-555555555555',
  username: 'signout',
  email: null,
  displayName: 'Sign Out',
  role: 'personal',
  createdAt: new Date().toISOString(),
};

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('planner-tour-done', '1');
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
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  adoptSession(user, dek, { version: 1, ciphertext: '' });
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
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  endSession();
});

describe('signing out from inside the planner', () => {
  it('offers sign-out in the side panel once a vault is open', async () => {
    await waitForText('Sign out');
    expect(document.querySelector('.side-signout')).toBeTruthy();
  });

  it('asks before signing out, and cancelling keeps the session', async () => {
    await waitForText('Sign out');
    click('.side-signout');
    await waitForText('Sign out of Planner?');
    click('.sheet-confirm .btn-ghost');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(text()).not.toContain('Sign out of Planner?');
    expect(document.querySelector('.side-signout')).toBeTruthy();
  });

  it('shows the signed-in account at the top of Settings', async () => {
    await waitForText('Settings');
    click('.side-tool[data-tour="settings"]');
    await waitForText('Sign Out');
    expect(text()).toContain('Signed in · your planner syncs through its encrypted vault');
  });

  it('offers sign-out in the More panel too', async () => {
    await waitForText('Today');
    // The More panel is the mobile sheet; it exists in the DOM at any width.
    const tabs = [...document.querySelectorAll('.tabbar .tab')];
    const more = tabs[tabs.length - 1] as HTMLElement;
    act(() => {
      more.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitForText('Export backup');
    expect(document.querySelector('.more-signout')).toBeTruthy();
  });
});
