// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSnoozes, dueReminders, loadSnoozes, snoozeReminder, upcomingReminders, DEFAULT_REMINDERS, type ReminderSettings } from './reminders';
import { addHabit, addTask, toggleHabit } from './mutate';
import { createEmptyState, type PlannerState } from './types';

/**
 * Snoozing looks like suppression but is not: a reminder is only offered inside
 * a fifteen-minute window around its own time, so hiding it until later would
 * mean it never came back at all. It has to be *rescheduled*.
 */

const SETTINGS: ReminderSettings = { ...DEFAULT_REMINDERS, enabled: true, digest: false, lead: 10 };

function withEvent(state: PlannerState, at: Date): PlannerState {
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  return {
    ...state,
    events: [
      {
        ...state.events[0],
        id: 'event-1',
        title: 'Dentist',
        date,
        startTime: '10:00',
        endTime: null,
        category: 'personal',
        note: '',
        important: false,
        completed: false,
        sortOrder: 0,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
        repeat: null,
      },
    ],
  };
}

function withTask(state: PlannerState, date: string): PlannerState {
  return addTask(state, {
    title: 'Send report',
    priority: 'medium',
    dueDate: date,
    dueTime: '11:00',
    category: 'work',
    note: '',
    goalId: null,
  }, 'task-1', NOW.toISOString());
}

/** 2026-09-30 09:50 local — ten minutes before a 10:00 event. */
const NOW = new Date(2026, 8, 30, 9, 50, 0);
const KEY = '2026-09-30|event|event-1|10:00';

beforeEach(() => {
  localStorage.clear();
});

describe('reminders fire once', () => {
  it('fires inside its window and not again', () => {
    const state = withEvent(createEmptyState(), NOW);
    const fired = new Set<string>();
    expect(dueReminders(state, NOW, SETTINGS, fired).map((item) => item.key)).toEqual([KEY]);
    // The caller records the key; the same minute must not fire twice.
    fired.add(KEY);
    expect(dueReminders(state, NOW, SETTINGS, fired)).toEqual([]);
  });
});

describe('native background reminder schedule', () => {
  it('schedules warm, task-specific reminders at local event and task times', () => {
    const now = new Date(2026, 8, 30, 9, 0, 0);
    const date = '2026-09-30';
    const state = withTask(withEvent(createEmptyState(), now), date);
    const scheduled = upcomingReminders(state, now, SETTINGS);

    expect(scheduled.map((reminder) => reminder.key)).toEqual([
      '2026-09-30|event|event-1|10:00',
      '2026-09-30|task|task-1|11:00',
    ]);
    expect(scheduled[0]?.at).toEqual(new Date(2026, 8, 30, 9, 50, 0));
    expect(scheduled[0]?.title).toBe('Coming up: Dentist');
    expect(scheduled[0]?.body).toContain('get settled');
    expect(scheduled[1]?.at).toEqual(new Date(2026, 8, 30, 10, 50, 0));
    expect(scheduled[1]?.title).toBe('A gentle nudge');
    expect(scheduled[1]?.body).toContain('Send report');
    expect(scheduled[1]?.body).toContain('One step at a time');
  });

  it('adds a warm day digest and skips reminders that are already in the past', () => {
    const now = new Date(2026, 8, 30, 9, 10, 0);
    const settings = { ...SETTINGS, digest: true, digestTime: '09:05' };
    const state = withTask(withEvent(createEmptyState(), now), '2026-09-30');
    const scheduled = upcomingReminders(state, now, settings);

    expect(scheduled.map((reminder) => reminder.key)).toEqual([
      '2026-09-30|event|event-1|10:00',
      '2026-09-30|task|task-1|11:00',
    ]);
    expect(scheduled.some((reminder) => reminder.key.endsWith('|digest'))).toBe(false);
    const beforeDigest = upcomingReminders(state, new Date(2026, 8, 30, 9, 0, 0), settings);
    const digest = beforeDigest.find((reminder) => reminder.key.endsWith('|digest'));
    expect(digest?.body).toContain('1 event and 1 open task ahead');
  });

  it('schedules habit nudges only on due, unfinished days', () => {
    const now = new Date(2026, 8, 30, 8, 0, 0);
    let state = addHabit(createEmptyState(), {
      name: 'Stay hydrated',
      icon: 'water',
      accent: 'sage',
      frequency: { type: 'daily' },
      reminderTime: '09:00',
    }, 'water', now.toISOString(), '2026-09-30');

    const reminder = upcomingReminders(state, now, SETTINGS, 1)[0];
    expect(reminder).toMatchObject({
      key: '2026-09-30|habit|water|09:00',
      title: 'Time for Stay hydrated',
      at: new Date(2026, 8, 30, 9, 0, 0),
    });
    expect(reminder?.body).toContain('small step');

    state = toggleHabit(state, 'water', '2026-09-30');
    expect(upcomingReminders(state, now, SETTINGS, 1)).toEqual([]);
  });

  it('fires a habit reminder in-app at its selected time', () => {
    const at = new Date(2026, 8, 30, 9, 0, 0);
    const state = addHabit(createEmptyState(), {
      name: 'Stay hydrated', icon: 'water', accent: 'sage', frequency: { type: 'daily' }, reminderTime: '09:00',
    }, 'water', at.toISOString(), '2026-09-30');
    expect(dueReminders(state, at, SETTINGS, new Set()).map((item) => item.key)).toEqual([
      '2026-09-30|habit|water|09:00',
    ]);
  });

  it('does nothing when reminders are disabled', () => {
    const state = withEvent(createEmptyState(), NOW);
    expect(upcomingReminders(state, new Date(2026, 8, 30, 9, 0), DEFAULT_REMINDERS)).toEqual([]);
  });
});

