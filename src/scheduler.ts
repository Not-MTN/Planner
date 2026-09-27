import { timeToMinutes } from './dates';
import { eventsForDate, tasksForDate } from './logic';
import type { PlannerState, Task } from './types';

export interface ScheduleOptions {
  /** Earliest minute of the day to place anything (e.g. now, rounded up). */
  from: number;
  /** Latest minute a task may end. */
  until?: number;
  /** Minutes per task. */
  length?: number;
  /** Breathing room kept after each block. */
  buffer?: number;
  /** Maximum number of tasks to place. */
  max?: number;
}

export interface ScheduledTask {
  id: string;
  title: string;
  date: string;
  time: string;
}

const PRIORITY_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Suggests times for untimed work on `date`: that day's untimed tasks, then overdue
 * tasks, then undated high-priority tasks. Events, protected times, and already-timed
 * tasks are treated as busy. Pure — returns a plan and changes nothing.
 */
export function autoSchedule(state: PlannerState, date: string, options: ScheduleOptions): ScheduledTask[] {
  const length = options.length ?? 30;
  const buffer = options.buffer ?? 10;
  const until = options.until ?? 21 * 60;
  const max = options.max ?? 8;
  const start = Math.ceil(Math.max(options.from, 7 * 60) / 15) * 15;

  const busy: Array<[number, number]> = [];
  for (const event of eventsForDate(state, date)) {
    const s = timeToMinutes(event.startTime);
    const e = event.endTime ? timeToMinutes(event.endTime) : s + 60;
    busy.push([s, e]);
  }
  const dayTasks = tasksForDate(state, date);
  for (const task of dayTasks) {
    if (task.completed || !task.dueTime) continue;
    const s = timeToMinutes(task.dueTime);
    busy.push([s, s + length]);
  }
  busy.sort((a, b) => a[0] - b[0]);

  const byPriority = (a: Task, b: Task) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sortOrder - b.sortOrder;
  const seen = new Set<string>();
  const candidates = [
    ...dayTasks.filter((task) => !task.completed && !task.dueTime).sort(byPriority),
    ...state.tasks.filter((task) => !task.completed && task.dueDate !== null && task.dueDate < date).sort(byPriority),
    ...state.tasks.filter((task) => !task.completed && !task.dueDate && task.priority === 'high').sort(byPriority),
  ].filter((task) => (seen.has(task.id) ? false : (seen.add(task.id), true)));

  const plan: ScheduledTask[] = [];
  let cursor = start;
  for (const task of candidates) {
    if (plan.length >= max) break;
    // Find the first gap at or after the cursor that fits the block.
    let placed: number | null = null;
    let probe = cursor;
    while (probe + length <= until) {
      const clash = busy.find(([s, e]) => probe < e + buffer && probe + length + buffer > s);
      if (!clash) {
        placed = probe;
        break;
      }
      probe = Math.ceil((clash[1] + buffer) / 5) * 5;
    }
    if (placed === null) break;
    plan.push({ id: task.id, title: task.title, date, time: clock(placed) });
    busy.push([placed, placed + length]);
    busy.sort((a, b) => a[0] - b[0]);
    cursor = placed + length + buffer;
  }
  return plan;
}
