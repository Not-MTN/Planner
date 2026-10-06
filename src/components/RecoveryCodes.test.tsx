// @vitest-environment jsdom
/**
 * Recovery codes in Persian.
 *
 * This is the one screen where the numbers do real work: the person is asked
 * for "code 5 of 8", so the number in the question, in the printed list and in
 * the placeholder all have to be the same number, in the same digits. The codes
 * themselves stay ASCII — they are keys, typed into a password manager.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RecoveryCodes } from './RecoveryCodes';
import { getLang, setLang } from '../i18n';

const CODES = ['plnr-aaaa-bbbb-cccc', 'plnr-dddd-eeee-ffff', 'plnr-gggg-hhhh-iiii'];

/** The real page passes its already-translated copy in; the keys are the
 *  English strings, so a plain object is enough here. */
const copy: Record<string, string> = {
  authRecoverySub: 'These codes are the only way back in.',
  authRecoveryWarn: 'Keep them somewhere safe.',
  authRecoveryCopy: 'Copy all',
  authRecoveryCopied: 'Copied',
  authRecoveryDownload: 'Download',
  authRecoveryPrint: 'Print',
  authRecoveryConfirmLabel: 'Type code {n} to continue',
  authRecoveryConfirmHint: 'This checks you really have the list in front of you.',
  authRecoveryConfirmOk: 'That is the right one. Keep going.',
  authRecoveryConfirmBad: 'That is not code {n}. Check the list above.',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <StrictMode>
        <RecoveryCodes
          codes={CODES}
          copy={copy}
          onConfirmedChange={() => undefined}
          idPrefix="test"
        />
      </StrictMode>,
    );
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  setLang('en');
});

describe('recovery codes', () => {
  it('numbers the list, the copied text and the question in Persian digits', async () => {
    setLang('fa');
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount();

    const numbering = [...document.querySelectorAll('.recovery-code-num')].map((item) => item.textContent);
    expect(numbering).toEqual(['۱', '۲', '۳']);

    // The code itself is a key, not a number: it stays ASCII, and so does the
    // one the person is asked to type.
    const code = document.querySelector('.recovery-codes code')?.textContent ?? '';
    expect(code).toBe(CODES[0]);

    const label = document.querySelector('label')?.textContent ?? '';
    expect(label).toMatch(/[۰-۹]/);
    expect(label).not.toMatch(/[0-9]/);

    const copyButton = [...document.querySelectorAll('button')].find((item) => item.textContent === copy.authRecoveryCopy);
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String((writeText.mock.calls[0] as unknown[] | undefined)?.[0] ?? '');
    expect(copied.split('\n')[0]).toBe(`۱. ${CODES[0]}`);
    expect(copied).toContain(CODES[2]);
  });

  it('leaves the numbering in Latin digits in English', async () => {
    setLang('en');
    await mount();
    const numbering = [...document.querySelectorAll('.recovery-code-num')].map((item) => item.textContent);
    expect(numbering).toEqual(['1', '2', '3']);
    expect(getLang()).toBe('en');
  });
});
