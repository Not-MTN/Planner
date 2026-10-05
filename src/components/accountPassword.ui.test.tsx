// @vitest-environment jsdom
/**
 * The approved-device password change, driven through the real Settings sheet.
 *
 * The crypto and the server are covered by `auth/roundTrip.test.ts`; what this
 * file watches is the part a person touches — that the row is there for a
 * signed-in device, that the form asks twice and refuses a mismatch, and that
 * the new codes are shown once afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const session = vi.hoisted(() => ({
  changePasswordFromDevice: vi.fn(async () => ['plnr-AAAA-BBBB-CCCC-DDDD-EEEE', 'plnr-FFFF-GGGG-HHHH-JJJJ-KKKK']),
  user: {
    id: 'user-1',
    username: 'omid',
    email: 'omid@example.com',
    displayName: 'Omid',
    role: 'personal' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
}));

vi.mock('../auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/session')>();
  return {
    ...actual,
    getActiveSession: () => ({ user: session.user, dek: {} as CryptoKey, dekRaw: null, vault: { version: 1, ciphertext: '' } }),
    changePasswordFromDevice: session.changePasswordFromDevice,
    // The Security section under Account asks for these on render.
    listAuthEvents: async () => [],
    listDeviceSessions: async () => [],
    fetchTotpStatus: async () => null,
  };
});

import { App } from '../App';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function click(element: Element | null | undefined): void {
  if (!element) throw new Error('element missing');
  act(() => {
    (element as HTMLElement).click();
  });
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label,
  );
}

function typeInto(input: HTMLInputElement | null | undefined, value: string): void {
  if (!input) throw new Error('input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function fieldByLabel(label: string): HTMLInputElement | null {
  const field = [...document.querySelectorAll('label.field')].find(
    (candidate) => candidate.querySelector('span')?.textContent?.trim() === label,
  );
  return field?.querySelector('input') ?? null;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

/** Opens Settings, then the Account tab, the way a person would. */
async function openAccountTab(): Promise<void> {
  click(document.querySelector('[aria-label="Settings"]') ?? buttonByText('Settings'));
  await settle();
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent?.trim() === 'Account',
  );
  expect(tab, 'the Account tab').toBeTruthy();
  click(tab);
  await settle();
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
  session.changePasswordFromDevice.mockClear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

describe('approved-device password change', () => {
  it('asks for the new password twice, refuses a mismatch, and shows the new codes', async () => {
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
    await settle();
    await openAccountTab();

    const open = buttonByText('Set a new password');
    expect(open, 'the approved-device row').toBeTruthy();
    click(open);
    await settle();

    // The hint has to say why no old password is asked for — this is the whole
    // reason the tier can exist.
    expect(document.body.textContent).toContain('already holds your vault key');

    typeInto(fieldByLabel('New password'), 'a-brand-new-long-password');
    typeInto(fieldByLabel('Repeat new password'), 'a-different-long-password');
    click(buttonByText('Set new password'));
    await settle();
    expect(session.changePasswordFromDevice).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('The two passwords do not match.');

    typeInto(fieldByLabel('Repeat new password'), 'a-brand-new-long-password');
    click(buttonByText('Set new password'));
    await settle();
    expect(session.changePasswordFromDevice).toHaveBeenCalledWith('a-brand-new-long-password');

    // The old codes are gone, so the new set is shown once and has to be
    // confirmed before the dialog closes.
    expect(document.body.textContent).toContain('Your new recovery codes');
    expect(document.body.textContent).toContain('plnr-AAAA-BBBB-CCCC-DDDD-EEEE');
    expect(buttonByText('Done')?.disabled).toBe(true);
  });
});
