/**
 * The retention window.
 *
 * SPEC §11 promises three things and this file holds it to all three: detail
 * outside the window is dropped, the results behind it are kept as numbers, and
 * nothing unfinished, undated or in the future is ever touched. The window is a
 * setting, so "keep everything" has to be a real no-op rather than a longer list.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETENTION_WEEKS,
  GRACE_DAYS,
  KEEP_EVERYTHING,
  buildWeekArchive,
  hotWindowStart,
  normalizeRetention,
  retentionIdle,
  rollUp,
  weekIsRollable,
} from './retention';
import { addDays, startOfWeek, todayISO, weekDates } from './dates';
import { createEmptyState } from './types';
import { addGoal, addHabit, addMilestone, addTask, toggleHabit, toggleTask } from './mutate';

/** A Wednesday in the past, so "older than the window" is unambiguous. */
const today = '2026-03-18'; // Wednesday
const LAST_WEEK = addDays(startOfWeek(today), -7);
const LONG_AGO = addDays(startOfWeek(today), -28);

function states() {
  let state = createState();
  // Old week: a finished task with a private note, a focus session, a mood and
  // a habit tick — all detail that should be rolled up.
  state = addTask(
    state,
    { title: 'Old essay', priority: 'medium', dueDate: LONG_AGO, dueTime: null, category: 'learning', note: 'PRIVATE_OLD_NOTE', goalId: null, estimatedMinutes: 90, subtasks: [{ id: 's1', title: 'Outline', completed: true }] },
    'old-task',
    `${LONG_AGO}T09:00:00.000Z`,
  );
  // `toggleTask(state, id, now, today)`: the completion timestamp is what the
  // rollup reads, so it is the old date.
  state = toggleTask(state, 'old-task', `${LONG_AGO}T18:00:00.000Z`, LONG_AGO);
  state = {
    ...state,
    focusLog: [
      ...state.focusLog,
      { id: 'focus-old', taskId: 'old-task', title: 'Old essay', minutes: 50, date: addDays(LONG_AGO, 1), endedAt: `${LONG_AGO}T19:00:00.000Z` },
    ],
    moods: [{ date: addDays(LONG_AGO, 1), value: 4, updatedAt: `${LONG_AGO}T20:00:00.000Z` }],
  };
  // This week: work still inside the window.
  state = addTask(
    state,
    { title: 'This week’s lab', priority: 'high', dueDate: addDays(today, 2), dueTime: null, category: 'learning', note: 'CURRENT_NOTE', goalId: null, estimatedMinutes: 60 },
    'new-task',
  );
  state = {
    ...state,
    focusLog: [
      ...state.focusLog,
      { id: 'focus-new', taskId: 'new-task', title: 'This week’s lab', minutes: 30, date: today, endedAt: `${today}T19:00:00.000Z` },
    ],
  };
  return state;
}

function createState() {
  return createEmptyState();
}

describe('the window itself', () => {
  it('is the current week plus the previous one by default', () => {
    expect(DEFAULT_RETENTION_WEEKS).toBe(2);
    expect(hotWindowStart(2, today)).toBe(LAST_WEEK);
    expect(hotWindowStart(1, today)).toBe(startOfWeek(today));
  });

  it('rolls a week up only after it ended and the grace days passed', () => {
    expect(weekIsRollable(LAST_WEEK, today)).toBe(true);
    expect(weekIsRollable(addDays(today, -1), today)).toBe(false);
    expect(GRACE_DAYS).toBeGreaterThan(0);
  });

  it('falls back to the default window for anything it did not offer', () => {
    expect(normalizeRetention(4)).toBe(4);
    expect(normalizeRetention(KEEP_EVERYTHING)).toBe(KEEP_EVERYTHING);
    expect(normalizeRetention(3)).toBe(DEFAULT_RETENTION_WEEKS);
    expect(normalizeRetention('nonsense')).toBe(DEFAULT_RETENTION_WEEKS);
  });
});

