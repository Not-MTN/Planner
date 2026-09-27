import { categoryById, noteKindById } from './constants';
import {
  addDays,
  isValidISODate,
  startOfWeek,
  timeToMinutes,
  weekDates,
  weekdayIndex,
} from './dates';
import { occursOn } from './recurrence';
import type { DayScore, DotState, Goal, Habit, HabitFrequency, PlannerEvent, PlannerState, Task } from './types';
import { t } from './i18n';

export function isDone(state: PlannerState, habitId: string, date: string): boolean {
  return state.completions.some((item) => item.habitId === habitId && item.date === date);
}

export function isPlannedDay(habit: Habit, date: string): boolean {
  if (!isValidISODate(date) || date < habit.createdOn) return false;
  const frequency = habit.frequency;
  if (frequency.type === 'daily' || frequency.type === 'weekly') return true;
  const day = new Date(date + 'T00:00:00').getDay();
  if (frequency.type === 'weekdays') return day >= 1 && day <= 5;
  return frequency.days.includes(day);
}

export function isDueOn(state: PlannerState, habit: Habit, date: string): boolean {
  if (habit.archived || date < habit.createdOn) return false;
  if (habit.frequency.type === 'weekly') {
    if (isDone(state, habit.id, date)) return true;
    const count = weekDates(date).filter((day) => isDone(state, habit.id, day)).length;
    return count < habit.frequency.times;
  }
  return isPlannedDay(habit, date);
}

export function habitDot(state: PlannerState, habit: Habit, date: string, today: string): DotState {
  if (date < habit.createdOn) return 'off';
  if (isDone(state, habit.id, date)) return 'done';
  if (habit.frequency.type === 'weekly') return date > today ? 'future' : 'optional';
  if (!isPlannedDay(habit, date)) return 'off';
  return date > today ? 'future' : 'open';
}

export function habitStats(
  state: PlannerState,
  habit: Habit,
  dates: string[],
  today: string,
): { done: number; expected: number; ratio: number } {
  const inRange = dates.filter((date) => date >= habit.createdOn && date <= today).sort();
  if (inRange.length === 0) return { done: 0, expected: 0, ratio: 0 };
  if (habit.frequency.type === 'weekly') {
    let expected = 0;
    let cursor = startOfWeek(inRange[0]);
    const last = startOfWeek(inRange[inRange.length - 1]);
    const rangeSet = new Set(dates);
    while (cursor <= last) {
      const overlaps = weekDates(cursor).some(
        (date) => date >= habit.createdOn && date <= today && rangeSet.has(date),
      );
      if (overlaps) expected += habit.frequency.times;
      cursor = addDays(cursor, 7);
    }
    const done = inRange.filter((date) => isDone(state, habit.id, date)).length;
    return { done, expected, ratio: expected === 0 ? 0 : Math.min(1, done / expected) };
  }
  const planned = inRange.filter((date) => isPlannedDay(habit, date));
  const done = planned.filter((date) => isDone(state, habit.id, date)).length;
  return { done, expected: planned.length, ratio: planned.length === 0 ? 0 : done / planned.length };
}

export function compareEvents(a: PlannerEvent, b: PlannerEvent): number {
  const byTime = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  if (byTime !== 0) return byTime;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt.localeCompare(b.createdAt);
}

export function compareTasks(a: Task, b: Task): number {
  const aTime = a.dueTime ? timeToMinutes(a.dueTime) : 24 * 60 + 1;
  const bTime = b.dueTime ? timeToMinutes(b.dueTime) : 24 * 60 + 1;
  if (aTime !== bTime) return aTime - bTime;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt.localeCompare(b.createdAt);
}

export function fixedEventsForDate(state: PlannerState, date: string): PlannerEvent[] {
  if (!isValidISODate(date)) return [];
  const weekday = weekdayIndex(date);
  return state.fixedCommitments
    .filter((commitment) => commitment.weekday === weekday)
    .map((commitment) => ({
      id: `fixed:${commitment.id}:${date}`,
      title: commitment.title,
      date,
      startTime: commitment.startTime,
      endTime: commitment.endTime,
      category: commitment.category,
      note: commitment.note,
      important: true,
      completed: false,
      sortOrder: -1,
      createdAt: commitment.createdAt,
      updatedAt: commitment.updatedAt,
      repeat: null,
      fixedCommitmentId: commitment.id,
    }));
}

export function seriesEventsForDate(state: PlannerState, date: string): PlannerEvent[] {
  if (!isValidISODate(date)) return [];
  return state.events
    .filter((event) => event.repeat && !event.completed && event.date !== date && occursOn(event.date, event.repeat, date))
    .map((event) => ({
      ...event,
      id: `series:${event.id}:${date}`,
      date,
      completed: false,
      seriesEventId: event.id,
    }));
}

