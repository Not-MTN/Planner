/**
 * Reading a syllabus.
 *
 * The fixtures here are the shapes real outlines arrive in: a labelled week
 * table, a numbered list, a term that states its start date in a sentence, an
 * assessment-only page, and a document that is mostly prose. What matters is
 * that a wrong week never becomes a task — the parser says how many dated lines
 * it could not read rather than inventing structure for them.
 */
import { describe, expect, it } from 'vitest';
import { parseSyllabus, readDate, syllabusToTasks } from './syllabus';

const TERM = `CS 201 — Introduction to Thermodynamics
Term starts 15 September 2025

Week 1: Introduction and units
Week 2: The first law
- energy conservation
- closed systems
Week 3: Entropy
Midterm exam — 15 October 2025 — worth 30%
Week 4: The second law
Final exam 12 December 2025, 60%`;

describe('reading dates the way outlines write them', () => {
  it('reads ISO, day-first numeric, and month names, with and without a year', () => {
    expect(readDate('15 January 2026', 2025)).toBe('2026-01-15');
    expect(readDate('Jan 15', 2025)).toBe('2025-01-15');
    expect(readDate('05/03/2026', 2025)).toBe('2026-03-05');
    expect(readDate('2026-03-05', 2025)).toBe('2026-03-05');
  });

  it('refuses a date that does not exist', () => {
    expect(readDate('31 February 2026', 2025)).toBeNull();
    expect(readDate('no date here', 2025)).toBeNull();
  });
});

describe('a term plan from a pasted syllabus', () => {
  const parsed = parseSyllabus(TERM, '2025-09-01');

  it('finds the weeks, their numbers and topics', () => {
    expect(parsed.weeks.map((week) => week.week)).toEqual([1, 2, 3, 4]);
    expect(parsed.weeks[1].title).toBe('The first law');
    expect(parsed.weeks[1].topics).toContain('energy conservation');
  });

  it('reads the term start and dates every week from it', () => {
    expect(parsed.termStart).toBe('2025-09-15');
    expect(parsed.weeks[0].start).toBe('2025-09-15');
    expect(parsed.weeks[3].start).toBe('2025-10-06');
  });

  it('finds the assessments with their dates and weights', () => {
    expect(parsed.assessments.map((item) => item.date)).toEqual(['2025-10-15', '2025-12-12']);
    expect(parsed.assessments[0].weight).toBe(30);
    expect(parsed.assessments[1].weight).toBe(60);
    expect(parsed.assessments[0].title).toMatch(/Midterm exam/i);
  });

  it('keeps a line that was neither week nor assessment as unread, not as a task', () => {
    const messy = parseSyllabus('Week 1: Intro\nOffice hours 3 October 2025 in room 12\n', '2025-09-01');
    expect(messy.weeks).toHaveLength(1);
    expect(messy.unread).toBe(1);
  });

  it('does not treat a numbering-only line as a week', () => {
    const numbered = parseSyllabus('1. Thermodynamics\n2. Kinetics\n3. Exam 10 May 2026\n', '2025-09-01');
    expect(numbered.weeks).toEqual([]);
    expect(numbered.assessments).toHaveLength(1);
  });

  it('survives an empty page', () => {
    expect(parseSyllabus('', '2025-09-01')).toEqual({ weeks: [], assessments: [], termStart: null, unread: 0 });
  });
});

describe('the term plan as tasks', () => {
  const parsed = parseSyllabus(TERM, '2025-09-01');
  const tasks = syllabusToTasks(parsed, { subject: 'Physics', weeklyMinutes: 90 });

  it('makes one task per week plus one per assessment', () => {
    expect(tasks).toHaveLength(6);
    expect(tasks[0].title).toBe('Physics · Week 1: Introduction and units');
    expect(tasks[0].dueDate).toBe('2025-09-15');
    expect(tasks[0].estimatedMinutes).toBe(90);
    expect(tasks[0].category).toBe('learning');
  });

  it('gives a heavy assessment high priority and its weight in the note', () => {
    const final = tasks.find((task) => task.title.includes('Final exam'));
    expect(final?.priority).toBe('high');
    expect(final?.dueDate).toBe('2025-12-12');
    expect(final?.note).toContain('60');
  });

  it('leaves dates null when the syllabus never says when the term starts', () => {
    const undated = syllabusToTasks(parseSyllabus('Week 1: Intro\nWeek 2: More\n', '2025-09-01'));
    expect(undated.map((task) => task.dueDate)).toEqual([null, null]);
  });
});
