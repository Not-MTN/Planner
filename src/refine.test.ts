import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeDraft, buildPlanningContext, draftForModel, refineAIPlan, type AIDraft, type PlanRange } from './ai';
import { addEvent, addFixedCommitment, addTask, saveAIPlan, setMood, updateAIPlan } from './mutate';
import { weekdayIndex } from './dates';
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

const RANGE: PlanRange = { startDate: '2026-09-28', days: 5 };

function makeDraft(): AIDraft {
  return {
    summary: 'A light week.',
    tasks: [{ title: 'Write the outline', dueDate: '2026-09-29', dueTime: null, priority: 'medium', category: 'work', note: '', goalId: null }],
    events: [{ title: 'Evening walk', date: '2026-09-28', startTime: '18:00', endTime: '18:30', category: 'health', note: '', important: false }],
    habits: [{ name: 'Stretch', icon: 'stretch', accent: 'sage', frequency: { type: 'daily' } }],
    suggestions: ['Drink water.'],
    skippedEvents: [],
  };
}

describe('refineAIPlan', () => {
  it('refuses to run without a change request', async () => {
    await expect(refineAIPlan({ draft: makeDraft(), request: '   ', range: RANGE, state: createEmptyState() }))
      .rejects.toThrow('Say what to change first.');
  });

  it('refuses impossible ranges', async () => {
    await expect(refineAIPlan({ draft: makeDraft(), request: 'lighten it', range: { startDate: '2026-09-28', days: 0 }, state: createEmptyState() }))
      .rejects.toThrow();
  });

  it('sends the full current draft and edit-in-place rules, and returns the revised plan', async () => {
    let state = addFixedCommitment(createEmptyState(), {
      title: 'Class', weekday: 2, startTime: '08:00', endTime: '10:00', category: 'learning', note: '',
    }, 'class', '2026-09-27T08:00:00.000Z');
    state = addTask(state, { title: 'Existing', priority: 'low', dueDate: '2026-09-29', dueTime: null, category: 'personal', note: '', goalId: null }, 't-1', '2026-09-27T08:00:00.000Z');
    const fetchMock = mockGroq({
      summary: 'Lighter Tuesday.',
      tasks: [],
      events: [],
      habits: [],
      wellbeing: [],
    });
    const result = await refineAIPlan({ draft: makeDraft(), request: 'Make Tuesday lighter', range: RANGE, state });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ role: string; content: string }> };
    const system = request.messages.find((message) => message.role === 'system')?.content ?? '';
    const user = request.messages.find((message) => message.role === 'user')?.content ?? '';
    // Editing rules reach the model.
    expect(system).toContain('EDITING an existing draft');
    expect(system).toContain('keep every item they did not ask to change');
    expect(system).toContain('FULL revised plan');
    // The whole current draft is on the table, plus the live schedule.
    expect(user).toContain('Make Tuesday lighter');
    expect(user).toContain('Evening walk');
    expect(user).toContain('Write the outline');
    expect(user).toContain('Existing');
    // The draft's own summary comes back through normalization.
    expect(result.summary).toBe('Lighter Tuesday.');
  });

  it('compact draft keeps tasks, events, habits and suggestions for the model', () => {
    const compact = draftForModel(makeDraft()) as { summary: string; tasks: unknown[]; events: unknown[]; habits: unknown[]; suggestions: string[] };
    expect(compact.summary).toBe('A light week.');
    expect(compact.tasks).toHaveLength(1);
    expect(compact.events).toHaveLength(1);
    expect(compact.habits).toHaveLength(1);
    expect(compact.suggestions).toEqual(['Drink water.']);
  });
});

describe('buildPlanningContext', () => {
  it('reports per-day busyness, overdue work and recent moods', () => {
    let state = createEmptyState();
    state = addFixedCommitment(state, { title: 'Class', weekday: 2, startTime: '08:00', endTime: '12:00', category: 'learning', note: '' }, 'class', '2026-09-27T08:00:00.000Z');
    state = addEvent(state, { title: 'Dinner', date: '2026-09-28', startTime: '19:00', endTime: '20:00', category: 'social', note: '', important: false }, 'dinner', '2026-09-27T08:00:00.000Z');
    state = addTask(state, { title: 'Late report', priority: 'high', dueDate: '2026-09-20', dueTime: null, category: 'work', note: '', goalId: null }, 'late-1', '2026-09-19T08:00:00.000Z');
    state = setMood(state, '2026-09-27', 2);
    const context = buildPlanningContext(state, RANGE) as {
      perDayBusy: Array<{ date: string; busyHours: number }>;
      overdueTasks: Array<{ title: string; date: string }>;
      recentMoods: Array<{ date: string; value: string }>;
    };
    const tuesday = context.perDayBusy.find((day) => weekdayIndex(day.date) === 2);
    const monday = context.perDayBusy.find((day) => day.date === '2026-09-28');
    expect(tuesday?.busyHours).toBe(4);
    expect(monday?.busyHours).toBe(1);
    expect(context.overdueTasks).toEqual([{ title: 'Late report', date: '2026-09-20', priority: 'high' }]);
    expect(context.recentMoods.at(-1)).toEqual({ date: '2026-09-27', value: 2 });
  });

  it('caps the overdue list so long backlogs stay light on tokens', () => {
    let state = createEmptyState();
    for (let index = 0; index < 20; index += 1) {
      state = addTask(state, { title: `Old task ${index}`, priority: 'low', dueDate: '2026-09-10', dueTime: null, category: 'personal', note: '', goalId: null }, `old-${index}`, '2026-09-09T08:00:00.000Z');
    }
    const context = buildPlanningContext(state, RANGE) as { overdueTasks: unknown[] };
    expect(context.overdueTasks).toHaveLength(15);
  });
});

