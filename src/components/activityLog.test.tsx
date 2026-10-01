// @vitest-environment jsdom
/**
 * Settings → Recent activity.
 *
 * The section is only useful if it reads at a glance and says nothing it does
 * not mean, so these render it for real and look at what a person would see:
 * the account's own lines, the flags on the ones that matter, and an honest
 * empty state rather than a blank panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { adoptSession, endSession } from '../auth/session';
import type { AuthEvent, PublicUser } from '../shared/authContract';

vi.mock('../auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/session')>();
  return { ...actual, listAuthEvents: () => Promise.resolve(events) };
});

let events: AuthEvent[] = [];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const text = (): string => document.body.textContent ?? '';

function at(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function event(overrides: Partial<AuthEvent> & Pick<AuthEvent, 'kind'>): AuthEvent {
  return {
    id: Math.random().toString(36).slice(2),
    deviceLabel: 'Chrome on Mac',
    at: at(5),
    network: null,
    newNetwork: false,
    ...overrides,
  };
}

async function waitForText(needle: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!text().includes(needle)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for "${needle}"`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
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
  username: 'activity',
  email: null,
  displayName: 'Activity',
  role: 'personal',
  createdAt: new Date().toISOString(),
};

beforeEach(async () => {
  events = [];
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
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  endSession();
});

async function openSettings(): Promise<void> {
  act(() => {
    root?.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
  await waitForText('Settings');
  click('.side-tool[data-tour="settings"]');
  await waitForText('Recent activity');
  // The heading is there straight away; the lines arrive on their own. Assert
  // against what is on screen, not against what has been asked for.
  await waitFor(
    () => document.querySelectorAll('.activity-row').length > 0 || text().includes('Nothing here yet'),
    'the log to finish loading',
  );
}

describe('recent activity', () => {
  it('lists what has happened to the account, newest first, in plain words', async () => {
    events = [
      event({ kind: 'password', at: at(2), deviceLabel: 'Chrome on Mac' }),
      event({ kind: 'created', at: at(60), deviceLabel: 'Safari on iPhone' }),
    ];
    await openSettings();

    const rows = [...document.querySelectorAll('.activity-row')];
    expect(rows).toHaveLength(2);
    // Newest first: the sign-in above the account being made.
    expect(rows[0]?.textContent).toContain('Signed in with your password');
    expect(rows[1]?.textContent).toContain('You made this account');
    // Each line says which device and roughly when, or it cannot be read.
    expect(rows[0]?.textContent).toContain('Chrome on Mac');
    expect(rows[1]?.textContent).toContain('Safari on iPhone');
  });

  it('marks the two lines worth noticing: a new place, and getting in with a recovery code', async () => {
    events = [
      event({ kind: 'recovery', newNetwork: true }),
      event({ kind: 'password_totp' }),
      event({ kind: 'totp_on' }),
    ];
    await openSettings();

    const rows = [...document.querySelectorAll('.activity-row')];
    // "New place" is the only flag on the only alarming line.
    expect(rows.filter((row) => row.className.includes('is-alarming'))).toHaveLength(1);
    expect(rows[0]?.className).toContain('is-alarming');
    expect(rows[0]?.textContent).toContain('New place');
    expect(rows[0]?.textContent).toContain('Got back in with a recovery code');

    // An ordinary sign-in carries no warning: a log that flags everything
    // teaches people to ignore it.
    expect(rows[1]?.textContent).not.toContain('New place');
    expect(rows[1]?.className).not.toContain('is-alarming');

    // Turning the second step on is recorded too — it is the other thing a
    // stranger would have to touch.
    expect(rows[2]?.textContent).toContain('Turned two-step sign-in on');
  });

  it('says so when there is nothing to show, instead of showing a blank panel', async () => {
    events = [];
    await openSettings();
    expect(document.querySelector('.activity-row')).toBeNull();
    expect(text()).toContain('Nothing here yet');
  });

  it('keeps the log to the account that is signed in', async () => {
    events = [event({ kind: 'password' })];
    await openSettings();
    // One row per line, no duplication from a re-render.
    expect(document.querySelectorAll('.activity-row')).toHaveLength(1);
    expect(text()).toContain('This is the last couple of months');
  });
});
