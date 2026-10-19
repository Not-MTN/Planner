import { describe, expect, it } from 'vitest';
import {
  buildExamQuestions,
  cleanChoices,
  draftExamSummary,
  emptyExamDraft,
  emptyExamQuestion,
  examDraftError,
  examOpen,
  examProgress,
  examReview,
  isWrittenQuestion,
  mergeExamSubmissions,
  mergeExams,
  openExamCount,
  sanitizeExam,
  scoreExam,
  submissionFor,
  submitExam,
  withGuardianExamResult,
  withLinkExam,
  withStudentExamSubmission,
  withoutLinkExam,
} from './exams';
import { createEmptyState } from './types';
import type { Exam, ExamSubmission, Panels } from './types';

const at = '2026-05-04T08:00:00.000Z';

/** A draft the way a guardian writes one: two options and one written answer. */
const draft = () => ({
  ...emptyExamDraft(),
  title: 'The midterm, chapter four',
  subject: 'Chemistry',
  questions: [
    { ...emptyExamQuestion('q1'), prompt: 'Which one is an acid?', choices: ['HCl', 'NaOH'], answer: 0, points: '2' },
    { ...emptyExamQuestion('q2'), prompt: 'Name the reaction.', points: '3' },
  ],
});

const exam = (): Exam => ({
  id: 'exam-1',
  linkId: 'link-1',
  author: 'Mum',
  title: 'The midterm, chapter four',
  subject: 'Chemistry',
  note: '',
  minutes: 30,
  dueAt: null,
  questions: buildExamQuestions(draft()),
  createdAt: at,
});

const panels = (): Panels => createEmptyState().panels;

describe('an exam as the guardian writes it', () => {
  it('needs a name and at least one question', () => {
    expect(examDraftError(emptyExamDraft())).toMatch(/name/i);
    expect(examDraftError({ ...draft(), questions: [] })).toMatch(/at least one question/i);
  });

  it('refuses a question with words missing, rather than sending a blank one', () => {
    const withBlank = { ...draft(), questions: [...draft().questions, { ...emptyExamQuestion('q3'), choices: ['a', 'b'] }] };
    expect(examDraftError(withBlank)).toMatch(/words/i);
  });

  it('refuses one option, and an option list with no right answer marked', () => {
    const oneChoice = {
      ...draft(),
      questions: [{ ...emptyExamQuestion('q1'), prompt: 'Only one option', choices: ['Just this'], answer: null }],
    };
    expect(examDraftError(oneChoice)).toMatch(/two options/i);
    const unmarked = {
      ...draft(),
      questions: [{ ...emptyExamQuestion('q1'), prompt: 'Which one?', choices: ['a', 'b'], answer: null }],
    };
    expect(examDraftError(unmarked)).toMatch(/right answer/i);
  });

  it('refuses nonsense numbers', () => {
    expect(examDraftError({ ...draft(), minutes: '0' })).toMatch(/600 minutes/i);
    expect(
      examDraftError({
        ...draft(),
        questions: [{ ...emptyExamQuestion('q1'), prompt: 'Which?', choices: ['a', 'b'], answer: 1, points: '900' }],
      }),
    ).toMatch(/100 points/i);
  });

  it('accepts what it was given', () => {
    expect(examDraftError(draft())).toBeNull();
  });

  it('drops the empty options and the questions with no words', () => {
    const built = buildExamQuestions({
      ...draft(),
      questions: [
        { ...emptyExamQuestion('q1'), prompt: 'Which?', choices: ['a', '', 'b', '   '], answer: 0, points: '2' },
        { ...emptyExamQuestion('q2'), prompt: '   ', choices: ['a', 'b'], answer: 1 },
      ],
    });
    expect(built).toHaveLength(1);
    expect(built[0]?.choices).toEqual(['a', 'b']);
  });

  it('reads a question with no options as a written one', () => {
    expect(isWrittenQuestion({ choices: [] })).toBe(true);
    expect(isWrittenQuestion({ choices: ['', '   '] })).toBe(true);
    expect(isWrittenQuestion({ choices: ['a', 'b'] })).toBe(false);
    expect(cleanChoices({ choices: ['a', ' ', 'b'] })).toEqual(['a', 'b']);
  });

  it('drops a malformed exam rather than guessing at it', () => {
    expect(sanitizeExam(null)).toBeNull();
    expect(sanitizeExam({ ...exam(), questions: [] })).toBeNull();
    expect(sanitizeExam(exam())?.title).toBe('The midterm, chapter four');
  });
});

