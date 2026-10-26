import { describe, expect, it } from 'vitest';
import { buildGuardianReview } from './guardianReview';
import { createEmptyState, type GuardianLink, type PlanItem } from './types';

function link(partial: Partial<GuardianLink>): GuardianLink {
  return {
    id: 'row-1',
    username: 'sara',
    displayName: 'Sara',
    status: 'linked',
    linkId: 'link-1',
    code: null,
    wrappedShareKey: 'wrapped',
    history: [],
    results: null,
    plans: [],
    ...partial,
  };
}

function item(partial: Partial<PlanItem>): PlanItem {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Lesson',
    date: '2026-10-20',
    time: null,
    end: null,
    minutes: null,
    subject: null,
    url: null,
    done: false,
    ...partial,
  };
}

describe('buildGuardianReview', () => {
  it('counts planned and done lessons with their minutes per subject', () => {
    const summary = buildGuardianReview(
      link({
        plans: [
          {
            id: 'plan-1', author: 'Mum', linkId: 'link-1', cadence: 'week', start: '2026-10-18',
            title: 'Week', note: '', items: [
              item({ title: 'Algebra', subject: 'Maths', minutes: 60, done: true }),
              item({ title: 'Geometry', subject: 'Maths', minutes: 30, done: false }),
              item({ title: 'Reading', subject: 'English', minutes: 20, done: true }),
            ],
            createdAt: '', updatedAt: '',
          },
        ],
      }),
      'all',
      '2026-10-22',
    );
    const maths = summary.subjects.find((entry) => entry.name === 'Maths')!;
    expect(maths.lessonsPlanned).toBe(2);
    expect(maths.lessonsDone).toBe(1);
    expect(maths.plannedMinutes).toBe(90);
    const english = summary.subjects.find((entry) => entry.name === 'English')!;
    expect(english.lessonsDone).toBe(1);
    expect(summary.lessonsPlanned).toBe(3);
    expect(summary.lessonsDone).toBe(2);
    expect(summary.completion).toBeCloseTo(2 / 3);
  });

  it('folds focus minutes from shared weekly results into the matching subject', () => {
    const summary = buildGuardianReview(
      link({
        results: {
          weekOf: '2026-10-18', planned: 1, done: 1, focusMinutes: 90,
          subjects: [{ name: 'Maths', minutes: 90 }], headline: null, updatedAt: '',
        },
      }),
      'all',
      '2026-10-22',
    );
    expect(summary.focusMinutes).toBe(90);
    expect(summary.subjects[0]?.name).toBe('Maths');
    expect(summary.subjects[0]?.focusMinutes).toBe(90);
  });

  it('reports tests set, sittings, average score and homework status', () => {
    const summary = buildGuardianReview(
      link({
        exams: [
          { id: 'exam-1', linkId: 'link-1', author: 'Mum', title: 'Quiz', subject: 'Maths', note: '', minutes: null, dueAt: null, questions: [], createdAt: '' },
          { id: 'exam-2', linkId: 'link-1', author: 'Mum', title: 'Spelling', subject: 'English', note: '', minutes: null, dueAt: null, questions: [], createdAt: '' },
        ],
        examResults: [
          { id: 's1', examId: 'exam-1', linkId: 'link-1', answers: {}, written: {}, score: 8, marked: 10, submittedAt: '', status: 'reviewed' },
          { id: 's2', examId: 'exam-1', linkId: 'link-1', answers: {}, written: {}, score: 6, marked: 10, submittedAt: '', status: 'submitted' },
        ],
        homework: [
          { id: 'hw-1', linkId: 'link-1', author: 'Mum', title: 'Worksheet', instructions: '', subject: 'Maths', dueAt: null, createdAt: '' },
          { id: 'hw-2', linkId: 'link-1', author: 'Mum', title: 'Essay', instructions: '', subject: 'English', dueAt: null, createdAt: '' },
        ],
        homeworkSubmissions: [
          { id: 'sub-1', assignmentId: 'hw-1', linkId: 'link-1', photos: [], submittedAt: '', status: 'approved', guardianNote: '', reviewedAt: '' },
        ],
      }),
      'all',
      '2026-10-22',
    );
    const maths = summary.subjects.find((entry) => entry.name === 'Maths')!;
    expect(maths.testsSet).toBe(1);
    expect(maths.testsTaken).toBe(2);
    expect(maths.averageScore).toBe(70);
    expect(maths.homeworkSet).toBe(1);
    expect(maths.homeworkSubmitted).toBe(1);
    expect(maths.homeworkApproved).toBe(1);
    expect(maths.homeworkPending).toBe(0);
    const english = summary.subjects.find((entry) => entry.name === 'English')!;
    expect(english.homeworkPending).toBe(1);
    expect(summary.testsSet).toBe(2);
    expect(summary.testsTaken).toBe(2);
  });

  it('does not double-count homework/test plan items as lessons', () => {
    const summary = buildGuardianReview(
      link({
        plans: [
          {
            id: 'plan-1', author: 'Mum', linkId: 'link-1', cadence: 'week', start: '2026-10-18',
            title: 'Week', note: '', items: [
              item({ title: 'Worksheet', kind: 'homework', refId: 'hw-1', subject: 'Maths' }),
              item({ title: 'Quiz', kind: 'test', refId: 'exam-1', subject: 'Maths' }),
              item({ title: 'Algebra', subject: 'Maths', done: true }),
            ],
            createdAt: '', updatedAt: '',
          },
        ],
      }),
      'all',
      '2026-10-22',
    );
    expect(summary.lessonsPlanned).toBe(1);
  });

  it('works on an empty link', () => {
    const summary = buildGuardianReview(link({}), 'all', '2026-10-22');
    expect(summary.subjects).toEqual([]);
    expect(summary.completion).toBeNull();
    expect(createEmptyState().panels.guardian.enabled).toBe(false);
  });
});
