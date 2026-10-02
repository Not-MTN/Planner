import { describe, expect, it } from 'vitest';
import { createEmptyState, type Habit } from '../types';
import { getGlanceStats } from './StatsWidget';

function makeHabit(id: string, createdOn: string, archived = false): Habit {
  return {
    id,
    name: id,
    icon: 'leaf',
    accent: 'sage',
    frequency: { type: 'daily' },
    essential: false,
    archived,
    createdOn,
    createdAt: `${createdOn}T08:00:00.000Z`,
    updatedAt: `${createdOn}T08:00:00.000Z`,
    unit: null,
  };
}

describe('Today glance metrics', () => {
  it('reports the longest real streak among active habits, not the number of habits', () => {
    const state = createEmptyState();
    state.habits = [
      makeHabit('active', '2026-09-30'),
      makeHabit('archived', '2026-09-28', true),
    ];
    state.completions = [
      { habitId: 'active', date: '2026-09-30' },
      { habitId: 'active', date: '2026-10-01' },
      { habitId: 'active', date: '2026-10-02' },
      ...['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((date) => ({ habitId: 'archived', date })),
    ];

    const stats = getGlanceStats(state, '2026-10-02');
    expect(stats.activeHabits).toBe(1);
    expect(stats.longestHabitStreak).toBe(3);
  });

  it('returns zero when no active habit has a current streak', () => {
    const state = createEmptyState();
    state.habits = [makeHabit('missed', '2026-09-30')];
    state.completions = [{ habitId: 'missed', date: '2026-09-30' }];

    expect(getGlanceStats(state, '2026-10-02').longestHabitStreak).toBe(0);
  });
});
