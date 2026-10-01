import { describe, expect, it } from 'vitest';
import { createEmptyState, type PlannerState, type Task } from './types';
import { addTask, toggleTask } from './mutate';
import { seriesTasksForDate, tasksForDate } from './logic';

/**
 * A repeating task is stored once and only spawns its next copy when that copy
 * is completed. That made the recurrence invisible to the calendar: a daily
 * task you do every single day showed up on exactly one day of the week.
 *
 * These tests pin the projection that fixes it — and, just as importantly, what
 * it must *not* touch: nothing here may be persisted, countable, or tickable.
 */

const T0 = '2026-09-27T08:00:00.000Z';
const MONDAY = '2026-09-28';
const TUESDAY = '2026-09-29';
const WEDNESDAY = '2026-09-30';
const SUNDAY = '2026-10-04';
const NEXT_MONDAY = '2026-10-05';

function withTask(state: PlannerState, task: Partial<Task>, id = 'task-1'): PlannerState {
  return addTask(
    state,
    {
      title: task.title ?? 'Water the plants',
      priority: task.priority ?? 'medium',
      dueDate: 'dueDate' in task ? task.dueDate ?? null : MONDAY,
      dueTime: task.dueTime ?? null,
      category: task.category ?? 'home',
      note: task.note ?? '',
      goalId: null,
    },
    id,
    T0,
  );
}

function repeating(state: PlannerState, repeat: Task['repeat'], dueDate: string | null = MONDAY): PlannerState {
  const base = withTask(state, { dueDate });
  return { ...base, tasks: base.tasks.map((task) => (task.id === 'task-1' ? { ...task, repeat } : task)) };
}

describe('repeating tasks appear on the days ahead', () => {
  it('projects a daily task onto every day after the one it is due', () => {
    const state = repeating(createEmptyState(), 'daily');
    for (const date of [TUESDAY, WEDNESDAY, SUNDAY, NEXT_MONDAY]) {
      const tasks = seriesTasksForDate(state, date);
      expect(tasks, date).toHaveLength(1);
      expect(tasks[0].title).toBe('Water the plants');
      expect(tasks[0].dueDate).toBe(date);
    }
  });

  it('never projects onto the day the real copy is due', () => {
    // Otherwise the day you can act on would show the same task twice.
    const state = repeating(createEmptyState(), 'daily');
    expect(seriesTasksForDate(state, MONDAY)).toEqual([]);
  });

  it('never projects into the past', () => {
    const state = repeating(createEmptyState(), 'daily');
    expect(seriesTasksForDate(state, '2026-09-27')).toEqual([]);
    expect(seriesTasksForDate(state, '2026-09-01')).toEqual([]);
  });

  it('follows the repeat rule rather than assuming every day', () => {
    const weekly = repeating(createEmptyState(), 'weekly');
    expect(seriesTasksForDate(weekly, TUESDAY)).toEqual([]);
    expect(seriesTasksForDate(weekly, NEXT_MONDAY)).toHaveLength(1);

    const weekdays = repeating(createEmptyState(), 'weekdays');
    expect(seriesTasksForDate(weekdays, TUESDAY)).toHaveLength(1);
    // Saturday and Sunday are not weekdays.
    expect(seriesTasksForDate(weekdays, '2026-10-03')).toEqual([]);

    const monthly = repeating(createEmptyState(), 'monthly');
    expect(seriesTasksForDate(monthly, TUESDAY)).toEqual([]);
    expect(seriesTasksForDate(monthly, '2026-10-28')).toHaveLength(1);
  });

  it('stops projecting from the copy that was completed, so the series cannot double up', () => {
    const state = repeating(createEmptyState(), 'daily');
    const done = toggleTask(state, 'task-1', '2026-09-28T09:00:00.000Z', MONDAY);
    // The finished copy keeps its repeat rule, but it has handed the series on:
    // if it kept projecting, every future day would show the task twice.
    const projected = seriesTasksForDate(done, WEDNESDAY);
    expect(projected.map((task) => task.seriesTaskId)).not.toContain('task-1');
    // Tuesday holds the real, tickable copy, not a projection.
    const tuesday = tasksForDate(done, TUESDAY);
    expect(tuesday).toHaveLength(1);
    expect(tuesday[0].seriesTaskId).toBeUndefined();
    expect(tuesday[0].completed).toBe(false);
  });

  it('keeps projecting from the copy the series moves to', () => {
    const state = repeating(createEmptyState(), 'daily');
    const done = toggleTask(state, 'task-1', '2026-09-28T09:00:00.000Z', MONDAY);
    const spawned = done.tasks.find((task) => task.id !== 'task-1');
    expect(spawned?.dueDate).toBe(TUESDAY);
    // The spawned copy carries the rule, so Thursday onwards is still covered.
    expect(seriesTasksForDate(done, WEDNESDAY).map((task) => task.seriesTaskId)).toEqual([spawned?.id]);
  });

  it('leaves a task that does not repeat alone', () => {
    const state = withTask(createEmptyState(), {});
    expect(seriesTasksForDate(state, TUESDAY)).toEqual([]);
  });

  it('ignores a task with no due date — there is no series to project from', () => {
    const state = repeating(createEmptyState(), 'daily', null);
    expect(state.tasks[0].dueDate).toBeNull();
    expect(seriesTasksForDate(state, TUESDAY)).toEqual([]);
  });
});

