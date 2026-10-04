// @vitest-environment jsdom
/**
 * The AI tab is the busiest page in the app: a composer, a draft, a voice
 * console, saved memory and the protected weekly schedule all live on it. These
 * tests hold the shape that keeps it readable — one composer at the top, the
 * settings you visit on purpose folded away, and the privacy promise said once
 * at the end rather than as a banner before you have asked anything.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, act } from 'react';
import { waitFor, waitForBoot } from './testing/wait';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import { addDays, formatFullDate, todayISO } from './dates';

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

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('planner-tour-done', '1');
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
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Boot straight into the AI tab: the route comes from the hash. */
async function gotoAI(): Promise<void> {
  window.history.replaceState(null, '', '#/ai');
  mountApp();
  await waitForBoot(text);
  await waitFor(() => text().includes('Make a plan that fits.'), 10_000, 'the AI tab');
}

describe('AI tab layout', () => {
  it('puts one composer first, and folds memory and protected time below the answer', async () => {
    await gotoAI();

    const composer = document.querySelector('.ai-composer');
    expect(composer).toBeTruthy();
    // The prompt lives inside the composer, and the composer comes before every
    // disclosure, so nothing has to be scrolled past to ask a question.
    expect(composer?.querySelector('.ai-prompt-field textarea')).toBeTruthy();
    expect(composer?.querySelector('.ai-range-row')).toBeTruthy();

    const folds = [...document.querySelectorAll('.ai-fold')];
    expect(folds.length).toBe(2);
    expect(folds.every((fold) => fold instanceof HTMLDetailsElement && !fold.open)).toBe(true);
    for (const fold of folds) {
      expect(composer!.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(text()).toContain('AI memory');
    expect(text()).toContain('Weekly fixed times');

    // The editor still works when the fold is opened — this is the same form,
    // just not the first thing on the page.
    const fixedFold = folds[1] as HTMLDetailsElement;
    fixedFold.open = true;
    expect(fixedFold.querySelector('.fixed-form')).toBeTruthy();
  });

  it('says the privacy promise and the apply rule once, in plain places', async () => {
    await gotoAI();
    expect(document.querySelectorAll('.ai-note')).toHaveLength(1);
    expect(document.querySelector('.ai-note')?.textContent).toContain('Your data, your choice.');
    expect(text()).toContain('Typed and spoken requests create a reviewable draft');
    // The old marketing card ("Small features that make this even smarter") is
    // not part of the product any more.
    expect(text()).not.toContain('Small features that make this even smarter');
  });

  it('keeps the review tab to a range strip and one action', { timeout: 20_000 }, async () => {
    await gotoAI();
    const reviewTab = [...document.querySelectorAll<HTMLButtonElement>('.ai-tabs [role="tab"]')]
      .find((button) => button.textContent?.includes('Review how I did'));
    act(() => {
      reviewTab?.click();
    });
    await waitFor(() => text().includes('How did this stretch go?'), 12_000, 'the review tab');
    const controls = document.querySelector('.ai-review-controls');
    expect(controls?.querySelectorAll('.field').length).toBeGreaterThanOrEqual(2);
    expect(controls?.querySelector('.ai-review-action .btn-primary')).toBeTruthy();
  });

  it('reads a multi-day draft as one list per day, earliest first', { timeout: 20_000 }, async () => {
    const dayOne = addDays(todayISO(), 1);
    const dayTwo = addDays(todayISO(), 2);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/ai/status')) {
        return new Response(JSON.stringify({ configured: true }), { status: 200 });
      }
      if (url.includes('/api/ai/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: 'Two calm days.',
                    tasks: [
                      { title: 'Pack lunch', date: dayTwo, priority: 'low', category: 'health' },
                    ],
                    events: [
                      { title: 'Evening walk', date: dayOne, startTime: '18:00', endTime: '18:30', category: 'health' },
                      { title: 'Morning study', date: dayTwo, startTime: '08:00', endTime: '09:00', category: 'learning' },
                    ],
                    habits: [],
                    wellbeing: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    try {
      await gotoAI();
      // A week, so the two days below are both inside the requested range.
      const horizon = document.querySelector<HTMLSelectElement>('.ai-range-row select');
      expect(horizon).toBeTruthy();
      const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      await act(async () => {
        setSelect?.call(horizon, 'week');
        horizon?.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const field = document.querySelector<HTMLTextAreaElement>('.ai-prompt-field textarea');
      expect(field).toBeTruthy();
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      await act(async () => {
        setValue?.call(field, 'plan two calm days');
        field?.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const build = document.querySelector<HTMLButtonElement>('.ai-build');
      expect(build?.disabled).toBe(false);
      await act(async () => {
        build?.click();
      });
      await waitFor(() => Boolean(document.querySelector('.ai-draft-card')), 12_000, 'the draft');
      const headings = [...document.querySelectorAll('.ai-draft-card .draft-group')].map(
        (group) => group.querySelector('.draft-group-head strong')?.textContent ?? '',
      );
      // One heading per day, in reading order — not the model's own ordering,
      // which put the later day first here.
      expect(headings).toEqual([formatFullDate(dayOne), formatFullDate(dayTwo)]);
      const firstDay = document.querySelectorAll('.ai-draft-card .draft-group')[0];
      const secondDay = document.querySelectorAll('.ai-draft-card .draft-group')[1];
      expect(firstDay.textContent).toContain('Evening walk');
      // The timed item is listed before the untimed one inside a day.
      expect(secondDay.textContent?.indexOf('Morning study')).toBeLessThan(
        secondDay.textContent?.indexOf('Pack lunch') ?? -1,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
