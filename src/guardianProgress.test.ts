import { describe, expect, it } from 'vitest';
import {
  acceptedGoalProgress,
  buildGuardianProgress,
  classProgressBySubject,
  homeworkProgress,
  markedTestResults,
  weeklyCompletionTrend,
} from './guardianProgress';
import type { GuardianLink, WeekResults } from './types';

function link(partial: Partial<GuardianLink> = {}): GuardianLink {
  return {
    id: 'row-1',
    username: 'sara',
    displayName: 'Sara',
    status: 'linked',
    history: [],
    linkId: 'link-1',
    code: null,
    wrappedShareKey: 'wrapped',
    results: null,
    plans: [],
    ...partial,
  };
}

function week(partial: Partial<WeekResults> = {}): WeekResults {
  return {
    weekOf: '2026-10-05',
    planned: 4,
    done: 2,
    focusMinutes: 60,
    subjects: [],
    headline: null,
    updatedAt: '',
    ...partial,
  };
}

describe('guardian progress summaries', () => {
  it('deduplicates weekly snapshots, sorts oldest first, and treats an empty week as neutral', () => {
    const summary = weeklyCompletionTrend(link({
      history: [
        week({ weekOf: '2026-10-12', planned: 0, done: 0 }),
        week({ weekOf: '2026-10-05', planned: 4, done: 1 }),
        week({ weekOf: '2026-10-05', planned: 4, done: 2 }),
      ],
      results: week({ weekOf: '2026-10-05', planned: 3, done: 4 }),
    }));

    expect(summary).toEqual([
      { weekOf: '2026-10-05', planned: 3, done: 4, percent: 100 },
      { weekOf: '2026-10-12', planned: 0, done: 0, percent: null },
    ]);
    expect(weeklyCompletionTrend(link({ history: [week()] }), 0)).toEqual([]);
    expect(weeklyCompletionTrend(link({ history: [week()] }), -4)).toEqual([]);
  });

  it('includes only marked test scores, clamps percentages, and orders them by submission date', () => {
    const summary = markedTestResults(link({
      exams: [
        { id: 'exam-1', linkId: 'link-1', author: 'Mum', title: 'Algebra quiz', subject: 'Maths', note: '', minutes: null, dueAt: null, questions: [], createdAt: '' },
        { id: 'exam-2', linkId: 'link-1', author: 'Mum', title: 'Spelling', subject: 'English', note: '', minutes: null, dueAt: null, questions: [], createdAt: '' },
      ],
      examResults: [
        { id: 'later', examId: 'exam-1', linkId: 'link-1', answers: {}, written: { q: 'private answer' }, score: 12, marked: 10, submittedAt: '2026-10-14T10:00:00Z' },
        { id: 'unmarked', examId: 'exam-2', linkId: 'link-1', answers: {}, written: {}, score: 0, marked: 0, submittedAt: '2026-10-15T10:00:00Z' },
        { id: 'earlier', examId: 'exam-2', linkId: 'link-1', answers: {}, written: {}, score: -2, marked: 10, submittedAt: '2026-10-10T10:00:00Z' },
      ],
    }));

    expect(summary.map(({ id, title, subject, percent }) => ({ id, title, subject, percent }))).toEqual([
      { id: 'earlier', title: 'Spelling', subject: 'English', percent: 0 },
      { id: 'later', title: 'Algebra quiz', subject: 'Maths', percent: 100 },
    ]);
    expect(markedTestResults(link({ examResults: [] }), 0)).toEqual([]);
  });

  it('classifies homework as approved, awaiting review, or not submitted', () => {
    const summary = homeworkProgress(link({
      homework: [
        { id: 'hw-1', linkId: 'link-1', author: 'Mum', title: 'One', instructions: '', subject: 'Maths', dueAt: null, createdAt: '' },
        { id: 'hw-2', linkId: 'link-1', author: 'Mum', title: 'Two', instructions: '', subject: 'English', dueAt: null, createdAt: '' },
        { id: 'hw-3', linkId: 'link-1', author: 'Mum', title: 'Three', instructions: '', subject: 'Maths', dueAt: null, createdAt: '' },
      ],
      homeworkSubmissions: [
        { id: 'sub-1', assignmentId: 'hw-2', linkId: 'link-1', photos: [], submittedAt: '', status: 'submitted', guardianNote: '', reviewedAt: null },
        { id: 'sub-2', assignmentId: 'hw-3', linkId: 'link-1', photos: [], submittedAt: '', status: 'submitted', guardianNote: '', reviewedAt: null },
        { id: 'sub-3', assignmentId: 'hw-3', linkId: 'link-1', photos: [], submittedAt: '', status: 'approved', guardianNote: '', reviewedAt: '' },
      ],
    }));

    expect(summary).toEqual({ assigned: 3, notSubmitted: 1, awaitingReview: 1, approved: 1 });
  });

  it('groups class completion by subject and counts only a completion timestamp', () => {
    const summary = classProgressBySubject(link({
      classes: [
        { id: 'class-1', linkId: 'link-1', author: 'Mum', title: 'Algebra', subject: ' Maths ', description: '', videoUrl: '', createdAt: '' },
        { id: 'class-2', linkId: 'link-1', author: 'Mum', title: 'Geometry', subject: 'Maths', description: '', videoUrl: '', createdAt: '' },
        { id: 'class-3', linkId: 'link-1', author: 'Mum', title: 'Essay', subject: 'English', description: '', videoUrl: '', createdAt: '' },
      ],
      classProgress: [
        { classId: 'class-1', linkId: 'link-1', completedAt: '2026-10-12T10:00:00Z', updatedAt: '' },
        { classId: 'class-2', linkId: 'link-1', completedAt: null, updatedAt: '2026-10-14T10:00:00Z' },
      ],
    }));

    expect(summary).toEqual([
      { subject: 'Maths', assigned: 2, completed: 1 },
      { subject: 'English', assigned: 1, completed: 0 },
    ]);
  });

  it('shows only accepted goal counts, clamps done to total, and omits zero-step goals', () => {
    const summary = acceptedGoalProgress(link({
      goals: [
        { id: 'goal-1', linkId: 'link-1', author: 'Mum', title: 'Revision', note: '', target: null, steps: ['private step'], createdAt: '' },
        { id: 'goal-2', linkId: 'link-1', author: 'Mum', title: 'Declined', note: '', target: null, steps: [], createdAt: '' },
        { id: 'goal-3', linkId: 'link-1', author: 'Mum', title: 'Empty', note: '', target: null, steps: [], createdAt: '' },
      ],
      goalAnswers: [
        { suggestionId: 'goal-1', state: 'accepted', done: 7, total: 3, updatedAt: '2026-10-15T10:00:00Z' },
        { suggestionId: 'goal-2', state: 'declined', done: 0, total: 2, updatedAt: '2026-10-14T10:00:00Z' },
        { suggestionId: 'goal-3', state: 'accepted', done: 0, total: 0, updatedAt: '2026-10-13T10:00:00Z' },
      ],
    }));

    expect(summary).toEqual([
      { id: 'goal-1', title: 'Revision', done: 3, total: 3, updatedAt: '2026-10-15T10:00:00Z' },
    ]);
  });

  it('builds a compact dashboard summary from only the guardian link', () => {
    const summary = buildGuardianProgress(link({ history: [week()] }));
    expect(summary.weeks).toHaveLength(1);
    expect(summary.tests).toEqual([]);
    expect(summary.homework.assigned).toBe(0);
    expect(summary.classes).toEqual([]);
    expect(summary.goals).toEqual([]);
  });
});
