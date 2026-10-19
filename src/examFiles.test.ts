import { describe, expect, it } from 'vitest';
import {
  applyBulkAnswers,
  buildComposedExam,
  canUploadPapers,
  composerDraftError,
  emptyKeyQuestion,
  emptyPaperDraft,
  emptyTestDraft,
  emptyVariant,
  examHasAttempt,
  examKind,
  keylessExam,
  paperPhase,
  sanitizeExam,
  sanitizeExamFile,
  sanitizeExamSubmission,
  sanitizeExamVariant,
  scoreKeyQuestions,
  uploadDeadline,
  variantSummary,
  withQuestionCount,
} from './exams';
import { EXAM_UPLOAD_WINDOW_MIN } from './types';
import type { Exam, ExamFile, ExamSubmission } from './types';
import type { KeyQuestionDraft, TestExamDraft, VariantDraft } from './exams';

const now = new Date('2026-10-19T08:00:00.000Z');
const file = (over: Partial<ExamFile> = {}): ExamFile => ({
  url: 'https://res.cloudinary.test/encrypted.bin',
  publicId: 'planner-files/exam-question/link/0123456789abcdef01234567',
  name: 'midterm.pdf',
  mime: 'application/pdf',
  bytes: 1024,
  ...over,
});

describe('file and variant sanitizers', () => {
  it('drops malformed file pointers', () => {
    expect(sanitizeExamFile(null)).toBeNull();
    expect(sanitizeExamFile({ url: '', publicId: 'x', name: 'n', bytes: 1 })).toBeNull();
    expect(sanitizeExamFile({ url: 'u', publicId: 'p', name: 'n', bytes: 0 })).toBeNull();
    expect(sanitizeExamFile({ url: 'u', publicId: 'p', name: 'n', bytes: 5 })).toEqual({
      url: 'u',
      publicId: 'p',
      name: 'n',
      mime: 'application/octet-stream',
      bytes: 5,
    });
  });

  it('requires two options and keeps the answer in range', () => {
    const variant = sanitizeExamVariant({
      id: 'v1',
      label: 'A',
      file: file(),
      questions: [
        { id: 'q1', type: 'boolean', options: ['True', 'False'], answer: 1, points: 2 },
        { id: 'q2', type: 'single', options: ['only one'], answer: 0, points: 1 },
      ],
    });
    expect(variant?.questions).toHaveLength(1);
    expect(variant?.questions[0]?.answer).toBe(1);
  });
});

describe('exam sanitizer', () => {
  it('treats legacy exams as tests built on questions', () => {
    const legacy = sanitizeExam({
      id: 'e1',
      linkId: 'l1',
      title: 'Old',
      createdAt: now.toISOString(),
      questions: [{ id: 'q1', prompt: 'Pick', choices: ['a', 'b'], answer: 0, points: 1 }],
    });
    expect(legacy?.kind).toBe('test');
    expect(examKind(legacy!)).toBe('test');
    expect(legacy?.questions).toHaveLength(1);
  });

  it('accepts a paper exam only with a question file', () => {
    const good = sanitizeExam({
      id: 'e2',
      linkId: 'l1',
      title: 'Paper',
      createdAt: now.toISOString(),
      kind: 'paper',
      paperFile: file(),
      minutes: 60,
      uploadMinutes: 10,
      questions: [],
    });
    expect(good?.kind).toBe('paper');
    expect(good?.uploadMinutes).toBe(10);

    const bad = sanitizeExam({
      id: 'e3',
      linkId: 'l1',
      title: 'No file',
      createdAt: now.toISOString(),
      kind: 'paper',
      questions: [],
    });
    expect(bad).toBeNull();
  });

  it('clamps the upload window into its allowed range', () => {
    const exam = sanitizeExam({
      id: 'e4',
      linkId: 'l1',
      title: 'Window',
      createdAt: now.toISOString(),
      kind: 'paper',
      paperFile: file(),
      uploadMinutes: 999,
      questions: [],
    });
    expect(exam?.uploadMinutes).toBe(60);
  });
});

