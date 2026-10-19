// @vitest-environment node
/**
 * The synchronous half of the file-exam sitting lifecycle, with no network:
 * starting (one attempt, frozen variant, wall-clock deadline), answering,
 * missing the window, and handing answer files in — including the granted
 * re-upload path where the original draft has already been cleared.
 */
import { describe, expect, it } from 'vitest';
import { createEmptyState } from '../types';
import type { Exam, ExamFile, ExamSubmission, Panels } from '../types';
import { withStudentExamDraft } from '../exams';
import { beginExam, LinkError, markPaperMissed, submitPaperFiles, withExamAnswer } from './links';

const LINK = '11111111-2222-3333-4444-555555555555';

function file(suffix: string): ExamFile {
  return {
    url: `https://files.example/${suffix}.enc`,
    publicId: `planner-files/exam-question/${LINK}/${suffix}`,
    name: `${suffix}.pdf`,
    mime: 'application/pdf',
    bytes: 1024,
  };
}

function paperExam(): Exam {
  return {
    id: 'exam-paper-1',
    linkId: LINK,
    author: 'Guardian',
    title: 'Chemistry paper',
    subject: 'Chemistry',
    note: '',
    minutes: 30,
    dueAt: null,
    questions: [],
    createdAt: '2026-10-01T08:00:00.000Z',
    kind: 'paper',
    paperFile: file('paper-question'),
    uploadMinutes: 10,
  };
}

function testExam(): Exam {
  return {
    id: 'exam-test-1',
    linkId: LINK,
    author: 'Guardian',
    title: 'Physics test',
    subject: 'Physics',
    note: '',
    minutes: 20,
    dueAt: null,
    questions: [],
    createdAt: '2026-10-01T08:00:00.000Z',
    kind: 'test',
    variants: [
      {
        id: 'var-a',
        label: 'Variant A',
        file: file('test-a'),
        questions: [
          { id: 'q1', type: 'boolean', options: ['True', 'False'], answer: 0, points: 1 },
          { id: 'q2', type: 'single', options: ['One', 'Two', 'Three'], answer: 1, points: 2 },
        ],
      },
      {
        id: 'var-b',
        label: 'Variant B',
        file: file('test-b'),
        questions: [
          { id: 'q1', type: 'boolean', options: ['True', 'False'], answer: 1, points: 1 },
          { id: 'q2', type: 'single', options: ['Red', 'Blue'], answer: 0, points: 2 },
        ],
      },
    ],
  };
}

function panelsWith(exams: Exam[], submissions: ExamSubmission[] = []): Panels {
  const base = createEmptyState().panels;
  return {
    ...base,
    student: {
      ...base.student,
      enabled: true,
      inbox: { ...base.student.inbox, exams },
      examSubmissions: submissions,
    },
  };
}

const START = new Date('2026-10-05T09:00:00.000Z');
/** Paper deadline = start + (30 + 10) minutes = 09:40. */
const DEADLINE = new Date('2026-10-05T09:40:00.000Z');

describe('beginExam', () => {
  it('starts a paper sitting with a wall-clock upload deadline and keeps the same draft on reopen', () => {
    const first = beginExam(panelsWith([paperExam()]), 'exam-paper-1', START);
    const draft = first.panels.student.examDrafts?.['exam-paper-1'];
    expect(draft?.kind).toBe('paper');
    expect(draft?.startedAt).toBe(START.toISOString());
    expect(draft?.uploadDeadline).toBe(DEADLINE.toISOString());
    expect(draft?.phase).toBe('sitting');

    // Reopening continues the same sitting instead of minting a new clock.
    const second = beginExam(first.panels, 'exam-paper-1', new Date('2026-10-05T09:10:00.000Z'));
    expect(second.draft.startedAt).toBe(START.toISOString());
    expect(second.panels.student.examDrafts?.['exam-paper-1']?.uploadDeadline).toBe(DEADLINE.toISOString());
  });

  it('freezes the drawn variant for a test sitting', () => {
    const { panels, draft } = beginExam(panelsWith([testExam()]), 'exam-test-1', START);
    expect(['var-a', 'var-b']).toContain(draft.variantId);
    // Every reopen must hand back the same variant — a redraw would be a second
    // attempt wearing a different paper.
    const again = beginExam(panels, 'exam-test-1', START);
    expect(again.draft.variantId).toBe(draft.variantId);
  });

  it('refuses to start once any attempt is on record', () => {
    const sitting: ExamSubmission = {
      id: 'sitting-1',
      examId: 'exam-paper-1',
      linkId: LINK,
      answers: {},
      written: {},
      score: 0,
      marked: 0,
      submittedAt: DEADLINE.toISOString(),
      status: 'missed',
      kind: 'paper',
    };
    expect(() => beginExam(panelsWith([paperExam()], [sitting]), 'exam-paper-1')).toThrow(LinkError);
  });

  it('throws when the exam is gone from the inbox', () => {
    expect(() => beginExam(panelsWith([]), 'exam-ghost')).toThrow(LinkError);
  });
});