export function eventsForDate(state: PlannerState, date: string): PlannerEvent[] {
  return [
    ...state.events.filter((event) => event.date === date),
    ...seriesEventsForDate(state, date),
    ...fixedEventsForDate(state, date),
  ].sort(compareEvents);
}

export function tasksForDate(state: PlannerState, date: string): Task[] {
  return state.tasks.filter((task) => task.dueDate === date).sort(compareTasks);
}

export function overdueTasks(state: PlannerState, today: string): Task[] {
  return state.tasks
    .filter((task) => !task.completed && !task.waiting && task.dueDate !== null && task.dueDate < today)
    .sort(compareTasks);
}

export function waitingTasks(state: PlannerState): Task[] {
  return state.tasks.filter((task) => !task.completed && Boolean(task.waiting)).sort(compareTasks);
}

export function weekLeftovers(state: PlannerState, today: string): Task[] {
  const days = new Set(weekDates(today).filter((date) => date <= today));
  return state.tasks
    .filter((task) => !task.completed && !task.waiting && task.dueDate !== null && days.has(task.dueDate))
    .sort(compareTasks);
}

export function habitsDueOn(state: PlannerState, date: string): Habit[] {
  return state.habits.filter((habit) => isDueOn(state, habit, date));
}

export function dayScore(state: PlannerState, date: string, includeOpenFlexible = false): DayScore {
  const tasks = tasksForDate(state, date);
  const events = eventsForDate(state, date).filter((event) => !event.fixedCommitmentId);
  const fixed = state.habits.filter(
    (habit) => !habit.archived && habit.frequency.type !== 'weekly' && isPlannedDay(habit, date),
  );
  const flexibleDone = state.habits.filter(
    (habit) => !habit.archived && habit.frequency.type === 'weekly' && isDone(state, habit.id, date),
  );
  const flexibleOpen = includeOpenFlexible
    ? state.habits.filter(
        (habit) =>
          !habit.archived &&
          habit.frequency.type === 'weekly' &&
          isDueOn(state, habit, date) &&
          !isDone(state, habit.id, date),
      )
    : [];
  const habits = [...fixed, ...flexibleDone, ...flexibleOpen];
  const tasksDone = tasks.filter((task) => task.completed).length;
  const eventsDone = events.filter((event) => event.completed).length;
  const habitsDone = habits.filter((habit) => isDone(state, habit.id, date)).length;
  const done = tasksDone + eventsDone + habitsDone;
  const total = tasks.length + events.length + habits.length;
  return {
    tasksDone,
    tasksTotal: tasks.length,
    eventsDone,
    eventsTotal: events.length,
    habitsDone,
    habitsTotal: habits.length,
    done,
    total,
    ratio: total === 0 ? null : done / total,
  };
}

export function progressPhrase(ratio: number | null): string {
  if (ratio === null) return t("Nothing scheduled yet.");
  if (ratio === 0) return t("Whenever you are ready.");
  if (ratio < 0.5) return t("A gentle start.");
  if (ratio < 1) return t("Moving through the day.");
  return t("Today is complete.");
}

export function goalProgress(goal: Goal, tasks: Task[]): { done: number; total: number; ratio: number } {
  const linked = tasks.filter((task) => task.goalId === goal.id);
  const total = goal.milestones.length + linked.length;
  const done = goal.milestones.filter((step) => step.completed).length + linked.filter((task) => task.completed).length;
  return { done, total, ratio: total === 0 ? 0 : done / total };
}

export function linkedTasks(state: PlannerState, goalId: string): Task[] {
  return state.tasks.filter((task) => task.goalId === goalId).sort(compareTasks);
}

export interface FocusItem {
  date: string;
  title: string;
  kind: 'event' | 'task';
  time: string;
}

export function upcomingFocus(state: PlannerState, today: string, within = 3): FocusItem[] {
  const end = addDays(today, within);
  const events: FocusItem[] = state.events
    .filter((event) => event.important && !event.completed && event.date > today && event.date <= end)
    .map((event) => ({ date: event.date, title: event.title, kind: 'event', time: event.startTime }));
  const tasks: FocusItem[] = state.tasks
    .filter(
      (task) =>
        !task.completed &&
        task.priority === 'high' &&
        task.dueDate !== null &&
        task.dueDate > today &&
        task.dueDate <= end,
    )
    .map((task) => ({ date: task.dueDate as string, title: task.title, kind: 'task', time: task.dueTime ?? '99:99' }));
  return [...events, ...tasks]
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(0, 3);
}

export function frequencyLabelOf(frequency: HabitFrequency): string {
  return frequencyLabel({ frequency });
}

