import { describe, expect, it } from 'vitest';
import {
  classConflicts,
  classConflictsForDate,
  classesForWeekday,
  fixedClassDraftError,
  intervalsOverlap,
  sanitizeFixedClass,
} from './fixedClasses';
import type { FixedClass } from './types';

function fixed(partial: Partial<FixedClass>): FixedClass {
  return {
    id: 'c1',
    title: 'Maths',
    weekday: 1,
    startTime: '09:00',
    endTime: '10:30',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...partial,
  };
}

describe('sanitizeFixedClass', () => {
  it('keeps a well-formed class and drops malformed ones', () => {
    expect(sanitizeFixedClass(fixed({}))).not.toBeNull();
    expect(sanitizeFixedClass(fixed({ title: '' }))).toBeNull();
    expect(sanitizeFixedClass(fixed({ weekday: 9 }))).toBeNull();
    expect(sanitizeFixedClass(fixed({ endTime: '09:00' }))).toBeNull();
    expect(sanitizeFixedClass(fixed({ startTime: '25:00' }))).toBeNull();
  });
});

describe('fixed class helpers', () => {
  const classes = [
    fixed({ id: 'a', weekday: 1, startTime: '09:00', endTime: '10:30', title: 'Maths' }),
    fixed({ id: 'b', weekday: 1, startTime: '11:00', endTime: '12:00', title: 'Physics' }),
    fixed({ id: 'c', weekday: 2, startTime: '08:00', endTime: '09:00', title: 'Chemistry' }),
  ];

  it('lists one weekday in time order', () => {
    expect(classesForWeekday(classes, 1).map((item) => item.id)).toEqual(['a', 'b']);
    expect(classesForWeekday(classes, 3)).toEqual([]);
  });

  it('detects overlapping intervals including touching edges correctly', () => {
    expect(intervalsOverlap('10:00', '11:00', '10:30', '12:00')).toBe(true);
    expect(intervalsOverlap('10:30', '11:00', '09:00', '10:30')).toBe(false);
    expect(intervalsOverlap('08:00', '09:00', '09:00', '10:00')).toBe(false);
  });

  it('flags lessons that clash with a class', () => {
    expect(classConflicts(classes, 1, '10:00', '11:30').map((item) => item.id)).toEqual(['a', 'b']);
    expect(classConflicts(classes, 1, '12:30', '13:30')).toEqual([]);
    expect(classConflicts(classes, 2, '08:30', null).map((item) => item.id)).toEqual(['c']);
    expect(classConflicts(classes, 2, null, null)).toEqual([]);
  });

  it('maps an ISO date to its weekday clashes', () => {
    // 2026-10-26 is a Monday (weekday 1).
    expect(classConflictsForDate(classes, '2026-10-26', '09:30', '10:00').map((item) => item.id)).toEqual(['a']);
  });

  it('validates drafts including same-weekday clashes', () => {
    expect(fixedClassDraftError({ title: 'Tutoring', weekday: 1, startTime: '09:30', endTime: '10:00' }, classes)).toBeTruthy();
    expect(fixedClassDraftError({ title: 'Tutoring', weekday: 3, startTime: '09:30', endTime: '10:00' }, classes)).toBeNull();
    expect(fixedClassDraftError({ title: '', weekday: 3, startTime: '09:30', endTime: '10:00' }, classes)).toBeTruthy();
    expect(fixedClassDraftError({ title: 'Edit', weekday: 1, startTime: '09:30', endTime: '10:00' }, classes, 'a')).toBeNull();
  });
});
