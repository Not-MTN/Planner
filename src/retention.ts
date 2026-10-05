/**
 * The retention window: detail is temporary, results are permanent.
 *
 * SPEC §11 says the hot window is "the current week plus the previous week",
 * configurable to 1 / 2 / 4 / 12 weeks or "keep everything" — and that what
 * falls out of it is *rolled up* rather than deleted. Until now neither half was
 * true in the app: nothing expired, and the window was marketing copy.
 *
 * This module is the whole rule, in one place:
 *
 * - **Inside the window** everything is kept at full fidelity — tasks, notes,
 *   reasons, AI drafts, individual focus sessions.
 * - **Outside it**, a `WeekArchive` per week is written once (deterministic and
 *   idempotent, so two devices computing the same week agree), and the detail
 *   behind those numbers is dropped: the reason written for a change, individual
 *   focus sessions, raw mood entries, habit tick marks, the bodies of old AI
 *   drafts, and the note/subtask text of work finished long ago.
 * - **Never touched:** anything unfinished, undated or in the future — an open
 *   task from three months ago is still an open task, and losing it would be
 *   losing work rather than forgetting noise.
 *
 * A week is only rolled up once it ended at least `GRACE_DAYS` ago, so a
 * Sunday-night check-in still counts while it is still Sunday somewhere.
 */
import { addDays, startOfWeek, timeToMinutes, todayISO } from './dates';
import { dayScore, habitStats, isDone } from './logic';
import { weekDates } from './dates';
import type { PlannerState, WeekArchive } from './types';

export const RETENTION_KEY = 'planner-retention-weeks';
/** 1 / 2 / 4 / 12 weeks, or 0 for "keep everything". */
export const RETENTION_CHOICES = [1, 2, 4, 12] as const;
export const KEEP_EVERYTHING = 0;
export const DEFAULT_RETENTION_WEEKS = 2;
/** A week is not rolled up until this many days after it ends. */
export const GRACE_DAYS = 2;
/** A guard against an absurd loop if a date is wrong somewhere. */
const MAX_WEEKS_PER_RUN = 300;

/** Anything that is not one of the choices means "the default window". */
export function normalizeRetention(value: unknown): number {
  const weeks = typeof value === 'number' ? Math.round(value) : Number(value);
  if (!Number.isFinite(weeks)) return DEFAULT_RETENTION_WEEKS;
  if (weeks === KEEP_EVERYTHING) return KEEP_EVERYTHING;
  return (RETENTION_CHOICES as readonly number[]).includes(weeks) ? weeks : DEFAULT_RETENTION_WEEKS;
}

export function loadRetentionWeeks(): number {
  try {
    const raw = localStorage.getItem(RETENTION_KEY);
    return raw === null ? DEFAULT_RETENTION_WEEKS : normalizeRetention(raw);
  } catch {
    return DEFAULT_RETENTION_WEEKS;
  }
}

export function saveRetentionWeeks(weeks: number): void {
  try {
    localStorage.setItem(RETENTION_KEY, String(normalizeRetention(weeks)));
  } catch {
    /* ignore */
  }
}

/** First day of the oldest week still kept at full fidelity. */
export function hotWindowStart(weeks: number, today = todayISO()): string {
  return addDays(startOfWeek(today), -7 * (Math.max(1, weeks) - 1));
}

/** True once a week has ended and the grace days have passed. */
export function weekIsRollable(week: string, today = todayISO()): boolean {
  return addDays(week, 6 + GRACE_DAYS) <= today;
}

/** Every date the state visibly holds something on, for finding the oldest week. */
function oldestDate(state: PlannerState): string | null {
  const dates: string[] = [];
  for (const task of state.tasks) if (task.dueDate) dates.push(task.dueDate);
  for (const task of state.tasks) if (task.completedAt) dates.push(task.completedAt.slice(0, 10));
  for (const event of state.events) dates.push(event.date);
  for (const entry of state.focusLog) dates.push(entry.date);
  for (const entry of state.moods) dates.push(entry.date);
  for (const entry of state.completions) dates.push(entry.date);
  for (const plan of state.aiPlans) dates.push(plan.startDate);
  for (const note of state.panels.student.explanations) dates.push(note.weekOf);
  for (const link of state.panels.guardian.links) {
    for (const week of link.history) dates.push(week.weekOf);
    if (link.results) dates.push(link.results.weekOf);
  }
  const valid = dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  return valid[0] ?? null;
}