describe('marking', () => {
  it('marks only what can be marked, and says so', () => {
    const score = scoreExam(exam(), { q1: 0 });
    expect(score.score).toBe(2);
    expect(score.marked).toBe(2);
    // The written answer is not counted as wrong: nobody has read it yet.
    expect(score.total).toBe(5);
    expect(score.unmarked).toBe(1);
    expect(score.right).toEqual(['q1']);
  });

  it('counts a wrong answer as wrong', () => {
    const score = scoreExam(exam(), { q1: 1 });
    expect(score.score).toBe(0);
    expect(score.wrong).toEqual(['q1']);
  });

  it('counts an unanswered choice question as wrong, and a written one as unread', () => {
    const score = scoreExam(exam(), {});
    expect(score.score).toBe(0);
    expect(score.marked).toBe(2);
    expect(score.unmarked).toBe(1);
  });

  it('carries the score on the sitting, so both sides read the same number', () => {
    const sitting = submitExam(exam(), { answers: { q1: 0 }, written: { q2: 'Neutralisation.' } }, new Date(at));
    expect(sitting.score).toBe(2);
    expect(sitting.marked).toBe(2);
    expect(sitting.written).toEqual({ q2: 'Neutralisation.' });
    expect(sitting.examId).toBe('exam-1');
    expect(sitting.linkId).toBe('link-1');
  });

  it('does not carry a choice that is not on the question', () => {
    const sitting = submitExam(exam(), { answers: { q1: 9 }, written: {} }, new Date(at));
    expect(sitting.answers.q1).toBeUndefined();
    expect(sitting.score).toBe(0);
  });
});

describe('what stays and what goes', () => {
  it('lists the newest exam first', () => {
    const older = { ...exam(), id: 'exam-0', createdAt: '2026-05-01T08:00:00.000Z' };
    expect(mergeExams([older], [exam()]).map((item) => item.id)).toEqual(['exam-1', 'exam-0']);
  });

  it('keeps one sitting per exam, and keeps words that have arrived', () => {
    const first = submitExam(exam(), { answers: { q1: 0 }, written: {} }, new Date(at));
    const reviewed: ExamSubmission = { ...first, feedback: 'Look at the second step.', reviewedAt: at };
    const merged = mergeExamSubmissions([reviewed], [first]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.feedback).toBe('Look at the second step.');
  });

  it('moves a missed sitting to submitted when the granted re-upload arrives, in either merge order', () => {
    const missed: ExamSubmission = {
      id: 'sitting-1', examId: 'exam-1', linkId: 'link-1', answers: {}, written: {},
      score: 0, marked: 0, submittedAt: at, status: 'missed', kind: 'paper', files: [], late: true,
      resubmitGrantedAt: at,
    };
    const reupload: ExamSubmission = {
      ...missed,
      status: 'submitted',
      files: [{ url: 'u', publicId: 'p', name: 'a.pdf', mime: 'application/pdf', bytes: 9 }],
    };
    expect(mergeExamSubmissions([missed], [reupload])[0]?.status).toBe('submitted');
    expect(mergeExamSubmissions([reupload], [missed])[0]?.status).toBe('submitted');
    // And a later review still wins over both.
    const reviewed: ExamSubmission = { ...reupload, status: 'reviewed', reviewedAt: at };
    expect(mergeExamSubmissions([missed], [reviewed])[0]?.status).toBe('reviewed');
  });

  it('finds the sitting for one exam', () => {
    const sitting = submitExam(exam(), { answers: {}, written: {} }, new Date(at));
    expect(submissionFor([sitting], 'exam-1')?.id).toBe(sitting.id);
    expect(submissionFor([sitting], 'exam-2')).toBeUndefined();
  });

  it('closes an exam once it is handed in, or once its day has passed', () => {
    const sitting = submitExam(exam(), { answers: {}, written: {} }, new Date(at));
    expect(examOpen(exam(), [], '2026-05-04')).toBe(true);
    expect(examOpen(exam(), [sitting], '2026-05-04')).toBe(false);
    expect(examOpen({ ...exam(), dueAt: '2026-05-03' }, [], '2026-05-04')).toBe(false);
    expect(openExamCount([exam()], [], '2026-05-04')).toBe(1);
    expect(openExamCount([exam()], [sitting], '2026-05-04')).toBe(0);
  });
});