describe('projections are read-only', () => {
  it('carries no state of its own, so ticking one cannot invent a task', () => {
    const state = repeating(createEmptyState(), 'daily');
    const [projected] = seriesTasksForDate(state, WEDNESDAY);
    expect(projected.completed).toBe(false);
    expect(projected.completedAt).toBeNull();
    expect(projected.spawnedId).toBeNull();
    // Subtasks belong to the real copy; a projection has nowhere to keep them.
    expect(projected.subtasks).toEqual([]);
  });

  it('names the task it came from, and is never stored', () => {
    const state = repeating(createEmptyState(), 'daily');
    const [projected] = seriesTasksForDate(state, WEDNESDAY);
    expect(projected.seriesTaskId).toBe('task-1');
    expect(projected.id).toBe('series:task-1:2026-09-30');
    expect(state.tasks.some((task) => task.id.startsWith('series:'))).toBe(false);
    // Toggling a projected id is a no-op, not a crash or a duplicate.
    expect(toggleTask(state, projected.id, '2026-09-28T10:00:00.000Z', MONDAY)).toBe(state);
  });

  it('is stable across calls, so React keys and the DOM do not churn', () => {
    const state = repeating(createEmptyState(), 'daily');
    const first = seriesTasksForDate(state, WEDNESDAY)[0].id;
    expect(seriesTasksForDate(state, WEDNESDAY)[0].id).toBe(first);
  });
});

describe('tasksForDate', () => {
  it('leaves reminders, push and auto-scheduling counting real items only', () => {
    const state = repeating(createEmptyState(), 'daily');
    // Default: one task, on the day it is due.
    expect(tasksForDate(state, MONDAY)).toHaveLength(1);
    expect(tasksForDate(state, WEDNESDAY)).toHaveLength(0);
    // Opt in, and the day ahead gains the occurrence.
    expect(tasksForDate(state, WEDNESDAY, true)).toHaveLength(1);
  });

  it('puts the real copy and the projections in one list, each exactly once', () => {
    let state = repeating(createEmptyState(), 'daily');
    state = withTask(state, { title: 'Anything else', dueDate: WEDNESDAY }, 'task-2');
    const tasks = tasksForDate(state, WEDNESDAY, true);
    expect(tasks.map((task) => task.title).sort()).toEqual(['Anything else', 'Water the plants']);
    // The stored task stays stored; the occurrence stays a projection.
    expect(tasks.find((task) => task.title === 'Anything else')?.seriesTaskId).toBeUndefined();
    expect(tasks.find((task) => task.title === 'Water the plants')?.seriesTaskId).toBe('task-1');
  });
});