describe('analyzeDraft', () => {
  it('flags a day that becomes packed once the draft is added', () => {
    const date = '2026-09-29';
    let state = addFixedCommitment(createEmptyState(), {
      title: 'Shift', weekday: weekdayIndex(date), startTime: '08:00', endTime: '16:00', category: 'work', note: '',
    }, 'shift', '2026-09-27T08:00:00.000Z');
    state = addEvent(state, { title: 'Gym', date, startTime: '17:00', endTime: '18:00', category: 'health', note: '', important: false }, 'gym', '2026-09-27T08:00:00.000Z');
    const draft = makeDraft();
    draft.events.push({ title: 'Late study', date, startTime: '19:00', endTime: '20:30', category: 'learning', note: '', important: false });
    const warnings = analyzeDraft(draft, state, RANGE);
    const packed = warnings.find((warning) => warning.kind === 'packed' && warning.date === date);
    expect(packed).toBeTruthy();
    expect(packed?.message).toContain('10.5');
  });

  it('flags events at unusual hours', () => {
    const draft = makeDraft();
    draft.events.push({ title: 'Sunrise run', date: '2026-09-30', startTime: '05:30', endTime: '06:15', category: 'health', note: '', important: false });
    draft.events.push({ title: 'Midnight movie', date: '2026-09-30', startTime: '22:00', endTime: '23:30', category: 'personal', note: '', important: false });
    const warnings = analyzeDraft(draft, state(), RANGE);
    expect(warnings.filter((warning) => warning.kind === 'off-hours')).toHaveLength(2);
    expect(warnings.some((warning) => warning.message.includes('Sunrise run'))).toBe(true);
    expect(warnings.some((warning) => warning.message.includes('Midnight movie'))).toBe(true);
  });

  it('notes untouched days in longer ranges, but not when life already fills them', () => {
    let state = createEmptyState();
    // Thursday (2026-10-01) already has a task — only Wednesday is empty.
    state = addTask(state, { title: 'Errand', priority: 'low', dueDate: '2026-10-01', dueTime: null, category: 'home', note: '', goalId: null }, 'errand', '2026-09-27T08:00:00.000Z');
    const warnings = analyzeDraft(makeDraft(), state, RANGE);
    expect(warnings.some((warning) => warning.kind === 'empty')).toBe(true);
  });

  it('stays silent for an easy draft and caps warnings at six', () => {
    // Short ranges never warn about untouched days, and this draft is gentle.
    expect(analyzeDraft(makeDraft(), state(), { startDate: '2026-09-28', days: 2 })).toEqual([]);
    const noisy = makeDraft();
    for (let index = 0; index < 10; index += 1) {
      noisy.events.push({ title: `Dawn ${index}`, date: '2026-09-30', startTime: `05:${String(index * 5).padStart(2, '0')}`, endTime: `05:${String(index * 5 + 4).padStart(2, '0')}`, category: 'personal', note: '', important: false });
    }
    expect(analyzeDraft(noisy, state(), RANGE).length).toBeLessThanOrEqual(6);
  });
});

function state() {
  return createEmptyState();
}

describe('updateAIPlan', () => {
  const now = '2026-09-28T10:00:00.000Z';
  const seed = saveAIPlan(createEmptyState(), {
    title: 'Test plan', prompt: 'plan it', summary: 'First draft.', startDate: '2026-09-28', days: 5, source: 'typed',
    tasks: [], events: [], habits: [], suggestions: [],
  }, 'plan-1', now);

  it('replaces only the patched fields and bumps updatedAt', () => {
    const next = updateAIPlan(seed.state, 'plan-1', {
      summary: 'Revised draft.',
      tasks: [{ title: 'New task', priority: 'medium', dueDate: '2026-09-29', dueTime: null, category: 'work', note: '', goalId: null }],
    }, '2026-09-28T11:00:00.000Z');
    const plan = next.aiPlans.find((item) => item.id === 'plan-1');
    expect(plan?.summary).toBe('Revised draft.');
    expect(plan?.tasks).toHaveLength(1);
    expect(plan?.status).toBe('draft');
    expect(plan?.createdAt).toBe(now);
    expect(plan?.updatedAt).toBe('2026-09-28T11:00:00.000Z');
    expect(plan?.title).toBe('Test plan');
  });

  it('clamps days and ignores unknown ids', () => {
    const clamped = updateAIPlan(seed.state, 'plan-1', { days: 500 }, now);
    expect(clamped.aiPlans.find((item) => item.id === 'plan-1')?.days).toBe(90);
    expect(updateAIPlan(seed.state, 'missing', { summary: 'nope' }, now)).toBe(seed.state);
  });
});
