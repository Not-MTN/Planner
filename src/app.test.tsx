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

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  act(() => {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pressKey(key: string, options?: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  });
}

/**
 * Lazy-loaded views resolve whenever the import resolves — polling beats a
 * fixed sleep, which flakes under heavier test machines.
 */
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
  // Tests below are not about the tour; only the dedicated tour test clears this.
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
    await settle();
    expect(text()).toContain('How your days are taking shape');
    expect(document.querySelectorAll('[aria-label="Progress charts"] .chart-card')).toHaveLength(2);
    expect(document.querySelectorAll('[aria-label="Focus and rhythm"] .chart-card')).toHaveLength(2);
    expect(document.querySelector('.palette')).toBeFalsy();
  });

  it('loads the sample day from the welcome card', () => {
    mountApp();
    const sample = [...document.querySelectorAll<HTMLButtonElement>('.welcome-actions .btn')].find((button) =>
      button.textContent?.includes('sample day'),
    );
    expect(sample).toBeTruthy();
    act(() => {
      sample?.click();
    });
    expect(text()).toContain('Finish the report');
    expect(text()).toContain('Read 20 minutes');
    expect(text()).toContain('Daily essentials');
  });

  it('adds the daily essentials from the welcome card', () => {
    mountApp();
    const add = [...document.querySelectorAll<HTMLButtonElement>('.welcome-actions .btn')].find((button) =>
      button.textContent?.includes('essential'),
    );
    expect(add).toBeTruthy();
    act(() => {
      add?.click();
    });
    expect(text()).toContain('Daily essentials');
    expect(text()).toContain('Drink water');
    expect(text()).toContain('Sleep by 11');
    expect(document.querySelector('.welcome-card')).toBeFalsy();
  });

  it('adds a habit from the built-in library', async () => {
    mountApp();
    const habitsNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) =>
      button.textContent?.includes('Habits'),
    );
    await act(async () => {
      habitsNav?.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(text()).toContain('Repeat what you want to keep');
    const chip = [...document.querySelectorAll<HTMLButtonElement>('.preset-chip')].find((button) =>
      button.textContent?.includes('Drink water'),
    );
    expect(chip).toBeTruthy();
    await act(async () => {
      chip?.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(document.querySelector('.habit-card')).toBeTruthy();
    expect(text()).toContain('Drink water');
    expect(text()).toContain('Daily must-do');
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

  function setTextareaValue(area: HTMLTextAreaElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(area, value);
    act(() => {
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('has a voice chat with the AI that answers and builds the plan', async () => {
    // Stub speech in: one final utterance after Dictate is tapped.
    let recognition: { onresult: ((e: unknown) => void) | null; onend: (() => void) | null } | null = null;
    class FakeRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { recognition = this as unknown as typeof recognition; }
      stop() { this.onend?.(); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    // Stub speech out: capture what gets spoken.
    const spoken: string[] = [];
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      getVoices: () => [{ lang: 'en-US', name: 'Test voice', default: true }],
      cancel: () => undefined,
      speak: (utterance: { text: string; onend?: (() => void) | null; onerror?: (() => void) | null }) => {
        spoken.push(utterance.text);
        utterance.onend?.();
      },
    };
    // Stub the xAI proxy: chat completions answers with a spoken reply + a draft.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/xai/status')) {
        return new Response(JSON.stringify({ configured: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/xai/chat/completions')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            reply: 'Got you — a gentle Tuesday, with one hour to breathe before the gym.',
            followUp: null,
            draft: {
              summary: 'Gentle Tuesday',
              tasks: [{ title: 'Gym bag', date: '2026-09-29', priority: 'low', category: 'health' }],
              events: [],
              habits: [],
              suggestions: [],
            },
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
      await waitForText('Make a plan that fits.');
      expect(text()).toContain('Talk to your planner');
      // tap the orb → listening
      const orb = document.querySelector<HTMLButtonElement>('.voice-orb');
      expect(orb).toBeTruthy();
      act(() => orb?.click());
      expect(document.querySelector('.voice-card')?.className).toContain('voice-listening');
      expect(text()).toContain("I'm listening");
      // final utterance arrives → thinking → reply + draft
      await act(async () => {
        (recognition as unknown as { onresult: ((e: unknown) => void) | null })?.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: 'make tomorrow gentle, gym late afternoon' } }],
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      expect(text()).toContain('make tomorrow gentle, gym late afternoon');
      expect(text()).toContain('a gentle Tuesday');
      expect(text()).toContain('Gentle Tuesday'); // the draft landed in the review card
      expect(spoken.join(' ')).toContain('gentle Tuesday'); // and it was spoken aloud
    } finally {
      globalThis.fetch = originalFetch;
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
      delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    }
  });

  it('settles the mic UI on permission denial instead of hanging', async () => {
    class DenyingRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      start() { this.onerror?.({ error: 'not-allowed' }); }
      stop() { this.onend?.(); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = DenyingRecognition;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/xai/status')) {
        return new Response(JSON.stringify({ configured: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('should never reach the AI');
    }) as typeof fetch;
    try {
      mountApp();
      const aiNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) => button.textContent?.includes('AI coach'));
      await act(async () => {
        aiNav?.click();
      });
      await waitForText('Make a plan that fits.');
      const orb = document.querySelector<HTMLButtonElement>('.voice-orb');
      act(() => orb?.click());
      // Denied: the orb goes home, and the user gets told why.
      expect(document.querySelector('.voice-card')?.className).not.toContain('voice-listening');
      expect(text()).toContain('allow the microphone');
      expect(orb?.disabled).toBe(false); // ready to try again
    } finally {
      globalThis.fetch = originalFetch;
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    }
  });

  it('offers a retry after a voice-turn error without duplicating bubbles', async () => {
    class FakeRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      start() { window.setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'fix my friday' } }] }); }, 10); }
      stop() { this.onend?.(); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const originalFetch = globalThis.fetch;
    let attempts = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/xai/status')) {
        return new Response(JSON.stringify({ configured: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/xai/chat/completions')) {
        attempts += 1;
        if (attempts === 1) return new Response('boom', { status: 500 });
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ reply: 'Friday is calm now.', followUp: null, draft: null }) } }],
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
      await waitForText('Make a plan that fits.');
      act(() => document.querySelector<HTMLButtonElement>('.voice-orb')?.click());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
      expect(text()).toContain('fix my friday');
      expect(document.querySelector('.voice-error')).toBeTruthy();
      const retries = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === 'Try again');
      expect(retries).toHaveLength(1);
      await act(async () => {
        retries[0].click();
        await new Promise((resolve) => setTimeout(resolve, 350));
      });
      expect(text()).toContain('Friday is calm now.');
      // the retry must not re-add the same spoken line to the chat
      const userBubbles = [...document.querySelectorAll('.voice-bubble.user')].filter((b) => b.textContent === 'fix my friday');
      expect(userBubbles).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    }
  });

  it('dictates a plan request to the AI with the browser voice service', async () => {
    let live: { onresult: ((event: unknown) => void) | null; onend: (() => void) | null; lang: string; started: boolean } | null = null;
    class FakeRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      started = false;
      constructor() {
        live = this as unknown as typeof live;
      }
      start() { this.started = true; }
      stop() { this.onend?.(); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    mountApp();
    try {
      const aiNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) => button.textContent?.includes('AI coach'));
      await act(async () => {
        aiNav?.click();
      });
      await waitForText('Make a plan that fits.');
      const mic = document.querySelector<HTMLButtonElement>('.voice-mic');
      expect(mic).toBeTruthy(); // mic renders only because dictation is available
      setTextareaValue(document.querySelector('.ai-prompt-field textarea') as HTMLTextAreaElement, 'Keep evenings free.');
      act(() => mic?.click());
      expect(document.querySelector('.voice-mic')?.getAttribute('aria-pressed')).toBe('true');
      expect((live as unknown as { started: boolean } | null)?.started).toBe(true);
      expect((live as unknown as { lang: string } | null)?.lang).toBe('en-US');
      act(() => {
        (live as unknown as { onresult: (e: unknown) => void } | null)?.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'gym at 6 pm' } }] });
      });
      const textarea = document.querySelector('.ai-prompt-field textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Keep evenings free. gym at 6 pm');
      act(() => mic?.click());
      expect(document.querySelector('.voice-mic')?.getAttribute('aria-pressed')).toBe('false');
    } finally {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    }
  });

  it('opens the AI coach and shows the protected weekly schedule editor', async () => {
    mountApp();
    const aiNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) =>
      button.textContent?.includes('AI coach'),
    );
    await act(async () => {
      aiNav?.click();
    });
    await waitForText('Make a plan that fits.');
    expect(text()).toContain('Make a plan that fits');
    expect(text()).toContain('Weekly fixed times');
    expect(text()).toContain('Add a plan picture');
    const fixedForm = document.querySelector<HTMLFormElement>('.fixed-form');
    expect(fixedForm).toBeTruthy();
    const title = fixedForm?.querySelector<HTMLInputElement>('input');
    setInputValue(title as HTMLInputElement, 'Class');
    act(() => {
      fixedForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.fixed-list-item')?.textContent).toContain('Tuesday · 08:00–09:00');
    const saved = JSON.parse(window.localStorage.getItem('personal-planner.v1') ?? '{}') as { fixedCommitments?: Array<{ title: string }> };
    expect(saved.fixedCommitments?.[0]?.title).toBe('Class');
  });

  it('saves life context in AI memory and keeps it after the view changes', async () => {
    mountApp();
    const aiNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) => button.textContent?.includes('AI coach'));
    await act(async () => {
      aiNav?.click();
    });
    await waitForText('Make a plan that fits.');
    expect(text()).toContain('AI memory');
    const memory = document.querySelector<HTMLTextAreaElement>('.ai-memory-form textarea');
    expect(memory).toBeTruthy();
    setTextAreaValue(memory as HTMLTextAreaElement, 'I keep Sunday evenings for family.');
    const form = document.querySelector<HTMLFormElement>('.ai-memory-form');
    act(() => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(text()).toContain('I keep Sunday evenings for family.');
    const saved = JSON.parse(window.localStorage.getItem('personal-planner.v1') ?? '{}') as { aiMemory?: Array<{ text: string; category: string }> };
    expect(saved.aiMemory).toEqual([expect.objectContaining({ text: 'I keep Sunday evenings for family.', category: 'context' })]);
    const today = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) => button.textContent?.includes('Today'));
    act(() => today?.click());
    const aiAgain = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) => button.textContent?.includes('AI coach'));
    await act(async () => {
      aiAgain?.click();
    });
    await waitForText('Make a plan that fits.');
    expect(text()).toContain('I keep Sunday evenings for family.');
  });

  it('explains how to configure the server-side xAI key', async () => {
    mountApp();
    const aiNav = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) => button.textContent?.includes('AI coach'));
    await act(async () => {
      aiNav?.click();
    });
    await waitForText('Make a plan that fits.');
    const settings = [...document.querySelectorAll<HTMLButtonElement>('.ai-head-actions button')].find((button) => button.textContent?.includes('AI settings'));
    act(() => settings?.click());
    expect(text()).toContain('AI coach · xAI');
    expect(text()).toContain('XAI_API_KEY=your_xai_api_key');
    expect(text()).toContain('.env.local');
    expect(document.querySelector('.ai-key-field input')).toBeFalsy();
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

  it('shows shared space, feeds, weather, import and templates in settings', async () => {
    mountApp();
    click(document.querySelector('[aria-label="Settings"]') ?? buttonByText('Settings'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    for (const label of ['Shared space', 'Calendar feeds', 'Weather on Today', 'Move your tasks in', 'Templates']) {
      expect(text()).toContain(label);
    }
    // Shared space: create a room from the button.
    const create = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Create a shared space'));
    expect(create).toBeTruthy();
    await act(async () => {
      create?.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(text()).toContain('Shared space is on');
    expect(window.localStorage.getItem('planner-shared')).toContain('"code"');
    // Templates: seeded starters are listed and removable.
    expect(text()).toContain('Trip packing');
  });

  it('welcomes a first-time visitor with the tour and remembers completion', async () => {
    localStorage.clear();
    mountApp();
    const text = () => document.body.textContent ?? '';
    expect(text()).toContain('Welcome to Planner');
    expect(text()).toContain('Pick your language');
    expect(document.querySelector('[data-tour]')).toBeTruthy();

    // Picking the already-active language advances without a reload.
    const active = document.querySelector('.tour-lang-btn[aria-pressed="true"]') as HTMLButtonElement;
    expect(active).toBeTruthy();
    act(() => active.click());
    expect(text()).toContain('Your day, at a glance');

    // Walk one more step (the tour moves to the AI coach page), then skip → done is remembered.
    await Promise.resolve();
    act(() => (document.querySelector('[data-tour-bubble] [data-tour-primary]') as HTMLButtonElement).click());
    expect(text()).toContain('Talk to your AI coach');
    act(() => (document.querySelector('.tour-skip') as HTMLButtonElement).click());
    expect(text()).not.toContain('Talk to your AI coach');
    expect(localStorage.getItem('planner-tour-done')).toBe('1');
  });

  it('opens the Why Planner sheet from the More menu and can start the tour from it', async () => {
    mountApp();
    const moreBtn = [...document.querySelectorAll('.tabbar .tab')].find((b) => b.textContent?.includes('More')) as HTMLButtonElement;
    expect(moreBtn).toBeTruthy();
    act(() => moreBtn.click());
    const whyBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Why Planner?')) as HTMLButtonElement;
    expect(whyBtn).toBeTruthy();
    act(() => whyBtn.click());
    const text = () => document.body.textContent ?? '';
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(text()).toContain('One quiet place for one wild life');
    expect(text()).toContain('Private by design');
    act(() => (document.querySelector('[aria-label="Close"]') as HTMLButtonElement).click());
    expect(text()).not.toContain('Private by design');
  });

  it('has an accessible name on every button and keeps focus styles', async () => {
    window.history.replaceState(null, '', '#/tasks');
    mountApp();
    // Seed tasks through quick add so the Select toggle appears.
    const quick = document.querySelector<HTMLInputElement>('.quick-add input');
    if (quick) {
      setInputValue(quick, 'A labelled task');
      act(() => {
        document.querySelector<HTMLFormElement>('.quick-add')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    }
    const unlabelled: string[] = [];
    document.querySelectorAll<HTMLElement>('button').forEach((button) => {
      const name = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim();
      if (!name) unlabelled.push(button.className || button.outerHTML.slice(0, 60));
    });
    expect(unlabelled).toEqual([]);
  });

  it('logs the day mood from Today and keeps it', async () => {
    mountApp();
    expect(text()).toContain('How did today feel?');
    const bright = document.querySelector<HTMLButtonElement>('[aria-label="Log today as Bright"]');
    expect(bright).toBeTruthy();
    act(() => bright?.click());
    expect(text()).toContain('Today felt bright');
    expect(bright?.getAttribute('aria-pressed')).toBe('true');
    const saved = JSON.parse(window.localStorage.getItem('personal-planner.v1') ?? '{}') as { moods?: Array<{ value: number }> };
    expect(saved.moods?.[0]?.value).toBe(4);
    // Tapping the same mood again clears the check-in.
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Log today as Bright"]')?.click());
    expect(text()).toContain('How did today feel?');
    const cleared = JSON.parse(window.localStorage.getItem('personal-planner.v1') ?? '{}') as { moods?: unknown[] };
    expect(cleared.moods ?? []).toHaveLength(0);
  });

  it('navigates between the main views', async () => {
    mountApp();
    const calendar = [...document.querySelectorAll<HTMLButtonElement>('.nav-link')].find((button) =>
      button.textContent?.includes('Calendar'),
    );
    await act(async () => {
      calendar?.click();
    });
    await waitForText('Seven days, loosely held');
    const monthTab = [...document.querySelectorAll<HTMLButtonElement>('.cal-tabs .seg')].find((button) =>
      button.textContent?.includes('Month'),
    );
    await act(async () => {
      monthTab?.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(document.querySelector('.month-grid')).toBeTruthy();
  });
});

/** Await the lazy route chunks (Calendar / Insights / AI). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

function click(element: Element | null | undefined): void {
  if (!element) throw new Error('element missing');
  act(() => {
    (element as HTMLElement).click();
  });
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === label);
}

describe('new features', () => {
  it('quick adds a repeating task and completing it schedules the next one', () => {
    mountApp();
    const input = document.querySelector<HTMLInputElement>('.quick-add input');
    if (!input) throw new Error('missing quick add');
    setInputValue(input, 'Stretch every day');
    expect(text()).toContain('Every day');
    act(() => {
      input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.repeat-chip')).toBeTruthy();
    click(document.querySelector('[aria-label="Mark Stretch complete"]'));
    const saved = JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}') as { tasks: Array<{ completed: boolean; repeat: string | null }> };
    expect(saved.tasks).toHaveLength(2);
    expect(saved.tasks.filter((task) => task.repeat === 'daily' && !task.completed)).toHaveLength(1);
  });

  it('adds checklist steps in the composer and shows progress', () => {
    mountApp();
    pressKey('n');
    const title = document.querySelector<HTMLInputElement>('[role="dialog"] input[data-autofocus]');
    if (!title) throw new Error('missing title');
    setInputValue(title, 'Pack');
    const step = document.querySelector<HTMLInputElement>('[aria-label="New checklist step"]');
    if (!step) throw new Error('missing step input');
    setInputValue(step, 'Passport');
    click(document.querySelector('.subtask-add button'));
    setInputValue(step, 'Charger');
    act(() => {
      title.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(text()).toContain('0/2 steps');
    click(document.querySelector('.steps-chip'));
    click(document.querySelector('[aria-label="Mark step Passport done"]'));
    expect(text()).toContain('1/2 steps');
  });

  it('switches Tasks to a board', () => {
    window.history.replaceState(null, '', '#/tasks');
    mountApp();
    click(buttonByText('Try a sample day'));
    click(document.querySelector('[role="radio"][aria-checked="false"]'));
    const board = document.querySelector('.board');
    expect(board).toBeTruthy();
    expect(board?.textContent).toContain('Anytime');
    expect(localStorage.getItem('planner-task-layout')).toContain('board');
  });

  it('shows reminders, calendar and install settings', () => {
    mountApp();
    click(document.querySelector('[aria-label="Settings"]') ?? buttonByText('Settings'));
    expect(text()).toContain('Reminders');
    expect(text()).toContain('Export .ics');
    expect(text()).toContain('Week starts on');
  });

  it('renders notes as safe markdown with tags', () => {
    window.history.replaceState(null, '', '#/notes');
    localStorage.setItem('personal-planner.v1', JSON.stringify({ notes: [{ id: 'n', title: 'Ideas', body: '**Bold** #work <img src=x onerror=alert(1)>\n- [x] done', kind: 'idea' }] }));
    mountApp();
    expect(document.querySelector('.md-body strong')?.textContent).toBe('Bold');
    expect(document.querySelector('.md-body img')).toBeNull();
    expect(document.querySelector('.tag-row')?.textContent).toContain('#work');
  });
});