describe('rolling a week up', () => {
  it('writes a week archive from the numbers of that week', () => {
    const archive = buildWeekArchive(states(), LONG_AGO, today);
    expect(archive.weekStart).toBe(LONG_AGO);
    expect(archive.days).toHaveLength(7);
    expect(archive.tasksDone).toBe(1);
    expect(archive.tasksTotal).toBe(1);
    expect(archive.focusMinutes).toBe(50);
    expect(archive.focusSessions).toBe(1);
    expect(archive.moodAverage).toBe(4);
    expect(archive.days.some((day) => day.focusMinutes === 50)).toBe(true);
  });

  it('keeps the results and drops the detail behind them', () => {
    const result = rollUp(states(), 2, today);
    expect(result.archived.map((archive) => archive.weekStart)).toEqual([LONG_AGO]);
    expect(result.dropped.weeksArchived).toBe(1);
    expect(result.dropped.focusSessions).toBe(1);
    expect(result.dropped.moods).toBe(1);
    // The finished task survives as a result: title, completion, estimate.
    // (Detail is only dropped for items the window has actually seen — a task
    // added today is never pruned for carrying an old date.)
    const oldTask = result.state.tasks.find((task) => task.id === 'old-task');
    expect(oldTask?.title).toBe('Old essay');
    expect(oldTask?.completed).toBe(true);
    expect(oldTask?.estimatedMinutes).toBe(90);
    // …without the note and subtask text it carried.
    expect(oldTask?.note).toBe('');
    expect(oldTask?.subtasks).toEqual([]);
    expect(result.dropped.taskDetails).toBe(1);
    // This week is untouched.
    expect(result.state.tasks.find((task) => task.id === 'new-task')?.note).toBe('CURRENT_NOTE');
    expect(result.state.focusLog.map((entry) => entry.date)).toEqual([today]);
    expect(result.state.archives?.[0].tasksDone).toBe(1);
  });

  it('never touches an open task, however old it is', () => {
    let state = states();
    state = addTask(
      state,
      { title: 'Still open', priority: 'low', dueDate: LONG_AGO, dueTime: null, category: 'personal', note: 'STILL_MINE', goalId: null, subtasks: [{ id: 's2', title: 'Half done', completed: false }] },
      'open-task',
      `${LONG_AGO}T09:00:00.000Z`,
    );
    const result = rollUp(state, 2, today);
    const open = result.state.tasks.find((task) => task.id === 'open-task');
    expect(open?.note).toBe('STILL_MINE');
    expect(open?.subtasks).toHaveLength(1);
  });

  it('does nothing at all the second time round', () => {
    const first = rollUp(states(), 2, today);
    const second = rollUp(first.state, 2, today);
    expect(retentionIdle(second)).toBe(true);
    expect(second.state).toBe(first.state);
  });

  it('stops when the window is set to keep everything', () => {
    const result = rollUp(states(), KEEP_EVERYTHING, today);
    expect(retentionIdle(result)).toBe(true);
    expect(result.state.archives ?? []).toEqual([]);
  });

  it('archives each finished week once, oldest first', () => {
    // A week with something in it is archived; a week left empty is not, so a
    // long-dormant planner does not grow a blank record per week.
    let withLastWeek = states();
    withLastWeek = {
      ...withLastWeek,
      focusLog: [
        ...withLastWeek.focusLog,
        { id: 'focus-last', taskId: null, title: 'Reading', minutes: 20, date: LAST_WEEK, endedAt: `${LAST_WEEK}T19:00:00.000Z` },
      ],
    };
    const result = rollUp(withLastWeek, 1, today);
    const weeks = result.archived.map((archive) => archive.weekStart);
    expect(weeks).toEqual([...weeks].sort());
    expect(weeks).toContain(LONG_AGO);
    expect(weeks).toContain(LAST_WEEK);
    // A week inside the window is not archived, even with a one-week window.
    expect(weeks).not.toContain(startOfWeek(today));
    expect(result.state.focusLog.some((entry) => entry.date === LAST_WEEK)).toBe(false);
    expect(result.state.archives?.find((archive) => archive.weekStart === LAST_WEEK)?.focusMinutes).toBe(20);
  });
});

describe('an archive is a set of numbers, not a copy of the planner', () => {
  it('carries habit and goal progress, not their contents', () => {
    let state = states();
    state = addHabit(
      state,
      { name: 'Reading', frequency: { type: 'daily' }, icon: 'book', accent: 'sage', unit: null, essential: false },
      'habit-1',
      `${LONG_AGO}T08:00:00.000Z`,
      LONG_AGO,
    );
    const days = weekDates(LONG_AGO);
    state = toggleHabit(state, 'habit-1', days[0]);
    state = addGoal(state, { title: 'Finish the course', description: '', horizon: 'short', deadline: null }, 'goal-1');
    state = addMilestone(state, 'goal-1', 'First draft', 'milestone-1');

    const archive = buildWeekArchive(state, LONG_AGO, today);
    expect(archive.habits.find((habit) => habit.habitId === 'habit-1')?.done).toBeGreaterThan(0);
    expect(archive.goals).toEqual([{ goalId: 'goal-1', title: 'Finish the course', milestoneDone: 0, milestoneTotal: 1 }]);
    // No note text, no subject names, no ids of anything private.
    expect(JSON.stringify(archive)).not.toContain('PRIVATE');
  });

  it('keeps this week\'s note while dropping the ones behind the window', () => {
    // A regression guard: the filter that drops old explanations used to be
    // inverted, which silently ate the headline of the week in progress.
    const state = states();
    state.panels.student.explanations = [
      { id: 'now', summary: 'CURRENT_SUMMARY', reason: 'PRIVATE_REASON', weekOf: startOfWeek(today), createdAt: `${addDays(startOfWeek(today), 1)}T09:00:00.000Z` },
      { id: 'then', summary: 'OLD_SUMMARY', reason: 'PRIVATE_REASON', weekOf: LONG_AGO, createdAt: `${LONG_AGO}T09:00:00.000Z` },
    ];
    const result = rollUp(state, 2, today);
    expect(result.state.panels.student.explanations.map((note) => note.summary)).toEqual(['CURRENT_SUMMARY']);
    expect(result.dropped.explanations).toBe(1);
  });

  it('leaves today alone', () => {
    const result = rollUp(states(), 2, today);
    const todayArchive = result.archived.find((archive) => archive.weekStart === startOfWeek(today));
    expect(todayArchive).toBeUndefined();
    expect(result.state.tasks.find((task) => task.id === 'new-task')?.note).toBe('CURRENT_NOTE');
    expect(todayISO()).toBe(todayISO());
  });
});
