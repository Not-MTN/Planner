import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAIPlannerContext, findPromptScheduleConflicts, generateAIPlan, generateAIReview, GROQ_CHAT_URL, GROQ_TEXT_MODEL, GROQ_VISION_MODEL } from './ai';
import { addAIMemory, addEvent, addFixedCommitment, addTask, logFocus, saveAIPlan, toggleTask } from './mutate';
import { createEmptyState } from './types';

function mockGroq(content: unknown) {
  const payload = { choices: [{ message: { content: JSON.stringify(content) } }] };
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Groq planning assistant', () => {
  it('sends explicit memory and soft planner patterns as context without sending notes', async () => {
    let state = addAIMemory(createEmptyState(), { text: 'I need a quiet hour after lunch.', category: 'boundary' }, 'memory-1', '2026-09-27T08:00:00.000Z');
    state = addTask(state, {
      title: 'Ship the project', priority: 'high', dueDate: '2026-09-27', dueTime: null,
      category: 'work', note: 'private note should stay local', goalId: null,
    }, 'task-1', '2026-09-27T08:00:00.000Z');
    state = toggleTask(state, 'task-1', '2026-09-27T09:00:00.000Z');
    state = logFocus(state, { taskId: 'task-1', title: 'Ship the project', minutes: 25 }, 'focus-1', '2026-09-27T09:30:00.000Z');
    expect(buildAIPlannerContext(state)).toMatchObject({
      memory: [{ category: 'boundary', text: 'I need a quiet hour after lunch.' }],
      patterns: { focusHours: ['09:00'], completedTaskCategories: [{ category: 'work', count: 1 }] },
    });
    const fetchMock = mockGroq({ summary: 'A calm plan.', tasks: [], events: [], habits: [], wellbeing: [] });
    await generateAIPlan({ prompt: 'Plan a calm day.', range: { startDate: '2026-09-27', days: 1 }, state });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ role: string; content: string }> };
    const userMessage = request.messages.find((message) => message.role === 'user')?.content ?? '';
    expect(userMessage).toContain('I need a quiet hour after lunch.');
    expect(userMessage).toContain('focusHours');
    expect(userMessage).not.toContain('private note should stay local');
  });

  it('spots typed and Persian time collisions against the live calendar before planning', () => {
    const state = addEvent(createEmptyState(), {
      title: 'Class', date: '2026-09-28', startTime: '17:00', endTime: '18:00',
      category: 'learning', note: '', important: false,
    }, 'class-at-five', '2026-09-27T12:00:00.000Z');
    const range = { startDate: '2026-09-28', days: 1 };
    expect(findPromptScheduleConflicts('Add gym at 5 p.m. tomorrow', state, range)).toMatchObject([
      { title: 'Class', date: '2026-09-28', requestedTime: '17:00', startTime: '17:00', endTime: '18:00', source: 'event' },
    ]);
    expect(findPromptScheduleConflicts('فردا ساعت ۵ عصر باشگاه', state, range)[0]?.title).toBe('Class');
  });

  it('includes saved AI plans as clearly labeled context without treating drafts as live items', async () => {
    const added = addEvent(createEmptyState(), {
      title: 'Class', date: '2026-09-28', startTime: '17:00', endTime: '18:00',
      category: 'learning', note: '', important: false,
    }, 'class-at-five', '2026-09-27T12:00:00.000Z');
    const saved = saveAIPlan(added, {
      title: 'Exam week', prompt: 'Keep mornings calm', summary: 'A draft for exam week',
      startDate: '2026-09-28', days: 3, source: 'typed',
      tasks: [], events: [{ title: 'Gym', date: '2026-09-28', startTime: '17:00', endTime: '18:00', category: 'health', note: '', important: false }],
      habits: [], suggestions: [],
    }, 'plan-exam-week', '2026-09-27T13:00:00.000Z').state;
    const fetchMock = mockGroq({ summary: 'An adjusted draft.', tasks: [], events: [], habits: [], wellbeing: [] });
    await generateAIPlan({ prompt: 'What is going on with my plans?', range: { startDate: '2026-09-28', days: 1 }, state: saved });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ role: string; content: string }> };
    const system = request.messages.find((message) => message.role === 'system')?.content ?? '';
    const user = request.messages.find((message) => message.role === 'user')?.content ?? '';
    expect(system).toContain('Saved plans marked draft are proposals, not calendar commitments');
    expect(user).toContain('Exam week');
    expect(user).toContain('Class');
  });

  it('keeps protected weekly times and existing events clear when normalizing an AI plan', async () => {
    const now = '2026-09-27T12:00:00.000Z';
    let state = addFixedCommitment(createEmptyState(), {
      title: 'Class', weekday: 2, startTime: '08:00', endTime: '10:00', category: 'learning', note: '',
    }, 'class-tuesday', now);
    state = addTask(state, {
      title: 'Already planned', priority: 'medium', dueDate: '2026-09-30', dueTime: null,
      category: 'personal', note: '', goalId: null,
    }, 'task-existing', now);
    state = addEvent(state, {
      title: 'Appointment', date: '2026-09-29', startTime: '10:00', endTime: '11:00',
      category: 'personal', note: '', important: false,
    }, 'appointment', now);
    const fetchMock = mockGroq({
      summary: 'A balanced two-day plan.',
      tasks: [
        { title: 'Already planned', date: '2026-09-30', priority: 'medium', category: 'personal' },
        { title: 'Pack lunch', date: '2026-09-30', priority: 'low', category: 'health' },
        { title: 'Past item', date: '2026-09-28', priority: 'medium', category: 'personal' },
      ],
      events: [
        { title: 'Study over class', date: '2026-09-29', startTime: '08:30', endTime: '09:00', category: 'learning' },
        { title: 'Overlapping appointment', date: '2026-09-29', startTime: '10:15', endTime: '10:45', category: 'personal' },
        { title: 'Walk after class', date: '2026-09-29', startTime: '11:15', endTime: '11:45', category: 'health' },
      ],
      habits: [{ name: 'Stretch gently', frequency: { type: 'weekdays' }, category: 'health', icon: 'stretch' }],
      wellbeing: ['Keep one short break between study sessions.'],
    });

    const result = await generateAIPlan({
      prompt: 'Plan my school week gently.',
      range: { startDate: '2026-09-29', days: 2 },
      state,
    });

    expect(fetchMock).toHaveBeenCalledWith(GROQ_CHAT_URL, expect.objectContaining({ method: 'POST' }));
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { model: string };
    expect(request.model).toBe(GROQ_TEXT_MODEL);
    expect(result.tasks.map((task) => task.title)).toEqual(['Pack lunch']);
    expect(result.events.map((event) => event.title)).toEqual(['Walk after class']);
    expect(result.skippedEvents).toHaveLength(2);
    expect(result.skippedEvents[0].reason).toContain('protected time: Class');
    expect(result.skippedEvents[1].reason).toContain('existing event: Appointment');
    expect(result.habits[0]).toMatchObject({ name: 'Stretch gently', frequency: { type: 'weekdays' } });
    expect(result.suggestions).toEqual(['Keep one short break between study sessions.']);
  });

  it('uses the Groq vision model for an attached plan image for an attached plan image', async () => {
    const fetchMock = mockGroq({ summary: 'Read from the picture.', tasks: [], events: [], habits: [], wellbeing: [] });
    await generateAIPlan({
      prompt: '',
      range: { startDate: '2026-09-27', days: 1 },
      state: createEmptyState(),
      imageDataUrl: 'data:image/png;base64,cGxhbg==',
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(request.model).toBe(GROQ_VISION_MODEL);
    expect(request.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url' }),
    ]));
  });

  it('only offers real unfinished tasks to carry forward from an AI review', async () => {
    const now = '2026-09-27T12:00:00.000Z';
    let state = addTask(createEmptyState(), {
      title: 'Finish reading', priority: 'medium', dueDate: '2026-09-27', dueTime: null,
      category: 'learning', note: '', goalId: null,
    }, 'task-real', now);
    state = addTask(state, {
      title: 'Already done', priority: 'low', dueDate: '2026-09-27', dueTime: null,
      category: 'personal', note: '', goalId: null,
    }, 'task-done', now);
    state = toggleTask(state, 'task-done', now);
    mockGroq({
      summary: 'You made steady progress.',
      wins: ['You completed the task you planned.'],
      improvements: ['Leave a buffer for reading.'],
      wellness: 'Take a screen break when you can.',
      carryForward: [
        { taskId: 'task-real', date: '2026-09-28', reason: 'Give it a fresh slot.' },
        { taskId: 'invented-task', date: '2026-09-28', reason: 'Hallucinated item.' },
      ],
    });

    const result = await generateAIReview({
      state,
      range: { startDate: '2026-09-27', days: 1 },
      today: '2026-09-27',
    });

    expect(result.summary).toBe('You made steady progress.');
    expect(result.carryForward).toHaveLength(1);
    expect(result.carryForward[0]).toMatchObject({ taskId: 'task-real', date: '2026-09-28' });
  });
});

