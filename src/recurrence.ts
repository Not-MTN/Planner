import { addDays, parseISODate, toISODate } from './dates';
import type { TaskRepeat } from './types';

export const REPEAT_CHOICES: { id: TaskRepeat; label: string }[] = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Every weekday' },
  { id: 'weekly', label: 'Every week' },
  { id: 'monthly', label: 'Every month' },
  { id: 'yearly', label: 'Every year' },
];

export const REPEAT_SET = new Set<string>(REPEAT_CHOICES.map((item) => item.id));

export function repeatLabel(repeat: TaskRepeat | null | undefined): string {
  return REPEAT_CHOICES.find((item) => item.id === repeat)?.label ?? 'Does not repeat';
}

/** Adds calendar months, clamping to the last day (Jan 31 → Feb 28/29). */
function addMonths(iso: string, months: number): string {
  const date = parseISODate(iso);
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return toISODate(target);
}

/** The next due date strictly after `from` for a repeat rule. */
export function nextOccurrence(from: string, repeat: TaskRepeat): string {
  if (repeat === 'daily') return addDays(from, 1);
  if (repeat === 'weekly') return addDays(from, 7);
  if (repeat === 'monthly') return addMonths(from, 1);
  if (repeat === 'yearly') return addMonths(from, 12);
  let next = addDays(from, 1);
  while ([0, 6].includes(parseISODate(next).getDay())) next = addDays(next, 1);
  return next;
}

/**
 * The next date for a completed repeating task. If the task is overdue, it
 * skips ahead so the next copy isn't already in the past.
 */
export function nextDueAfterCompletion(dueDate: string | null, repeat: TaskRepeat, today: string): string {
  let next = nextOccurrence(dueDate ?? today, repeat);
  let guard = 0;
  while (next <= today && guard < 1000) {
    next = nextOccurrence(next, repeat);
    guard += 1;
  }
  // Undated tasks start from today, so their first repeat is tomorrow or later.
  return next;
}
