// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import { STORAGE_KEY } from './storage';

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

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Poll until text appears — lazy views resolve on their own schedule. */
async function waitForText(needle: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!text().includes(needle)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for "${needle}"`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
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

function seedPlans(plans: unknown[]): void {
  const blob = {
    version: 1,
    exportedAt: '2026-09-28T08:00:00.000Z',
    tasks: [], events: [], fixedCommitments: [], aiMemory: [], habits: [], completions: [],
    goals: [], notes: [], moods: [], intentions: {}, focusLog: [],
    aiPlans: plans,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
}

const PLAN = {
  id: 'plan-1',
  title: 'A calm week',
  prompt: 'Plan a calm week',
  summary: 'A gentle week with room to breathe.',
  startDate: '2026-09-28',
  days: 7,
  status: 'draft',
  source: 'typed',
  tasks: [{ title: 'Water the plants', priority: 'low', dueDate: '2026-09-29', dueTime: null, category: 'home', note: '', goalId: null }],
  events: [],
  habits: [],
  suggestions: [],
  createdAt: '2026-09-28T08:00:00.000Z',
  updatedAt: '2026-09-28T08:00:00.000Z',
};

describe('Plans page', () => {
  it('shows an empty state with a way to the AI coach', async () => {
    window.history.replaceState(null, '', '#/plans');
    mountApp();
    await waitForText('No plans yet');
    const openCoach = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Open the AI coach'));
    expect(openCoach).toBeTruthy();
  });

  it('lists saved drafts and adds one to the planner', async () => {
    seedPlans([PLAN]);
    window.history.replaceState(null, '', '#/plans');
    mountApp();
    await waitForText('A calm week');
    expect(text()).toContain('A calm week');
    expect(text()).toContain('A gentle week with room to breathe.');
    expect(text()).toContain('Draft');

    const add = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Add to planner'));
    expect(add).toBeTruthy();
    await act(async () => {
      add?.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    // The plan card flips to "added" once its items join the planner.
    expect(text()).toContain('Added to planner');
    expect(text()).not.toContain('Add to planner');
    // And the task itself now lives on its due date.
    await act(async () => {
      window.location.hash = '#/day/2026-09-29';
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(text()).toContain('Water the plants');
  });

  it('keeps every AI draft automatically — typed flow lands on the Plans page', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/ai/status')) {
        return new Response(JSON.stringify({ configured: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/ai/chat/completions')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            summary: 'Two light days.',
            tasks: [{ title: 'Read ten pages', date: today, priority: 'low', category: 'learning' }],
            events: [],
            habits: [],
            wellbeing: [],
          }) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    try {
      mountApp();
      const aiNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) => button.textContent?.includes('AI coach'));
      await act(async () => {
        aiNav?.click();
      });
      await waitForText('What do you want to do?');
      const textarea = document.querySelector<HTMLTextAreaElement>('.ai-prompt-field textarea');
      expect(textarea).toBeTruthy();
      setInputValue(textarea as HTMLTextAreaElement, 'Plan my days gently');
      const build = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Build a draft'));
      expect(build).toBeTruthy();
      await act(async () => {
        build?.click();
      });
      await waitForText('Two light days.');
      expect(text()).toContain('Also saved to your Plans page');

      // Now visit the Plans page — the draft is waiting there.
      const plansNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) => button.textContent?.includes('Plans'));
      expect(plansNav).toBeTruthy();
      await act(async () => {
        plansNav?.click();
      });
      await waitForText('Plan my days gently');
      // Expand the plan card to see what the AI drafted inside it.
      const showItems = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Show 1 item'));
      expect(showItems).toBeTruthy();
      await act(async () => {
        showItems?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(text()).toContain('Read ten pages');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