describe('composer drafts', () => {
  it('resizes question lists without losing existing answers', () => {
    const variant = emptyVariant('v1', 'A', 3);
    const answered = applyBulkAnswers(variant, [0, 1, 0]);
    const grown = withQuestionCount(answered, 5);
    expect(grown.questions).toHaveLength(5);
    expect(grown.questions[0]?.answer).toBe(0);
    expect(grown.questions[3]?.answer).toBeNull();
    const shrunk = withQuestionCount(grown, 2);
    expect(shrunk.questions).toHaveLength(2);
    expect(shrunk.questions[1]?.answer).toBe(1);
  });

  it('applies bulk answers in question order', () => {
    const variant = emptyVariant('v1', 'A', 3);
    const out = applyBulkAnswers(variant, [1, null, 0]);
    expect(out.questions.map((q) => q.answer)).toEqual([1, null, 0]);
  });

  it('requires a name, a file and a full answer key for test exams', () => {
    const draft = emptyTestDraft();
    expect(composerDraftError(draft)).toBeTruthy();
    const withFile: TestExamDraft = {
      ...draft,
      title: 'Midterm',
      variants: [{ ...draft.variants[0]!, file: file(), questions: [emptyKeyQuestion('q1')] }],
    };
    // No answer marked yet.
    expect(composerDraftError(withFile)).toContain('answer');
    const answered: TestExamDraft = {
      ...withFile,
      variants: [applyBulkAnswers(withFile.variants[0]!, [0])],
    };
    expect(composerDraftError(answered)).toBeNull();
  });

  it('rejects duplicate variant labels and missing paper files', () => {
    const base: VariantDraft = {
      ...emptyVariant('v1', 'A', 1),
      file: file(),
      questions: [emptyKeyQuestion('q1')],
    };
    const dup: TestExamDraft = {
      ...emptyTestDraft(),
      title: 'Two',
      variants: [
        applyBulkAnswers({ ...base, id: 'v1', label: 'Same' }, [0]),
        applyBulkAnswers({ ...base, id: 'v2', label: 'Same' }, [0]),
      ],
    };
    expect(composerDraftError(dup)).toContain('different');

    const paper = emptyPaperDraft();
    expect(composerDraftError({ ...paper, title: 'Paper', minutes: '45' })).toContain('file');
    expect(
      composerDraftError({ ...paper, title: 'Paper', minutes: '45', paperFile: file() }),
    ).toBeNull();
  });

  it('builds the full exam and strips the key for the student copy', () => {
    const variant = applyBulkAnswers(
      { ...emptyVariant('v1', 'A', 2), file: file() },
      [0, 1],
    );
    const draft: TestExamDraft = { ...emptyTestDraft(), title: 'Built', minutes: '30', variants: [variant] };
    const exam = buildComposedExam(draft, { id: 'e1', linkId: 'l1', author: 'Guard', now });
    expect(exam.kind).toBe('test');
    expect(exam.variants?.[0]?.questions[0]?.answer).toBe(0);
    const safe = keylessExam(exam);
    expect(safe.variants?.[0]?.questions.every((q) => q.answer === null)).toBe(true);
    expect(safe.variants?.[0]?.file).toEqual(file());
    expect(variantSummary(exam.variants![0]!)).toEqual({ questions: 2, points: 2 });
  });
});

describe('scoring', () => {
  const questions = [
    { id: 'q1', type: 'boolean' as const, options: ['True', 'False'], answer: 0, points: 2 },
    { id: 'q2', type: 'boolean' as const, options: ['True', 'False'], answer: 1, points: 3 },
    { id: 'q3', type: 'single' as const, options: ['a', 'b', 'c'], answer: 2, points: 5 },
  ];

  it('grades right, wrong and blank separately across the whole paper', () => {
    const score = scoreKeyQuestions(questions, { q1: 0, q2: 0 });
    expect(score).toMatchObject({ score: 2, total: 10, right: ['q1'], wrong: ['q2'], blank: ['q3'] });
  });

  it('gives full marks for a perfect paper', () => {
    const score = scoreKeyQuestions(questions, { q1: 0, q2: 1, q3: 2 });
    expect(score.score).toBe(10);
    expect(score.blank).toHaveLength(0);
  });
});

