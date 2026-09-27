import { addDays, formatWeekRange, localDateFromTimestamp, startOfWeek, weekDates } from './dates';
import { dayScore, formatPercent, habitStreaks } from './logic';
import type { PlannerState, Task } from './types';

/** The local date a task was finished (falls back to its due date for older data). */
export function completionDate(task: Task): string | null {
  if (!task.completed) return null;
  if (task.completedAt) return localDateFromTimestamp(task.completedAt);
  return task.dueDate;
}

export interface FocusSummary {
  totalMinutes: number;
  sessions: number;
  perDay: { date: string; minutes: number }[];
  topTasks: { title: string; minutes: number }[];
}

export function focusSummary(state: PlannerState, today: string, days = 7): FocusSummary {
  const dates = Array.from({ length: days }, (_, index) => addDays(today, index - days + 1));
  const inRange = state.focusLog.filter((entry) => entry.date >= dates[0] && entry.date <= today);
  const byTitle = new Map<string, number>();
  for (const entry of inRange) byTitle.set(entry.title, (byTitle.get(entry.title) ?? 0) + entry.minutes);
  return {
    totalMinutes: inRange.reduce((sum, entry) => sum + entry.minutes, 0),
    sessions: inRange.length,
    perDay: dates.map((date) => ({ date, minutes: inRange.filter((entry) => entry.date === date).reduce((sum, entry) => sum + entry.minutes, 0) })),
    topTasks: [...byTitle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([title, minutes]) => ({ title, minutes })),
  };
}

export interface HourProfile {
  /** Completions per hour of day (0–23). */
  hours: number[];
  bestHour: number | null;
  sample: number;
}

/** When in the day you tend to finish things (tasks with a completion time + focus sessions). */
export function productiveHours(state: PlannerState): HourProfile {
  const hours = Array.from({ length: 24 }, () => 0);
  let sample = 0;
  for (const task of state.tasks) {
    if (!task.completed || !task.completedAt) continue;
    const date = new Date(task.completedAt);
    if (Number.isNaN(date.getTime())) continue;
    hours[date.getHours()] += 1;
    sample += 1;
  }
  for (const entry of state.focusLog) {
    const date = new Date(entry.endedAt);
    if (Number.isNaN(date.getTime())) continue;
    hours[date.getHours()] += 1;
    sample += 1;
  }
  if (sample < 3) return { hours, bestHour: null, sample };
  let bestHour = 0;
  hours.forEach((count, hour) => {
    if (count > hours[bestHour]) bestHour = hour;
  });
  return { hours, bestHour, sample };
}

export function hourLabel(hour: number): string {
  const end = (hour + 1) % 24;
  return `${String(hour).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00`;
}

export interface HabitLink {
  habitId: string;
  name: string;
  withHabit: number;
  without: number;
  /** Relative lift, e.g. 0.3 = 30% more tasks on habit days. */
  lift: number;
}

/**
 * Compares tasks finished on days a habit was done vs. days it wasn't.
 * Only reports habits with enough days on both sides to be meaningful.
 */
export function habitLinks(state: PlannerState, today: string, window = 60, minDays = 5): HabitLink[] {
  const doneByDate = new Map<string, number>();
  for (const task of state.tasks) {
    const date = completionDate(task);
    if (date) doneByDate.set(date, (doneByDate.get(date) ?? 0) + 1);
  }
  const dates = Array.from({ length: window }, (_, index) => addDays(today, -index - 1));
  const activeDates = dates.filter((date) => (doneByDate.get(date) ?? 0) > 0 || state.completions.some((item) => item.date === date));
  if (activeDates.length < minDays * 2) return [];
  const links: HabitLink[] = [];
  for (const habit of state.habits) {
    if (habit.archived) continue;
    const doneDays = new Set(state.completions.filter((item) => item.habitId === habit.id).map((item) => item.date));
    const on = activeDates.filter((date) => doneDays.has(date));
    const off = activeDates.filter((date) => !doneDays.has(date));
    if (on.length < minDays || off.length < minDays) continue;
    const avg = (list: string[]) => list.reduce((sum, date) => sum + (doneByDate.get(date) ?? 0), 0) / list.length;
    const withHabit = avg(on);
    const without = avg(off);
    if (without === 0 && withHabit === 0) continue;
    const lift = without === 0 ? 1 : (withHabit - without) / without;
    if (Math.abs(lift) < 0.15) continue;
    links.push({ habitId: habit.id, name: habit.name, withHabit, without, lift });
  }
  return links.sort((a, b) => b.lift - a.lift).slice(0, 4);
}

/** A plain-text / Markdown summary of this week, for copying or saving. */
export function weeklyReport(state: PlannerState, today: string): string {
  const days = weekDates(today).filter((date) => date <= today);
  const lines = [`# Week of ${formatWeekRange(startOfWeek(today))}`, ''];
  let done = 0;
  let total = 0;
  for (const date of days) {
    const score = dayScore(state, date, false);
    done += score.done;
    total += score.total;
  }
  lines.push(`**Completed:** ${done} of ${total} planned items${total ? ` (${formatPercent(done / total)})` : ''}`);
  const focus = focusSummary(state, today, days.length || 1);
  if (focus.totalMinutes) lines.push(`**Focus:** ${Math.round(focus.totalMinutes / 6) / 10} h across ${focus.sessions} sessions`);
  const finished = state.tasks.filter((task) => {
    const date = completionDate(task);
    return date !== null && days.includes(date);
  });
  if (finished.length) {
    lines.push('', '## Finished');
    for (const task of finished.slice(0, 30)) lines.push(`- [x] ${task.title}`);
  }
  const open = state.tasks.filter((task) => !task.completed && task.dueDate !== null && task.dueDate <= today);
  if (open.length) {
    lines.push('', '## Still open');
    for (const task of open.slice(0, 30)) lines.push(`- [ ] ${task.title} (due ${task.dueDate})`);
  }
  const habits = state.habits.filter((habit) => !habit.archived);
  if (habits.length) {
    lines.push('', '## Habits');
    for (const habit of habits) {
      const count = state.completions.filter((item) => item.habitId === habit.id && days.includes(item.date)).length;
      const streak = habitStreaks(state, habit, today).current;
      lines.push(`- ${habit.name}: ${count}/${days.length} days${streak >= 2 ? ` · ${streak}-day streak` : ''}`);
    }
  }
  return lines.join('\n') + '\n';
}
