// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSnoozes, dueReminders, loadSnoozes, snoozeReminder, DEFAULT_REMINDERS, type ReminderSettings } from './reminders';
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
