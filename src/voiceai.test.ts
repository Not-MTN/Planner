// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compressHistory, normalizeVoiceReply, pickVoice, replyLang, speakText, stopSpeaking, voiceRange, voiceSystemPrompt, voiceTurn, VOICE_HISTORY_LIMIT, type VoiceCurrentDraft } from './voiceai';
import { DEFAULT_MAX_TOKENS, LONG_RANGE_MAX_TOKENS, GROQ_TEXT_MODEL, GROQ_VISION_MODEL } from './ai';
import { createEmptyState } from './types';

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

describe('voice ai', () => {
  beforeEach(() => {
    // every test starts with a predictable localStorage
    localStorage.clear();
  });

  it('keeps only the recent, trimmed conversation turns', () => {
    const long = 'word '.repeat(120);
    const turns = Array.from({ length: VOICE_HISTORY_LIMIT + 4 }, (_, i) => ({
      role: i % 2 ? 'assistant' as const : 'user' as const,
      text: `  turn ${i}  ${long} `,
    }));
    const compressed = compressHistory(turns);
    expect(compressed).toHaveLength(VOICE_HISTORY_LIMIT);
    expect(compressed[0].text.startsWith(`turn 4`)).toBe(true);
    for (const turn of compressed) {
      expect(turn.text.length).toBeLessThanOrEqual(280);
      expect(turn.text).not.toMatch(/^\s/);
    }
  });

  it('rejects an empty utterance before calling the API', async () => {
    await expect(voiceTurn({ utterance: '   ', history: [], state: createEmptyState() })).rejects.toThrow();
  });

  it('voices are chosen by language, never crossed', () => {
    const fa = { lang: 'fa-IR', name: 'Soroush' };
    const en = { lang: 'en-US', name: 'Samantha', default: true };
    expect(pickVoice([fa, en], 'fa')).toBe(fa);
    expect(pickVoice([en], 'fa')).toBeNull(); // no Persian voice → silence, not gibberish
    expect(pickVoice([en], 'en')).toBe(en);
    expect(pickVoice([], 'en')).toBeNull();
  });

  it('understands the reply payload and drops empty or range-breaking drafts', () => {
    const state = createEmptyState();
    const range = voiceRange(today);
    const inRange = { title: 'Call dentist', date: today, priority: 'medium', category: 'personal' };
    const outOfRange = { title: 'Ancient thing', date: '2001-01-01', priority: 'medium', category: 'personal' };
    const reply = normalizeVoiceReply({
      reply: 'Here you go.',
      followUp: null,
      draft: { summary: 'day plan', tasks: [inRange, outOfRange], events: [], habits: [] },
    }, state, range);
    expect(reply.reply).toBe('Here you go.');
    expect(reply.draft).not.toBeNull();
    expect(reply.draft!.tasks.map((item) => item.title)).toEqual(['Call dentist']);

    const empty = normalizeVoiceReply({ reply: 'ok', followUp: null, draft: { summary: '', tasks: [], events: [], habits: [] } }, state, range);
    expect(empty.draft).toBeNull();

    const broken = normalizeVoiceReply({}, state, range);
    expect(broken.reply).toContain('Let me look');
  });

  it('instructs the model to understand tired, casual speech — no markdown', () => {
    const prompt = voiceSystemPrompt();
    expect(prompt).toContain('Understand intent, not literal words');
    expect(prompt).toContain('no markdown');
    expect(prompt).toContain('tired');
    expect(prompt.toLowerCase()).toContain('persian');
  });

  it('is fluent in messy real-world Persian: colloquial, Dari, Finglish, typos', () => {
    const prompt = voiceSystemPrompt();
    // Colloquial/spoken forms are named explicitly so the model expects them.
    expect(prompt).toContain('میخوام');
    expect(prompt).toContain('خسته‌م');
    // Regional varieties and Latin-letter Persian are understood as Persian.
    expect(prompt).toContain('Dari');
    expect(prompt).toContain('Finglish');
    expect(prompt).toContain('farda miam');
    // Keyboard-letter typos are called out as normal.
    expect(prompt).toContain('ي/ی');
    // The user is never made to repeat or rephrase.
    expect(prompt).toContain('Never ask the user to repeat');
    // Answers match the language the user actually spoke.
    expect(prompt).toContain('IN THE USER\'S LANGUAGE');
    expect(prompt).toContain('conversational Persian');
  });

  it('speaks replies with a voice matching the reply text, not the app', () => {
    expect(replyLang('باشه، فردا رو سبک می‌چینم.')).toBe('fa');
    expect(replyLang('Sure, keeping tomorrow light.')).toBe('en');
    // Mostly-Persian with a few Latin words still speaks Persian.
    expect(replyLang('باشه، deep work رو می‌ذارم عصر.')).toBe('fa');
  });

  it('sends the utterance, bounded history and schedule context to the Groq proxy', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: 'tomorrow has breathing room',
                  followUp: null,
                  draft: {
                    summary: 'a soft tomorrow',
                    tasks: [{ title: 'Nap', date: tomorrow, priority: 'low', category: 'health' }],
                    events: [],
                    habits: [],
                  },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const state = createEmptyState();
      const result = await voiceTurn({ utterance: "I'm wiped. Make tomorrow soft?", history: [{ role: 'user', text: 'hi' }], state });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain('/api/ai/chat/completions');
      const body = JSON.parse(calls[0].body) as { messages: Array<{ role: string; content: string }>; response_format?: { type: string } };
      expect(body.response_format?.type).toBe('json_object');
      const userMessage = JSON.parse(body.messages[1].content) as {
        utterance: string;
        history: unknown[];
        context: { today: string };
        range: { startDate: string; endDate: string; days: number };
      };
      expect(userMessage.utterance).toBe("I'm wiped. Make tomorrow soft?");
      expect(Array.isArray(userMessage.history)).toBe(true);
      expect(userMessage.context.today).toBe(today);
      // The user said "tomorrow" — the AI plans exactly that day.
      expect(userMessage.range).toEqual({ startDate: tomorrow, endDate: tomorrow, days: 1 });
      expect(result.range).toEqual({ startDate: tomorrow, days: 1 });
      expect(result.reply).toBe('tomorrow has breathing room');
      expect(result.draft?.tasks[0].title).toBe('Nap');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it('asks for more room when the spoken request covers a long stretch', async () => {
    // A spoken "plan my next two months" carries a whole draft inside the reply
    // JSON, so a week-sized budget would truncate it mid-plan.
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ reply: 'on it', followUp: null, draft: null }) } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const budget = (index: number) => (JSON.parse(bodies[index]) as { max_completion_tokens: number }).max_completion_tokens;
      await voiceTurn({ utterance: 'plan my evening', history: [], state: createEmptyState() });
      await voiceTurn({ utterance: 'plan my next two months', history: [], state: createEmptyState() });
      expect(budget(0)).toBe(DEFAULT_MAX_TOKENS);
      expect(budget(1)).toBe(LONG_RANGE_MAX_TOKENS);
      expect(LONG_RANGE_MAX_TOKENS).toBeGreaterThan(DEFAULT_MAX_TOKENS);
      // Voice never sends an image, so it must stay on the text model.
      expect((JSON.parse(bodies[0]) as { model: string }).model).toBe(GROQ_TEXT_MODEL);
      expect(GROQ_VISION_MODEL).not.toBe(GROQ_TEXT_MODEL);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps the horizon from earlier in the conversation when answering a follow-up', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ reply: 'sorted', followUp: null, draft: null }) } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      // Earlier the user asked for a month; now they just answer a question.
      const result = await voiceTurn({
        utterance: 'yes, keep it light',
        history: [{ role: 'user', text: 'plan my next month' }, { role: 'assistant', text: 'Which part matters most?' }],
        state: createEmptyState(),
      });
      expect(result.range).toEqual({ startDate: today, days: 30 });
      const body = JSON.parse(calls[0]) as { messages: Array<{ role: string; content: string }> };
      const payload = JSON.parse(body.messages[1].content) as { range: { days: number; startDate: string } };
      expect(payload.range.days).toBe(30);
      expect(payload.range.startDate).toBe(today);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('revises the draft on screen: keeps its range and sends it to the model', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ reply: 'Tuesday is lighter now.', followUp: null, draft: null }) } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const draftRange = { startDate: today, days: 14 };
      const currentDraft: VoiceCurrentDraft = {
        draft: {
          summary: 'A two-week push.',
          tasks: [{ title: 'Deep work block', dueDate: today, dueTime: null, priority: 'high', category: 'work', note: '', goalId: null }],
          events: [],
          habits: [],
          suggestions: ['Rest counts too.'],
          skippedEvents: [],
        },
        range: draftRange,
      };
      const result = await voiceTurn({
        utterance: 'make it lighter on tuesday',
        history: [],
        state: createEmptyState(),
        currentDraft,
      });
      // No new length was spoken — the revision keeps the draft's horizon.
      expect(result.range).toEqual(draftRange);
      const body = JSON.parse(calls[0]) as { messages: Array<{ role: string; content: string }> };
      const payload = JSON.parse(body.messages[1].content) as {
        range: { days: number };
        currentDraft?: { summary: string; tasks: Array<{ title: string }>; suggestions: string[] };
      };
      expect(payload.range.days).toBe(14);
      expect(payload.currentDraft?.summary).toBe('A two-week push.');
      expect(payload.currentDraft?.tasks[0].title).toBe('Deep work block');
      expect(payload.currentDraft?.suggestions).toEqual(['Rest counts too.']);
      // The model is told it is editing the draft on screen.
      expect(body.messages[0].content).toContain('currentDraft');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('a freshly spoken length beats the draft range', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ reply: 'done', followUp: null, draft: null }) } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const result = await voiceTurn({
        utterance: 'actually, plan the next three days instead',
        history: [],
        state: createEmptyState(),
        currentDraft: { draft: { summary: 'x', tasks: [], events: [], habits: [], suggestions: [], skippedEvents: [] }, range: { startDate: today, days: 30 } },
      });
      expect(result.range.days).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('defaults to the week ahead when no length is mentioned anywhere', () => {
    const range = voiceRange(today);
    expect(range).toEqual({ startDate: today, days: 7 });
    expect(voiceRange(today, 'make it gentle')).toEqual({ startDate: today, days: 7 });
    expect(voiceRange(today, 'plan the next two weeks')).toEqual({ startDate: today, days: 14 });
  });

  it('finish callbacks are deferred and the watchdog settles a silent engine', () => {
    vi.useFakeTimers();
    const spoken: string[] = [];
    type Captured = { text: string; onend?: (() => void) | null; onerror?: (() => void) | null };
    let captured: Captured | null = null;
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      getVoices: () => [{ lang: 'en-US', name: 'V', default: true }],
      cancel: () => undefined,
      resume: () => undefined,
      speak: (u: { text: string; onend?: (() => void) | null; onerror?: (() => void) | null }) => {
        captured = u;
        spoken.push(u.text);
      },
    };
    let ended = 0;
    expect(speakText('a soft hello', { lang: 'en', onend: () => { ended += 1; } })).toBe(true);
    // Engine fires onend synchronously: the listener must still fire, deferred.
    (captured as Captured | null)?.onend?.();
    expect(ended).toBe(0);
    vi.runAllTimers();
    expect(ended).toBe(1);
    // Second turn: engine forgets BOTH callbacks — the watchdog closes it anyway.
    ended = 0;
    captured = null;
    expect(speakText('another reply', { lang: 'en', onend: () => { ended += 1; } })).toBe(true);
    vi.advanceTimersByTime(21_000);
    expect(ended).toBe(1);
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    vi.useRealTimers();
  });

  it('stays silent for Persian without a Persian voice, speaks English', () => {
    const spoken: string[] = [];
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      getVoices: () => [{ lang: 'en-US', name: 'V', default: true }],
      cancel: () => undefined,
      speak: (u: { text: string }) => spoken.push(u.text),
    };
    expect(speakText('سلام دنیا', { lang: 'fa' })).toBe(false);
    expect(spoken).toHaveLength(0);
    expect(speakText('hello there', { lang: 'en' })).toBe(true);
    expect(spoken).toEqual(['hello there']);
    stopSpeaking();
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  });
});