describe('snoozing a reminder', () => {
  it('brings it back at the new time, not at the old one', () => {
    const state = withEvent(createEmptyState(), NOW);
    const fired = new Set([KEY]);
    snoozeReminder(KEY, 30, NOW.getTime());
    // Five minutes later it is still quiet: the snooze has not expired.
    expect(dueReminders(state, new Date(2026, 8, 30, 9, 55, 0), SETTINGS, fired, loadSnoozes(NOW.getTime()))).toEqual([]);
    // At 10:20 — thirty minutes after the snooze — it is due again.
    const later = new Date(2026, 8, 30, 10, 20, 0);
    expect(dueReminders(state, later, SETTINGS, fired, loadSnoozes(later.getTime())).map((item) => item.key)).toEqual([KEY]);
  });

  it('is forgotten once the reminder has come back, so it cannot repeat', () => {
    const state = withEvent(createEmptyState(), NOW);
    snoozeReminder(KEY, 10, NOW.getTime());
    const later = new Date(2026, 8, 30, 10, 0, 0);
    const snoozes = loadSnoozes(later.getTime());
    expect(dueReminders(state, later, SETTINGS, new Set([KEY]), snoozes)).toHaveLength(1);
    clearSnoozes([KEY]);
    expect(loadSnoozes(later.getTime()).size).toBe(0);
    // Without the snooze and with the key already fired, it stays quiet.
    expect(dueReminders(state, later, SETTINGS, new Set([KEY]))).toEqual([]);
  });

  it('replaces an earlier snooze rather than stacking them', () => {
    snoozeReminder(KEY, 10, NOW.getTime());
    snoozeReminder(KEY, 60, NOW.getTime());
    const snoozes = loadSnoozes(NOW.getTime());
    expect(snoozes.size).toBe(1);
    expect(snoozes.get(KEY)).toBe(NOW.getTime() + 60 * 60_000);
  });

  it('survives a reload, because a closed tab must not lose the delay', () => {
    snoozeReminder(KEY, 30, NOW.getTime());
    expect(loadSnoozes(NOW.getTime()).get(KEY)).toBe(NOW.getTime() + 30 * 60_000);
  });

  it('drops snoozes whose time has passed, so the map cannot grow forever', () => {
    snoozeReminder(KEY, 10, NOW.getTime());
    // It stays pending through its grace window, so it still gets to fire.
    expect(loadSnoozes(NOW.getTime() + 10 * 60_000).size).toBe(1);
    // Long after the snooze should have fired, nothing is pending.
    expect(loadSnoozes(NOW.getTime() + 24 * 60 * 60_000).size).toBe(0);
  });

  it('ignores a snooze for a reminder it does not know', () => {
    const state = withEvent(createEmptyState(), NOW);
    snoozeReminder('some-other-key', 10, NOW.getTime());
    expect(dueReminders(state, NOW, SETTINGS, new Set(), loadSnoozes(NOW.getTime())).map((item) => item.key)).toEqual([KEY]);
  });

  it('leaves reminders alone when nothing is snoozed', () => {
    const state = withEvent(createEmptyState(), NOW);
    expect(dueReminders(state, NOW, SETTINGS, new Set())).toHaveLength(1);
  });

  it('survives a corrupt snooze store', () => {
    localStorage.setItem('planner-reminders-snoozed', 'not json');
    expect(loadSnoozes().size).toBe(0);
    localStorage.setItem('planner-reminders-snoozed', JSON.stringify({ [KEY]: 'whenever' }));
    expect(loadSnoozes().size).toBe(0);
  });
});