describe('what the panels hold', () => {
  it('puts a sent exam on the link it was sent to', () => {
    const withLink: Panels = {
      ...panels(),
      guardian: {
        ...panels().guardian,
        links: [{ ...createEmptyState().panels.guardian.links[0]!, linkId: 'link-1' }],
      },
    };
    expect(withLinkExam(withLink, 'link-1', exam()).guardian.links[0]?.exams).toHaveLength(1);
    expect(withoutLinkExam(withLinkExam(withLink, 'link-1', exam()), 'link-1', 'exam-1').guardian.links[0]?.exams).toHaveLength(0);
  });

  it('keeps a handed-in exam on the student’s side', () => {
    const sitting = submitExam(exam(), { answers: { q1: 0 }, written: {} }, new Date(at));
    expect(withStudentExamSubmission(panels(), sitting).student.examSubmissions).toHaveLength(1);
  });

  it('lands a handed-in exam on the link it came from', () => {
    const withLink: Panels = {
      ...panels(),
      guardian: {
        ...panels().guardian,
        links: [
          { ...createEmptyState().panels.guardian.links[0]!, linkId: 'link-1' },
          { ...createEmptyState().panels.guardian.links[0]!, id: 'link-2', linkId: 'link-2' },
        ],
      },
    };
    const sitting = submitExam(exam(), { answers: {}, written: {} }, new Date(at));
    const next = withGuardianExamResult(withLink, sitting);
    expect(next.guardian.links[0]?.examResults).toHaveLength(1);
    // The other student's record is untouched.
    expect(next.guardian.links[1]?.examResults ?? []).toHaveLength(0);
  });
});

describe('reading an exam back, question by question', () => {
  const sitting = () =>
    submitExam(exam(), { answers: { q1: 1 }, written: { q2: 'Neutralisation.' } }, new Date(at));

  it('says which were right and which were wrong, by question', () => {
    const review = examReview(exam(), sitting());
    expect(review.map((item) => item.verdict)).toEqual(['wrong', null]);
    expect(review[0]?.chosen).toBe(1);
    expect(review[0]?.correct).toBe(0);
    expect(review[0]?.earned).toBe(0);
  });

  it('leaves a written answer unmarked rather than calling it wrong', () => {
    const written = examReview(exam(), sitting())[1];
    expect(written?.verdict).toBeNull();
    expect(written?.earned).toBeNull();
    expect(written?.written).toBe('Neutralisation.');
  });

  it('carries the options and the key, so either side can show the right one', () => {
    const first = examReview(exam(), sitting())[0];
    expect(first?.choices).toEqual(['HCl', 'NaOH']);
    expect(first?.prompt).toBe('Which one is an acid?');
  });

  it('counts a right answer as its points', () => {
    const right = submitExam(exam(), { answers: { q1: 0 }, written: {} }, new Date(at));
    expect(examReview(exam(), right)[0]?.earned).toBe(2);
  });
});

describe('how much of an exam is filled in', () => {
  it('names the questions still blank, in the order they are asked', () => {
    expect(examProgress(exam(), {}, {}).blanks).toEqual(['q1', 'q2']);
    expect(examProgress(exam(), { q1: 0 }, {}).blanks).toEqual(['q2']);
    expect(examProgress(exam(), { q1: 0 }, { q2: 'something' }).blanks).toEqual([]);
  });

  it('does not count spaces as an answer', () => {
    expect(examProgress(exam(), {}, { q2: '   ' }).answered).toBe(0);
  });

  it('counts up to the whole exam', () => {
    expect(examProgress(exam(), { q1: 0 }, { q2: 'x' })).toMatchObject({ answered: 2, total: 2 });
  });
});

describe('what the guardian is about to send', () => {
  it('counts the questions, their points, and how many are written', () => {
    expect(draftExamSummary(draft())).toEqual({ questions: 2, points: 5, written: 1 });
  });

  it('counts only the questions that have words', () => {
    expect(draftExamSummary({ ...draft(), questions: [...draft().questions, emptyExamQuestion('q3')] })).toEqual({
      questions: 2,
      points: 5,
      written: 1,
    });
  });

  it('treats nonsense points as one rather than as nothing', () => {
    const odd = {
      ...draft(),
      questions: [{ ...emptyExamQuestion('q1'), prompt: 'Which?', choices: ['a', 'b'], answer: 0, points: 'abc' }],
    };
    expect(draftExamSummary(odd).points).toBe(1);
  });
});

describe('a fresh draft', () => {
  it('opens with a question already on the page', () => {
    expect(emptyExamDraft().questions).toHaveLength(1);
  });

  it('opens with two empty options, so it reads as written until one is typed', () => {
    expect(emptyExamQuestion('q1').choices).toEqual(['', '']);
    expect(isWrittenQuestion(emptyExamQuestion('q1'))).toBe(true);
  });
});
