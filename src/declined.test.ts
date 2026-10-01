/**
 * Learning from the suggestions a user turns down.
 *
 * The risk with a feature like this is not that it forgets too much — it is
 * that it quietly builds a file on somebody and then acts on it invisibly,
 * with no way back. So the tests here are mostly about the exits: the record
 * is bounded, it expires, it can be read, and it can be undone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDeclined, forgetDeclined, recordDeclined } from './mutate';
import { buildAIPlannerContext, buildPlanningContext, draftForModel, generateAIPlan } from './ai';
import { AI_DECLINED_LIMIT, AI_DECLINED_MAX_AGE_DAYS, createEmptyState, type PlannerState } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

const DAY_MS = 86_400_000;

function iso(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString();
}

function declined(state: PlannerState) {
  return state.aiDeclined ?? [];
}

describe('remembering what was turned down', () => {
  it('records a suggestion that was not kept', () => {
    const state = recordDeclined(createEmptyState(), [{ title: 'Morning run', kind: 'habit' }]);
    expect(declined(state)).toHaveLength(1);
    expect(declined(state)[0]).toMatchObject({ title: 'Morning run', kind: 'habit' });
  });

  it('ignores blank and whitespace-only titles', () => {
    const empty = createEmptyState();
    expect(recordDeclined(empty, [{ title: '   ', kind: 'task' }])).toBe(empty);
    expect(recordDeclined(empty, [{ title: '', kind: 'task' }])).toBe(empty);
  });

  it('does not keep two entries for the same idea, but does refresh the date', () => {
    // Pinned, not "now": recomputing the clock mid-test drifts by a few
    // milliseconds and fails for no reason.
    const saidAgain = new Date().toISOString();
    const first = recordDeclined(createEmptyState(), [{ title: 'Morning Run', kind: 'habit' }], iso(10));
    const second = recordDeclined(first, [{ title: 'morning run', kind: 'habit' }], saidAgain);
    // Case-insensitive: the same idea twice is one "no", said louder.
    expect(declined(second)).toHaveLength(1);
    expect(declined(second)[0]!.updatedAt).toBe(saidAgain);
  });

  it('is bounded, so a long habit of saying no cannot build a dossier', () => {
    let state = createEmptyState();
    for (let index = 0; index < AI_DECLINED_LIMIT + 25; index += 1) {
      state = recordDeclined(state, [{ title: `Idea ${index}`, kind: 'task' }], iso(AI_DECLINED_LIMIT + 25 - index));
    }
    expect(declined(state)).toHaveLength(AI_DECLINED_LIMIT);
    // The oldest fell off; the newest survived.
    expect(declined(state).some((item) => item.title === 'Idea 0')).toBe(false);
    expect(declined(state).some((item) => item.title === `Idea ${AI_DECLINED_LIMIT + 24}`)).toBe(true);
  });

  it('forgets on its own after a while — an old "no" is not evidence about today', () => {
    const stale = iso(AI_DECLINED_MAX_AGE_DAYS + 5);
    const old = recordDeclined(createEmptyState(), [{ title: 'Something I said no to years ago', kind: 'task' }], stale);
    expect(declined(old)).toHaveLength(1);

    // Adding anything new sweeps the expired ones out.
    const swept = recordDeclined(old, [{ title: 'Something new', kind: 'task' }], iso(0));
    expect(declined(swept).map((item) => item.title)).toEqual(['Something new']);
  });

  it('can be forgotten one at a time, and all at once', () => {
    const state = recordDeclined(createEmptyState(), [
      { title: 'Keep me', kind: 'task' },
      { title: 'Forget me', kind: 'event' },
    ]);
    const oneGone = forgetDeclined(state, declined(state).find((item) => item.title === 'Forget me')!.id);
    expect(declined(oneGone).map((item) => item.title)).toEqual(['Keep me']);

    // Forgetting something that is not there changes nothing at all.
    expect(forgetDeclined(oneGone, 'not-an-id')).toBe(oneGone);

    expect(declined(clearDeclined(oneGone))).toHaveLength(0);
    // Clearing an empty list is a no-op, not a new object for no reason.
    expect(clearDeclined(createEmptyState())).toEqual(createEmptyState());
  });

  it('sends what was declined to the AI, and tells it what the list means', async () => {
    const state = recordDeclined(createEmptyState(), [{ title: 'Morning run', kind: 'habit' }]);
    expect(buildAIPlannerContext(state).declined).toEqual([{ title: 'Morning run', kind: 'habit' }]);

    const payload = buildPlanningContext(state, { startDate: '2026-09-27', days: 7 });
    expect(payload.declinedSuggestions).toEqual([{ title: 'Morning run', kind: 'habit' }]);

    // A list with no explanation is just noise the model may ignore, so the
    // rule has to travel with it. Checked on the request that actually goes
    // out, not on a string assembled somewhere in the middle.
    const sent = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"summary":"ok","tasks":[],"events":[],"habits":[],"suggestions":[]}' } }] }),
    }));
    vi.stubGlobal('fetch', sent);
    try {
      await generateAIPlan({ prompt: 'plan my week', state, range: { startDate: '2026-09-27', days: 7 } });
    } finally {
      vi.unstubAllGlobals();
    }
    const body = JSON.parse(String(sent.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('declinedSuggestions');
    expect(system).toMatch(/do not propose them again/i);
    // The AI is told to keep this to itself: being visibly managed is worse
    // than being offered the odd unwanted idea.
    expect(system).toMatch(/never mention/i);
  });

  it('sends only the most recent slice, not the whole history', () => {
    let state = createEmptyState();
    for (let index = 0; index < 30; index += 1) {
      state = recordDeclined(state, [{ title: `Idea ${index}`, kind: 'task' }], iso(30 - index));
    }
    const context = buildAIPlannerContext(state);
    expect(context.declined).toHaveLength(20);
    // Newest last, so the freshest refusals are the ones that survive the cut.
    expect(context.declined.at(-1)).toEqual({ title: 'Idea 29', kind: 'task' });
  });
});

describe('the reason an item landed where it did', () => {
  it('keeps a short reason beside each item, not inside it', async () => {
    const state = createEmptyState();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: 'A steady week.',
              tasks: [{ title: 'Write the outline', date: '2026-09-29', priority: 'medium', category: 'work', note: '', reason: 'Tuesday morning is free after your 9am lecture.' }],
              events: [], habits: [], wellbeing: [],
            }),
          },
        }],
      }),
    })));
    try {
      const draft = await generateAIPlan({ prompt: 'plan my week', state, range: { startDate: '2026-09-27', days: 7 } });
      expect(draft.reasons?.['task:0']).toBe('Tuesday morning is free after your 9am lecture.');
      // The reason is not written into the task itself: a task should not
      // carry a permanent note about where an AI once put it.
      expect(draft.tasks[0]).not.toHaveProperty('reason');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps one sentence — a paragraph of justification cannot be argued with', async () => {
    const state = createEmptyState();
    const long = 'Tuesday is free in the morning. It is also a nice day. Furthermore, research suggests mornings are best.';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: 'ok',
              tasks: [{ title: 'Write', date: '2026-09-29', priority: 'medium', category: 'work', note: '', reason: long }],
              events: [], habits: [], wellbeing: [],
            }),
          },
        }],
      }),
    })));
    try {
      const draft = await generateAIPlan({ prompt: 'plan', state, range: { startDate: '2026-09-27', days: 7 } });
      expect(draft.reasons?.['task:0']).toBe('Tuesday is free in the morning.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks for reasons grounded in what it was told, not invented', async () => {
    const state = createEmptyState();
    const sent = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"summary":"ok","tasks":[],"events":[],"habits":[],"wellbeing":[]}' } }] }),
    }));
    vi.stubGlobal('fetch', sent);
    try {
      await generateAIPlan({ prompt: 'plan', state, range: { startDate: '2026-09-27', days: 7 } });
    } finally {
      vi.unstubAllGlobals();
    }
    const body = JSON.parse(String(sent.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toMatch(/never invent a fact/i);
    expect(system).toMatch(/shown to the user/i);
  });

  it('carries reasons into a revision so they can be rewritten, not lost', () => {
    const draft = {
      summary: 'x',
      tasks: [{ title: 'A', dueDate: '2026-09-29', dueTime: null, priority: 'medium' as const, category: 'work', note: '', goalId: null }],
      events: [], habits: [], suggestions: [], skippedEvents: [],
      reasons: { 'task:0': 'Monday is lighter.' },
    };
    const model = draftForModel(draft) as { tasks: Array<{ title: string; reason?: string }> };
    expect(model.tasks[0]?.reason).toBe('Monday is lighter.');

    // No reason on record stays absent rather than becoming an empty string.
    const bare = draftForModel({ ...draft, reasons: undefined }) as { tasks: Array<{ reason?: string }> };
    expect(bare.tasks[0]).not.toHaveProperty('reason');
  });
});