describe('withExamAnswer', () => {
  it('records answers into the persisted draft without touching anything else', () => {
    const { panels } = beginExam(panelsWith([testExam()]), 'exam-test-1', START);
    const answered = withExamAnswer(panels, 'exam-test-1', 'q1', 1);
    expect(answered.student.examDrafts?.['exam-test-1']?.answers.q1).toBe(1);
    // An answer for an exam with no draft is a no-op, not a crash.
    expect(withExamAnswer(panels, 'exam-unknown', 'q1', 1)).toBe(panels);
  });

  it('keeps pending answer files in the draft across panel updates', () => {
    const { panels, draft } = beginExam(panelsWith([paperExam()]), 'exam-paper-1', START);
    const pending = file('answer-1');
    const kept = withStudentExamDraft(panels, { ...draft, pendingFiles: [pending] });
    expect(kept.student.examDrafts?.['exam-paper-1']?.pendingFiles).toEqual([pending]);
  });
});

describe('paper hand-in and the missed window', () => {
  it('hands files in inside the window and clears the draft', () => {
    const begun = beginExam(panelsWith([paperExam()]), 'exam-paper-1', START).panels;
    const answer = file('answer-good');
    const handed = submitPaperFiles(begun, 'exam-paper-1', [answer], new Date('2026-10-05T09:35:00.000Z'));
    const sitting = handed.student.examSubmissions?.[0];
    expect(sitting?.status).toBe('submitted');
    expect(sitting?.late).toBe(false);
    expect(sitting?.files).toEqual([answer]);
    expect(handed.student.examDrafts?.['exam-paper-1']).toBeUndefined();
  });

  it('rejects a late hand-in with no guardian grant', () => {
    const begun = beginExam(panelsWith([paperExam()]), 'exam-paper-1', START).panels;
    expect(() => submitPaperFiles(begun, 'exam-paper-1', [file('answer-late')], new Date('2026-10-05T09:41:00.000Z'))).toThrow(LinkError);
  });

  it('refuses to hand in when no sitting was ever started', () => {
    expect(() => submitPaperFiles(panelsWith([paperExam()]), 'exam-paper-1', [file('answer-x')], START)).toThrow(LinkError);
  });

  it('files a miss once the window closes and removes the sitting draft', () => {
    const begun = beginExam(panelsWith([paperExam()]), 'exam-paper-1', START).panels;
    const missed = markPaperMissed(begun, 'exam-paper-1', new Date('2026-10-05T09:41:00.000Z'));
    const sitting = missed.student.examSubmissions?.[0];
    expect(sitting?.status).toBe('missed');
    expect(sitting?.late).toBe(true);
    expect(missed.student.examDrafts?.['exam-paper-1']).toBeUndefined();
    // A second miss must not manufacture a second submission.
    expect(markPaperMissed(missed, 'exam-paper-1')).toBe(missed);
  });

  it('accepts a granted re-upload after the miss, even though the draft is gone', () => {
    const begun = beginExam(panelsWith([paperExam()]), 'exam-paper-1', START).panels;
    const missedPanels = markPaperMissed(begun, 'exam-paper-1', new Date('2026-10-05T09:41:00.000Z'));
    const prior = missedPanels.student.examSubmissions?.[0];
    expect(prior).toBeDefined();
    const granted: ExamSubmission = { ...prior!, resubmitGrantedAt: '2026-10-05T10:00:00.000Z' };
    const withGrant = {
      ...missedPanels,
      student: { ...missedPanels.student, examSubmissions: [granted] },
    };

    const reupload = file('answer-second-attempt');
    const handed = submitPaperFiles(withGrant, 'exam-paper-1', [reupload], new Date('2026-10-05T10:05:00.000Z'));
    const sitting = handed.student.examSubmissions?.[0];
    expect(sitting?.id).toBe(granted.id);
    expect(sitting?.status).toBe('submitted');
    expect(sitting?.late).toBe(true);
    expect(sitting?.resubmitGrantedAt).toBe('2026-10-05T10:00:00.000Z');
    expect(sitting?.files).toEqual([reupload]);
  });

  it('never hands in an empty file list', () => {
    const begun = beginExam(panelsWith([paperExam()]), 'exam-paper-1', START).panels;
    expect(() => submitPaperFiles(begun, 'exam-paper-1', [], START)).toThrow(LinkError);
  });
});