export function frequencyLabel(habit: Pick<Habit, 'frequency'>): string {
  const frequency = habit.frequency;
  if (frequency.type === 'daily') return t("Every day");
  if (frequency.type === 'weekdays') return t("Weekdays");
  if (frequency.type === 'weekly') return t("{0}× a week", { 0: frequency.times });
  const names = [t("Sun"), 'Mon', t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat")];
  const labels = [...frequency.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => names[day]);
  return labels.join(', ');
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => (value ?? '').toLowerCase().includes(needle));
}

export function categoryLabel(id: string): string {
  return categoryById(id).label;
}

export function weekNarrative(state: PlannerState, today: string): string {
  const days = new Set(weekDates(today).filter((date) => date <= today));
  const tasks = state.tasks.filter((task) => task.dueDate !== null && days.has(task.dueDate));
  const events = state.events.filter((event) => days.has(event.date));
  const done = tasks.filter((task) => task.completed).length + events.filter((event) => event.completed).length;
  const total = tasks.length + events.length;
  const moving = state.goals.filter((goal) => {
    const progress = goalProgress(goal, state.tasks);
    return progress.total === 0 || progress.ratio < 1;
  }).length;
  const habitDone = state.habits.filter((habit) => !habit.archived && weekDates(today).some((date) => date <= today && isDone(state, habit.id, date))).length;
  if (total === 0 && state.goals.length === 0 && state.habits.length === 0) {
    return t("A quiet week so far. Add only what you want to keep.");
  }
  const head =
    total === 0
      ? t("The week’s schedule is still open.")
      : done === 0
        ? t("{0} {1} on the page so far.", { 0: total, 1: total === 1 ? t("thing is") : t("things are") })
        : done === total
          ? t("Everything scheduled so far this week is done.")
          : t("{0} of {1} scheduled things are done so far this week.", { 0: done, 1: total });
  const habitLine =
    habitDone === 0 ? '' : t(" {0} {1} kept this week.", { 0: habitDone, 1: habitDone === 1 ? t("habit was") : t("habits were") });
  const goalLine = moving === 0 ? '' : t(" {0} {1} still in motion.", { 0: moving, 1: moving === 1 ? t("goal is") : t("goals are") });
  return `${head}${habitLine}${goalLine}`.replace(/\s+/g, ' ').trim();
}

export interface AgendaDay {
  date: string;
  events: PlannerEvent[];
  tasks: Task[];
  habits: Habit[];
  notes: { id: string; title: string }[];
  intention: string;
  deadlines: { id: string; title: string }[];
}

export function agendaDay(state: PlannerState, date: string): AgendaDay {
  return {
    date,
    events: eventsForDate(state, date),
    tasks: tasksForDate(state, date),
    habits: habitsDueOn(state, date),
    notes: state.notes.filter((note) => note.date === date).map((note) => ({ id: note.id, title: note.title })),
    intention: state.intentions[date] ?? '',
    deadlines: [
      ...state.goals
        .filter((goal) => goal.deadline === date && goalProgress(goal, state.tasks).ratio < 1)
        .map((goal) => ({ id: goal.id, title: goal.title })),
      ...state.goals.flatMap((goal) =>
        goal.milestones
          .filter((step) => !step.completed && step.dueDate === date)
          .map((step) => ({ id: step.id, title: `${goal.title}: ${step.title}` })),
      ),
    ],
  };
}

export function hasAgendaPlans(day: AgendaDay): boolean {
  return day.events.length + day.tasks.length + day.notes.length + day.deadlines.length > 0 || Boolean(day.intention.trim());
}

export function agendaWindow(state: PlannerState, today: string, horizon: number): AgendaDay[] {
  const count = Math.min(90, Math.max(1, horizon));
  return Array.from({ length: count }, (_, index) => agendaDay(state, addDays(today, index + 1)));
}

export function dayLoad(day: AgendaDay): number {
  return day.events.length + day.tasks.filter((task) => !task.completed).length + day.deadlines.length;
}

export type LoadLevel = 'quiet' | 'steady' | 'full';

export function loadLevel(count: number): LoadLevel {
  if (count <= 0) return 'quiet';
  if (count <= 2) return 'steady';
  return 'full';
}

export function quietestDay(days: AgendaDay[]): AgendaDay | null {
  if (days.length === 0) return null;
  return [...days].sort((a, b) => dayLoad(a) - dayLoad(b) || a.date.localeCompare(b.date))[0];
}