describe('paper exam timing', () => {
  const paper = (over: Partial<Exam> = {}): Exam => ({
    id: 'p1',
    linkId: 'l1',
    author: 'G',
    title: 'Paper exam',
    subject: '',
    note: '',
    minutes: 60,
    dueAt: null,
    questions: [],
    createdAt: now.toISOString(),
    kind: 'paper',
    paperFile: file(),
    uploadMinutes: EXAM_UPLOAD_WINDOW_MIN,
    ...over,
  });

  it('derives an upload deadline exactly exam time plus the window', () => {
    const started = '2026-10-19T08:00:00.000Z';
    const deadline = uploadDeadline(paper(), started)!;
    expect(new Date(deadline).getTime() - new Date(started).getTime()).toBe(70 * 60_000);
  });

  it('moves through sitting, upload, missed and submitted on wall time', () => {
    const started = '2026-10-19T08:00:00.000Z';
    const deadline = uploadDeadline(paper(), started)!;
    const t = new Date(started).getTime();
    const sitting = { startedAt: started, uploadDeadline: deadline, status: 'sitting' as const };
    expect(paperPhase(paper(), sitting, t + 30 * 60_000)).toBe('sitting');
    expect(paperPhase(paper(), sitting, t + 65 * 60_000)).toBe('upload');
    expect(paperPhase(paper(), sitting, t + 71 * 60_000)).toBe('missed');
    const submitted = { ...sitting, status: 'submitted' as const, files: [file()] };
    expect(paperPhase(paper(), submitted, t + 71 * 60_000)).toBe('submitted');
    const reviewed = { ...submitted, status: 'reviewed' as const, reviewedAt: new Date(t).toISOString() };
    expect(paperPhase(paper(), reviewed, t + 80 * 60_000)).toBe('reviewed');
  });

  it('only allows uploads inside the window unless a guardian re-grants one', () => {
    const started = '2026-10-19T08:00:00.000Z';
    const deadline = uploadDeadline(paper(), started)!;
    const t = new Date(started).getTime();
    const sitting = { startedAt: started, uploadDeadline: deadline, status: 'sitting' as const };
    expect(canUploadPapers(sitting, t + 65 * 60_000)).toBe(true);
    expect(canUploadPapers(sitting, t + 71 * 60_000)).toBe(false);
    const granted = { ...sitting, resubmitGrantedAt: new Date(t + 72 * 60_000).toISOString() };
    expect(canUploadPapers(granted, t + 75 * 60_000)).toBe(true);
  });
});

describe('one attempt, ever', () => {
  const base = (over: Partial<ExamSubmission>): ExamSubmission => ({
    id: 's1',
    examId: 'e1',
    linkId: 'l1',
    answers: {},
    written: {},
    score: 0,
    marked: 0,
    submittedAt: now.toISOString(),
    ...over,
  });

  it('locks the exam after a submission, including a missed one', () => {
    expect(examHasAttempt(undefined)).toBe(false);
    expect(examHasAttempt(base({ status: 'submitted' }))).toBe(true);
    expect(examHasAttempt(base({ status: 'missed' }))).toBe(true);
    expect(examHasAttempt(base({}))).toBe(true);
  });

  it('round-trips the new lifecycle fields through the sanitizer', () => {
    const clean = sanitizeExamSubmission({
      id: 's2',
      examId: 'e1',
      linkId: 'l1',
      submittedAt: now.toISOString(),
      status: 'uploading',
      kind: 'paper',
      variantId: 'v1',
      files: [file()],
      startedAt: now.toISOString(),
      uploadDeadline: now.toISOString(),
      late: true,
      maxScore: 100,
      resubmitGrantedAt: now.toISOString(),
    });
    expect(clean?.status).toBe('uploading');
    expect(clean?.late).toBe(true);
    expect(clean?.files).toHaveLength(1);
    expect(clean?.maxScore).toBe(100);
  });
});

// Touch the draft type so an unused-import regression fails the type check.
export type _DraftCheck = KeyQuestionDraft;
