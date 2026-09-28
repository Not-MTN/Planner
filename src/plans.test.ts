import { describe, expect, it } from 'vitest';
import { deleteAIPlan, markAIPlanAdded, saveAIPlan } from './mutate';
import { sanitizeState } from './storage';
import { mergeStates } from './sync';
import { createEmptyState, AI_PLAN_LIMIT, type SavedAIPlanInput } from './types';

function planInput(overrides: Partial<SavedAIPlanInput> = {}): SavedAIPlanInput {
  return {
    title: 'A calm week',
    prompt: 'Plan a calm week for me',
    summary: 'A gentle week with room to breathe.',
    startDate: '2026-09-28',
    days: 7,
    source: 'typed',
    tasks: [{ title: 'Water the plants', priority: 'low', dueDate: '2026-09-29', dueTime: null, category: 'home', note: '', goalId: null }],
    events: [{ title: 'Evening walk', date: '2026-09-30', startTime: '18:00', endTime: '18:30', category: 'health', note: '', important: false }],
    habits: [{ name: 'Stretch gently', icon: 'stretch', accent: 'sage', frequency: { type: 'daily' } }],
    suggestions: ['Drink water with each meal.'],
    ...overrides,
  };
}

describe('saved AI plans', () => {
  it('saves a draft newest-first with status "draft"', () => {
    let state = createEmptyState();
    const first = saveAIPlan(state, planInput({ title: 'First' }), 'p1', '2026-09-28T08:00:00.000Z');
    state = first.state;
    const second = saveAIPlan(state, planInput({ title: 'Second', source: 'voice', prompt: '' }), 'p2', '2026-09-28T09:00:00.000Z');
    state = second.state;
    expect(state.aiPlans.map((plan) => plan.id)).toEqual(['p2', 'p1']);
    expect(second.plan.status).toBe('draft');
    expect(second.plan.source).toBe('voice');
    expect(second.plan.createdAt).toBe('2026-09-28T09:00:00.000Z');
  });

  it('keeps at most AI_PLAN_LIMIT plans', () => {
    let state = createEmptyState();
    for (let i = 0; i < AI_PLAN_LIMIT + 5; i += 1) {
      state = saveAIPlan(state, planInput({ title: `Plan ${i}` }), `p${i}`, `2026-09-28T${String(i).padStart(2, '0')}:00:00.000Z`).state;
    }
    expect(state.aiPlans).toHaveLength(AI_PLAN_LIMIT);
    expect(state.aiPlans[0].id).toBe(`p${AI_PLAN_LIMIT + 4}`);
  });

  it('marks a plan as added and deletes plans', () => {
    let state = saveAIPlan(createEmptyState(), planInput(), 'p1', 'now').state;
    state = markAIPlanAdded(state, 'p1', 'later');
    expect(state.aiPlans[0].status).toBe('added');
    expect(state.aiPlans[0].updatedAt).toBe('later');
    state = deleteAIPlan(state, 'p1');
    expect(state.aiPlans).toHaveLength(0);
    // Deleting a missing plan is a no-op (same object back).
    expect(deleteAIPlan(state, 'nope')).toBe(state);
  });

  it('clamps out-of-range fields when saving', () => {
    const state = saveAIPlan(createEmptyState(), planInput({ days: 500, startDate: 'not-a-date' }), 'p1', 'now').state;
    expect(state.aiPlans[0].days).toBe(90);
    expect(state.aiPlans[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sanitizes saved plans loaded from storage', () => {
    const good = { ...planInput(), id: 'good', createdAt: '2026-09-28T08:00:00.000Z', updatedAt: '2026-09-28T08:00:00.000Z', status: 'draft' };
    const broken = { id: 'broken', startDate: 'nope', days: 7 };
    const oversized = {
      ...planInput(),
      id: 'big',
      createdAt: '2026-09-28T09:00:00.000Z',
      updatedAt: '2026-09-28T09:00:00.000Z',
      days: 999,
      tasks: Array.from({ length: 60 }, (_, i) => ({ title: `Task ${i}`, priority: 'medium', dueDate: '2026-09-28', dueTime: null, category: 'work', note: '', goalId: null })),
    };
    const state = sanitizeState({ aiPlans: [good, broken, oversized] });
    expect(state).not.toBeNull();
    expect(state!.aiPlans.map((plan) => plan.id)).toEqual(['good', 'big']);
    expect(state!.aiPlans[1].days).toBe(90);
    expect(state!.aiPlans[1].tasks).toHaveLength(40);
  });

  it('merges saved plans across synced devices, newest update wins', () => {
    const base = createEmptyState();
    const local = saveAIPlan(base, planInput({ summary: 'Local edit' }), 'p1', '2026-09-28T08:00:00.000Z').state;
    const localEdited = markAIPlanAdded(local, 'p1', '2026-09-28T10:00:00.000Z');
    const remote = saveAIPlan(base, planInput({ summary: 'Remote edit' }), 'p1', '2026-09-28T08:00:00.000Z').state;
    const merged = mergeStates(localEdited, remote);
    expect(merged.aiPlans).toHaveLength(1);
    expect(merged.aiPlans[0].summary).toBe('Local edit');
    expect(merged.aiPlans[0].status).toBe('added');
  });

  it('round-trips saved plans through serialize/sanitize (backups and sync)', () => {
    const state = saveAIPlan(createEmptyState(), planInput(), 'p1', '2026-09-28T08:00:00.000Z').state;
    const restored = sanitizeState(JSON.parse(JSON.stringify(state)));
    expect(restored!.aiPlans[0]).toMatchObject({ id: 'p1', title: 'A calm week', days: 7, status: 'draft' });
    expect(restored!.aiPlans[0].tasks[0].title).toBe('Water the plants');
  });
});