/** Whether anything at all happened in a week — the test for archiving it. */
export function weekHasData(state: PlannerState, week: string): boolean {
  const days = new Set(weekDates(week));
  const inWeek = (iso: string | null | undefined): boolean => !!iso && days.has(iso);
  return (
    state.tasks.some((task) => inWeek(task.dueDate) || inWeek(task.completedAt?.slice(0, 10))) ||
    state.events.some((event) => inWeek(event.date)) ||
    state.focusLog.some((entry) => inWeek(entry.date)) ||
    state.moods.some((entry) => inWeek(entry.date)) ||
    state.completions.some((entry) => inWeek(entry.date)) ||
    state.aiPlans.some((plan) => inWeek(plan.startDate)) ||
    state.panels.student.explanations.some((note) => inWeek(note.weekOf)) ||
    state.panels.guardian.links.some((link) => link.history.some((week_) => week_.weekOf === week) || link.results?.weekOf === week) ||
    false
  );
}

/** Minutes an event is planned for, or 0 when it has no usable times. */
function eventMinutes(start: string, end: string | null): number {
  if (!end) return 0;
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

/**
 * One week, as numbers. Deliberately free of ids other than habit and goal ids —
 * an archive that could be joined back to a note would not be an archive.
 */
export function buildWeekArchive(state: PlannerState, week: string, today = todayISO()): WeekArchive {
  const days = weekDates(week);
  let tasksDone = 0;
  let tasksTotal = 0;
  let eventsDone = 0;
  let eventsTotal = 0;
  let focusMinutes = 0;
  let focusSessions = 0;
  const moods: number[] = [];

  const archivedDays = days.map((date) => {
    const score = dayScore(state, date);
    tasksDone += score.tasksDone;
    tasksTotal += score.tasksTotal;
    eventsDone += score.eventsDone;
    eventsTotal += score.eventsTotal;
    const plannedMinutes =
      state.tasks.filter((task) => task.dueDate === date).reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0) +
      state.events.filter((event) => event.date === date).reduce((sum, event) => sum + eventMinutes(event.startTime, event.endTime), 0);
    const dayFocus = state.focusLog.filter((entry) => entry.date === date);
    const focus = dayFocus.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0);
    focusMinutes += focus;
    focusSessions += dayFocus.length;
    const mood = state.moods.find((entry) => entry.date === date);
    if (mood) moods.push(mood.value);
    return { date, ratio: score.ratio, mood: mood?.value ?? null, plannedMinutes, focusMinutes: focus };
  });

  const habits = state.habits
    .map((habit) => {
      const stats = habitStats(state, habit, days, today);
      // The streak that was running when the week ended, counted from its last
      // planned day backwards — an archive should say how a habit was going,
      // not only how many ticks it got.
      let streakEnd = 0;
      const planned = days.filter((date) => date >= habit.createdOn && date <= today);
      for (let index = planned.length - 1; index >= 0; index -= 1) {
        if (isDone(state, habit.id, planned[index])) streakEnd += 1;
        else break;
      }
      return { habitId: habit.id, name: habit.name, done: stats.done, target: stats.expected, streakEnd };
    })
    .filter((habit) => habit.target > 0 || habit.done > 0);

  const goals = state.goals
    .filter((goal) => goal.milestones.length > 0)
    .map((goal) => ({
      goalId: goal.id,
      title: goal.title,
      milestoneDone: goal.milestones.filter((milestone) => milestone.completed).length,
      milestoneTotal: goal.milestones.length,
    }));

  return {
    weekStart: week,
    days: archivedDays,
    tasksDone,
    tasksTotal,
    eventsDone,
    eventsTotal,
    habits,
    focusMinutes,
    focusSessions,
    moodAverage: moods.length ? Math.round((moods.reduce((sum, value) => sum + value, 0) / moods.length) * 10) / 10 : null,
    goals,
  };
}

export interface RetentionCounts {
  weeksArchived: number;
  explanations: number;
  focusSessions: number;
  moods: number;
  checkIns: number;
  taskDetails: number;
  eventDetails: number;
  planBodies: number;
}

const EMPTY_COUNTS: RetentionCounts = {
  weeksArchived: 0,
  explanations: 0,
  focusSessions: 0,
  moods: 0,
  checkIns: 0,
  taskDetails: 0,
  eventDetails: 0,
  planBodies: 0,
};

export interface RetentionResult {
  state: PlannerState;
  archived: WeekArchive[];
  dropped: RetentionCounts;
}