/**
 * A rate limit is measured per minute, so waiting is the one fix left after the
 * server has already tried every configured provider. These tests use fake
 * timers: the point is *how many* attempts happen, not how long they take.
 */
describe('AI request retries', () => {
  function plan(): Promise<unknown> {
    return generateAIPlan({
      prompt: 'Plan a calm day.',
      range: { startDate: '2026-09-27', days: 1 },
      state: createEmptyState(),
    });
  }

  function respondWith(responses: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      const next = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return new Response(JSON.stringify(next.body ?? { error: { message: 'nope' } }), {
        status: next.status,
        headers: { 'Content-Type': 'application/json', ...(next.headers ?? {}) },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up on a rate limit only after waiting it out', async () => {
    vi.useFakeTimers();
    const fetchMock = respondWith([
      { status: 429, body: { error: { message: 'Rate limit reached', code: 'rate_limited' } } },
      { status: 200, body: { choices: [{ message: { content: '{"summary":"Second time lucky.","tasks":[],"events":[],"habits":[],"wellbeing":[]}' } }] } },
    ]);
    const pending = plan();
    // Let the retry timer fire without actually waiting seconds in the test.
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a response the user is meant to read', async () => {
    vi.useFakeTimers();
    const fetchMock = respondWith([{ status: 400, body: { error: { message: 'The token limit is invalid.' } } }]);
    await expect(plan()).rejects.toThrow(/token limit/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after four attempts so a dead service cannot hang the UI', async () => {
    vi.useFakeTimers();
    const fetchMock = respondWith([{ status: 503, body: { error: { message: 'Service unavailable' } } }]);
    // Attach the expectation before running the timers: a rejection left
    // unattended across a timer advance is reported as an unhandled error.
    const pending = expect(plan()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('retries a dropped connection the same way', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('network down');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Back online.","tasks":[],"events":[],"habits":[],"wellbeing":[]}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = plan();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never waits past an abort', async () => {
    const controller = new AbortController();
    respondWith([{ status: 500, body: { error: { message: 'down' } } }]);
    const pending = generateAIPlan({
      prompt: 'Plan a calm day.',
      range: { startDate: '2026-09-27', days: 1 },
      state: createEmptyState(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe('when the AI cannot be reached', () => {
  afterEach(() => {
    // navigator.onLine is a getter in jsdom; put it back however we set it.
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  function goOffline() {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  }

  it('says you are offline rather than asking you to check a connection you know is gone', async () => {
    goOffline();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    const state = addTask(createEmptyState(), {
      title: 'Ship the project', priority: 'high', dueDate: '2026-09-27', dueTime: null,
      category: 'work', note: '', goalId: null,
    }, 'task-1', '2026-09-27T08:00:00.000Z');

    await expect(
      generateAIPlan({ prompt: 'plan my week', state, range: { startDate: '2026-09-27', days: 7 } }),
    ).rejects.toThrow(/offline/i);

    // The point of asking first: no request is spent discovering it.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reassures rather than only reporting a failure', async () => {
    goOffline();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));

    const state = createEmptyState();
    await expect(
      generateAIPlan({ prompt: 'plan my week', state, range: { startDate: '2026-09-27', days: 7 } }),
    ).rejects.toThrow(/saved on this device/);
  });

  it('keeps the ordinary failure message when there is a connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    // The retry backoff is real seconds long (0.8 + 2 + 4.5). Skip the waiting,
    // not the retries: this test is about the message that survives all of them.
    vi.useFakeTimers();
    try {
      const state = createEmptyState();
      const rejected = expect(
        generateAIPlan({ prompt: 'plan my week', state, range: { startDate: '2026-09-27', days: 7 } }),
      ).rejects.toThrow(/Could not reach the AI service/);
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
  it('reads the plan out of an answer that arrives wrapped in prose and a code fence', async () => {
    // A real model sometimes narrates around its JSON. Losing a finished plan
    // to a stray "Here you go:" is worse than any parsing cleverness.
    const content = [
      'Here you go:',
      '```json',
      '{"summary":"Two calm days.","tasks":[{"title":"Pack lunch","date":"2026-09-29","priority":"low","category":"health"},],"events":[],"habits":[],"wellbeing":[],}',
      '```',
      'Tell me if you want changes!',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    })));

    const result = await generateAIPlan({
      prompt: 'plan two calm days',
      range: { startDate: '2026-09-29', days: 2 },
      state: createEmptyState(),
    });

    expect(result.summary).toBe('Two calm days.');
    expect(result.tasks.map((task) => task.title)).toEqual(['Pack lunch']);
  });

  it('strips model decoration out of titles and drops repeated wellbeing ideas', async () => {
    mockGroq({
      summary: '  **Deep work, protected.**  Day one holds the hard thing; day two stays light. And a third sentence that should not survive. ',
      tasks: [{ title: '1. **Draft** the statistics summary: ', date: '2026-09-29', priority: 'high', category: 'work', reason: 'Draft the statistics summary' }],
      events: [],
      habits: [{ name: '🌙 Wind down', frequency: { type: 'daily' }, category: 'health', icon: 'moon' }],
      wellbeing: ['Take a short walk after lunch.', 'take a short walk after lunch.', 'Drink water through the morning.'],
    });

    const result = await generateAIPlan({
      prompt: 'plan two calm days',
      range: { startDate: '2026-09-29', days: 2 },
      state: createEmptyState(),
    });

    expect(result.summary).toBe('Deep work, protected. Day one holds the hard thing; day two stays light.');
    expect(result.tasks[0].title).toBe('Draft the statistics summary');
    expect(result.habits[0].name).toBe('Wind down');
    expect(result.suggestions).toEqual(['Take a short walk after lunch.', 'Drink water through the morning.']);
    // A reason that only says the title again is noise, so nothing is shown.
    expect(result.reasons?.['task:0']).toBeUndefined();
  });
});
