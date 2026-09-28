import { describe, expect, it } from 'vitest';
import { setMood } from './mutate';
import { sanitizeState } from './storage';
import { mergeStates } from './sync';
import { createEmptyState } from './types';

describe('moods', () => {
  it('records, replaces and clears one mood per day', () => {
    let state = createEmptyState();
    state = setMood(state, '2026-09-27', 3, undefined, '2026-09-27T18:00:00Z');
    expect(state.moods).toHaveLength(1);
    expect(state.moods[0]).toMatchObject({ date: '2026-09-27', value: 3 });
    // Second check-in on the same day replaces the first.
    state = setMood(state, '2026-09-27', 5, 'task-1', '2026-09-27T21:00:00Z');
    expect(state.moods).toHaveLength(1);
    expect(state.moods[0]).toMatchObject({ value: 5, taskId: 'task-1', updatedAt: '2026-09-27T21:00:00Z' });
    // Other days are untouched; tapping the same mood again clears it.
    state = setMood(state, '2026-09-28', 1, undefined, '2026-09-28T20:00:00Z');
    expect(state.moods).toHaveLength(2);
    state = setMood(state, '2026-09-27', null);
    expect(state.moods.map((entry) => entry.date)).toEqual(['2026-09-28']);
  });

  it('survives backup sanitize and ignores junk', () => {
    let state = createEmptyState();
    state = setMood(state, '2026-09-27', 4, undefined, '2026-09-27T19:00:00Z');
    const junk = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    junk.moods = [...(junk.moods as unknown[]), { date: '2026-13-40', value: 9 }, 'nope', { date: '2026-09-27', value: 2 }];
    const clean = sanitizeState(junk);
    expect(clean?.moods).toHaveLength(1);
    expect(clean?.moods[0]).toMatchObject({ date: '2026-09-27', value: 4 });
  });

  it('sync merge keeps the newest check-in per day from both devices', () => {
    let local = createEmptyState();
    let remote = createEmptyState();
    local = setMood(local, '2026-09-27', 2, undefined, '2026-09-27T10:00:00Z');
    local = setMood(local, '2026-09-26', 4, undefined, '2026-09-26T10:00:00Z');
    remote = setMood(remote, '2026-09-27', 5, undefined, '2026-09-27T22:00:00Z');
    const merged = mergeStates(local, remote);
    expect(merged.moods.find((entry) => entry.date === '2026-09-27')?.value).toBe(5);
    expect(merged.moods.find((entry) => entry.date === '2026-09-26')?.value).toBe(4);
  });
});
