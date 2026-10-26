/**
 * The student's standing weekly class times.
 *
 * These are owned by the student and travel to guardians read-only: a
 * guardian planning the week sees them as locked blocks and gets a clear
 * warning when a lesson would run into one. Everything here is pure — what
 * rides the encrypted link is decided in `auth/links.ts`.
 */
import { isValidTime, timeToMinutes, weekdayIndex } from './dates';
import { t } from './i18n';
import { FIXED_CLASSES_LIMIT } from './types';
import type { FixedClass } from './types';

export interface FixedClassDraft {
  title: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export function emptyFixedClassDraft(weekday = new Date().getDay()): FixedClassDraft {
  return { title: '', weekday, startTime: '08:00', endTime: '09:30' };
}

/** Parse one row off the wire; anything malformed is dropped, never guessed. */
export function sanitizeFixedClass(value: unknown): FixedClass | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 80) : '';
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
  const weekday = typeof raw.weekday === 'number' && Number.isInteger(raw.weekday) && raw.weekday >= 0 && raw.weekday <= 6
    ? raw.weekday
    : -1;
  const startTime = typeof raw.startTime === 'string' && isValidTime(raw.startTime) ? raw.startTime : '';
  const endTime = typeof raw.endTime === 'string' && isValidTime(raw.endTime) ? raw.endTime : '';
  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt.length <= 40 && Number.isFinite(Date.parse(raw.createdAt))
      ? raw.createdAt
      : '';
  const updatedAt =
    typeof raw.updatedAt === 'string' && raw.updatedAt.length <= 40 && Number.isFinite(Date.parse(raw.updatedAt))
      ? raw.updatedAt
      : createdAt;
  if (!id || !title || weekday < 0 || !startTime || !endTime || !createdAt) return null;
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) return null;
  return { id, title, weekday, startTime, endTime, createdAt, updatedAt: updatedAt || createdAt };
}

/** Validate a draft before it becomes a standing class. */
export function fixedClassDraftError(
  draft: FixedClassDraft,
  existing: FixedClass[],
  editingId?: string,
): string | null {
  if (!draft.title.trim()) return t('Give the class a name.');
  if (!isValidTime(draft.startTime) || !isValidTime(draft.endTime)) return t('Choose valid start and end times.');
  if (timeToMinutes(draft.endTime) <= timeToMinutes(draft.startTime)) {
    return t('The end time has to come after the start.');
  }
  const clash = existing.find(
    (item) =>
      item.id !== editingId &&
      item.weekday === draft.weekday &&
      intervalsOverlap(draft.startTime, draft.endTime, item.startTime, item.endTime),
  );
  if (clash) return t('That time already has {0}.', { 0: clash.title });
  if (!editingId && existing.length >= FIXED_CLASSES_LIMIT) {
    return t('You can keep up to {0} standing classes.', { 0: FIXED_CLASSES_LIMIT });
  }
  return null;
}

export function intervalsOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const a0 = timeToMinutes(startA);
  const a1 = timeToMinutes(endA);
  const b0 = timeToMinutes(startB);
  const b1 = timeToMinutes(endB);
  return a0 < b1 && b0 < a1;
}

/** One weekday's classes in day order. */
export function classesForWeekday(classes: FixedClass[], weekday: number): FixedClass[] {
  return classes
    .filter((item) => item.weekday === weekday)
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title));
}

/** Standing classes that collide with a planned lesson on a given weekday. */
export function classConflicts(
  classes: FixedClass[],
  weekday: number,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): FixedClass[] {
  if (!startTime || !isValidTime(startTime)) return [];
  const finish = endTime && isValidTime(endTime) && timeToMinutes(endTime) > timeToMinutes(startTime) ? endTime : null;
  return classesForWeekday(classes, weekday).filter((item) => {
    const end = finish ?? addMinutes(startTime, 1);
    return intervalsOverlap(startTime, end, item.startTime, item.endTime);
  });
}

/** A fixed class blocking an ISO date (the plan's weekday) at a typed time. */
export function classConflictsForDate(
  classes: FixedClass[],
  isoDate: string | null,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): FixedClass[] {
  if (!isoDate) return [];
  return classConflicts(classes, weekdayIndex(isoDate), startTime, endTime);
}

function addMinutes(time: string, minutes: number): string {
  const total = Math.min(24 * 60, timeToMinutes(time) + minutes);
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