/** True when a run would do nothing at all, so callers can skip a commit. */
export function retentionIdle(result: RetentionResult): boolean {
  const { dropped } = result;
  return Object.keys(EMPTY_COUNTS).every((key) => dropped[key as keyof RetentionCounts] === 0);
}

/**
 * The rollup itself. Deterministic and idempotent: running it twice for the same
 * week changes nothing the second time, and two devices that see the same state
 * write identical archives.
 *
 * `weeks = 0` means keep everything: no archive is written and no detail dropped.
 */
export function rollUp(state: PlannerState, weeks: number, today = todayISO()): RetentionResult {
  const keepEverything = weeks === KEEP_EVERYTHING || !Number.isFinite(weeks);
  if (keepEverything) return { state, archived: [], dropped: { ...EMPTY_COUNTS } };

  const windowStart = hotWindowStart(weeks, today);
  const already = new Set((state.archives ?? []).map((archive) => archive.weekStart));
  const oldest = oldestDate(state);
  const archived: WeekArchive[] = [];
  const dropped: RetentionCounts = { ...EMPTY_COUNTS };

  if (oldest) {
    let week = startOfWeek(oldest);
    for (let guard = 0; guard < MAX_WEEKS_PER_RUN; guard += 1) {
      if (week >= windowStart) break;
      if (!weekIsRollable(week, today)) {
        week = addDays(week, 7);
        continue;
      }
      // A week nobody put anything into is not archived: an empty record for
      // every week since the oldest task would grow the vault without saying
      // anything, and charts already draw the gaps.
      if (!already.has(week) && weekHasData(state, week)) {
        archived.push(buildWeekArchive(state, week, today));
        dropped.weeksArchived += 1;
      }
      week = addDays(week, 7);
    }
  }

  // Detail that has left the window. Only finished or time-bound things are
  // touched: an open task is work, not a record.
  const beforeWindow = (iso: string | null | undefined): boolean => !!iso && iso < windowStart;
  /**
   * …and only things the window has actually seen. A syllabus imported today
   * carries dates from a term that may already be half over; pruning by date
   * alone would strip the topics out of the plan that was just paid for. The
   * rule is about age, not about how old the date on the item is.
   */
  const aged = (createdAt: string | null | undefined): boolean => beforeWindow(createdAt?.slice(0, 10));

  // Keep the notes still inside the window — `beforeWindow` is the *dropping*
  // predicate, and inverting it here silently ate the current week's headline.
  const explanations = state.panels.student.explanations.filter((note) => !beforeWindow(note.weekOf));
  const tasks = state.tasks.map((task) => {
    if (!task.completed || !aged(task.createdAt) || !beforeWindow(task.completedAt?.slice(0, 10) ?? task.dueDate)) return task;
    if (!task.note && task.subtasks.length === 0) return task;
    dropped.taskDetails += 1;
    return { ...task, note: '', subtasks: [] };
  });
  const events = state.events.map((event) => {
    if (!event.completed || !aged(event.createdAt) || !beforeWindow(event.date) || !event.note) return event;
    dropped.eventDetails += 1;
    return { ...event, note: '' };
  });
  const focusLog = state.focusLog.filter((entry) => !beforeWindow(entry.date));
  const moods = state.moods.filter((entry) => !beforeWindow(entry.date));
  const completions = state.completions.filter((entry) => !beforeWindow(entry.date));
  const aiPlans = state.aiPlans.map((plan) => {
    if (!aged(plan.createdAt) || !beforeWindow(plan.startDate)) return plan;
    if (plan.tasks.length + plan.events.length + plan.habits.length + plan.suggestions.length === 0) return plan;
    dropped.planBodies += 1;
    return { ...plan, tasks: [], events: [], habits: [], suggestions: [] };
  });

  dropped.explanations = state.panels.student.explanations.length - explanations.length;
  dropped.focusSessions = state.focusLog.length - focusLog.length;
  dropped.moods = state.moods.length - moods.length;
  dropped.checkIns = state.completions.length - completions.length;

  if (retentionIdle({ state, archived, dropped })) return { state, archived: [], dropped: { ...EMPTY_COUNTS } };

  return {
    state: {
      ...state,
      tasks,
      events,
      focusLog,
      moods,
      completions,
      aiPlans,
      archives: [...(state.archives ?? []), ...archived],
      panels: {
        ...state.panels,
        student: { ...state.panels.student, explanations },
      },
    },
    archived,
    dropped,
  };
}
