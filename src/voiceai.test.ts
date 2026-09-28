// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { compressHistory, normalizeVoiceReply, pickVoice, voiceRange, voiceSystemPrompt, voiceTurn, VOICE_HISTORY_LIMIT } from './voiceai';
import { createEmptyState } from './types';

const today = new Date().toISOString().slice(0, 10);

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

  it('sends the utterance, bounded history and schedule context to the xAI proxy', async () => {
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
                    tasks: [{ title: 'Nap', date: today, priority: 'low', category: 'health' }],
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
      expect(calls[0].url).toContain('/api/xai/chat/completions');
      const body = JSON.parse(calls[0].body) as { messages: Array<{ role: string; content: string }>; response_format?: { type: string } };
      expect(body.response_format?.type).toBe('json_object');
      const userMessage = JSON.parse(body.messages[1].content) as { utterance: string; history: unknown[]; context: { today: string } };
      expect(userMessage.utterance).toBe("I'm wiped. Make tomorrow soft?");
      expect(Array.isArray(userMessage.history)).toBe(true);
      expect(userMessage.context.today).toBe(today);
      expect(result.reply).toBe('tomorrow has breathing room');
      expect(result.draft?.tasks[0].title).toBe('Nap');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