export function laterAgenda(state: PlannerState, today: string, horizon: number): {
  events: PlannerEvent[];
  tasks: Task[];
  deadlines: { id: string; title: string; date: string }[];
} {
  const after = addDays(today, Math.min(90, Math.max(1, horizon)));
  return {
    events: state.events
      .filter((event) => !event.completed && event.date > after)
      .sort((a, b) => a.date.localeCompare(b.date) || compareEvents(a, b)),
    tasks: state.tasks
      .filter((task) => !task.completed && task.dueDate !== null && task.dueDate > after)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || compareTasks(a, b)),
    deadlines: state.goals
      .filter((goal) => goal.deadline !== null && goal.deadline > after && goalProgress(goal, state.tasks).ratio < 1)
      .map((goal) => ({ id: goal.id, title: goal.title, date: goal.deadline as string }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function calendarMarks(state: PlannerState, date: string): { events: number; tasks: number; important: boolean } {
  const events = eventsForDate(state, date);
  const tasks = state.tasks.filter((task) => task.dueDate === date);
  return {
    events: events.length,
    tasks: tasks.length,
    important: events.some((event) => event.important) || tasks.some((task) => task.priority === 'high'),
  };
}

export interface HabitStreaks {
  current: number;
  best: number;
}

export function habitStreaks(state: PlannerState, habit: Habit, today: string): HabitStreaks {
  if (habit.frequency.type === 'weekly') {
    const times = habit.frequency.times;
    let best = 0;
    let run = 0;
    let cursor = startOfWeek(habit.createdOn);
    const thisWeek = startOfWeek(today);
    while (cursor <= thisWeek) {
      const done = weekDates(cursor).filter((date) => isDone(state, habit.id, date)).length;
      if (done >= times) {
        run += 1;
        best = Math.max(best, run);
      } else if (cursor < thisWeek) {
        run = 0;
      }
      cursor = addDays(cursor, 7);
    }
    return { current: run, best };
  }
  let best = 0;
  let run = 0;
  let cursor = habit.createdOn;
  while (cursor <= today) {
    if (isPlannedDay(habit, cursor)) {
      if (isDone(state, habit.id, cursor)) {
        run += 1;
        best = Math.max(best, run);
      } else if (cursor < today) {
        run = 0;
      }
    }
    cursor = addDays(cursor, 1);
  }
  return { current: run, best };
}

export type SearchKind = 'task' | 'event' | 'note' | 'goal' | 'habit';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  sub: string;
}

export function searchHits(state: PlannerState, query: string, perKind = 4): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  const push = (kind: SearchKind, id: string, title: string, sub: string, haystack: string[]) => {
    if (hits.filter((hit) => hit.kind === kind).length >= perKind) return;
    if (matchesQuery([title, ...haystack], needle)) hits.push({ kind, id, title, sub });
  };
  for (const task of state.tasks) {
    push('task', task.id, task.title, `${task.completed ? 'Done' : 'Open'}${task.dueDate ? ` · ${task.dueDate}` : ''}`, [task.note, task.category, task.priority]);
  }
  for (const event of state.events) {
    push('event', event.id, event.title, `${event.date} · ${event.startTime}`, [event.note, event.category]);
  }
  for (const note of state.notes) {
    push('note', note.id, note.title, noteKindById(note.kind).label, [note.body]);
  }
  for (const goal of state.goals) {
    push('goal', goal.id, goal.title, goal.horizon === 'long' ? 'Long-term' : 'Short-term', [goal.description]);
  }
  for (const habit of state.habits) {
    if (habit.archived) continue;
    push('habit', habit.id, habit.name, frequencyLabel(habit), [habit.name]);
  }
  return hits;
}

export interface InsightTotals {
  tasksCompleted: number;
  tasksOpen: number;
  checkIns: number;
  activeGoals: number;
  notes: number;
  dayStreak: number;
}

export function insightTotals(state: PlannerState, today: string): InsightTotals {
  const activeGoals = state.goals.filter((goal) => goalProgress(goal, state.tasks).ratio < 1).length;
  let dayStreak = 0;
  let cursor = today;
  for (let guard = 0; guard < 366; guard += 1) {
    const score = dayScore(state, cursor, false);
    if (score.done > 0) {
      dayStreak += 1;
      cursor = addDays(cursor, -1);
    } else if (cursor === today) {
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  return {
    tasksCompleted: state.tasks.filter((task) => task.completed).length,
    tasksOpen: state.tasks.filter((task) => !task.completed).length,
    checkIns: state.completions.length,
    activeGoals,
    notes: state.notes.length,
    dayStreak,
  };
}

export function weekDoneCount(state: PlannerState, dates: string[]): number {
  let done = 0;
  for (const date of dates) {
    const score = dayScore(state, date, false);
    done += score.done;
  }
  return done;
}

export function essentialHabits(state: PlannerState, date: string): Habit[] {
  return state.habits.filter((habit) => !habit.archived && habit.essential && isDueOn(state, habit, date));
}

export function isEmptyState(state: PlannerState): boolean {
  return (
    state.tasks.length === 0 &&
    state.events.length === 0 &&
    state.fixedCommitments.length === 0 &&
    state.habits.length === 0 &&
    state.goals.length === 0 &&
    state.notes.length === 0
  );
}
