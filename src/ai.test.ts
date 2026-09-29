import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAIPlannerContext, generateAIPlan, generateAIReview, GROQ_CHAT_URL, GROQ_TEXT_MODEL, GROQ_VISION_MODEL } from './ai';
import { addAIMemory, addEvent, addFixedCommitment, addTask, logFocus, toggleTask } from './mutate';
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
