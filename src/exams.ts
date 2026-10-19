/**
 * Exams a guardian sets and a student sits.
 *
 * A guardian writes the questions once; the student sits the exam in their own
 * panel, on their own device, whenever they are ready. Choice questions are
 * marked the moment they are handed in — the student sees the score at once,
 * which is the only way a number like that is useful — and written answers are
 * left for the guardian to read and answer in words. A question with no marked
 * answer is never counted as wrong: it is left out of the score and the panel
 * says how much was left out.
 *
 * Everything here is pure and local. What travels over the encrypted link is
 * decided in `auth/links.ts`; these are the shapes both sides agree on first.
 */
import { todayISO } from './dates';
import { t } from './i18n';
import {
  EXAM_CHOICES_MAX,
  EXAM_CHOICE_MAX,
  EXAM_QUESTIONS_MAX,
  EXAM_PROMPT_MAX,
  EXAM_RESULTS_KEPT,
  EXAM_TITLE_MAX,
  EXAM_NOTE_MAX,
  EXAM_WRITTEN_MAX,
  EXAM_FEEDBACK_MAX,
  EXAMS_KEPT,
  EXAM_VARIANTS_MAX,
  EXAM_FILES_MAX,
  EXAM_UPLOAD_MIN_MIN,
  EXAM_UPLOAD_MIN_MAX,
  EXAM_UPLOAD_WINDOW_MIN,
  EXAM_VARIANT_LABEL_MAX,
  EXAM_POINTS_MAX,
} from './types';
import type {
  Exam,
  ExamFile,
  ExamKeyQuestion,
  ExamKind,
  ExamQuestion,
  ExamSittingStatus,
  ExamSubmission,
  ExamVariant,
  Panels,
  StudentExamDraft,
} from './types';

const ID_MAX = 80;
const LINK_MAX = 64;
const FILE_NAME_MAX = 180;
const SITTING_STATUSES: ExamSittingStatus[] = ['sitting', 'uploading', 'submitted', 'missed', 'reviewed'];

/** Which kind an exam is, treating everything sent before the split as a test. */
export function examKind(exam: Exam): ExamKind {
  return exam.kind === 'paper' ? 'paper' : 'test';
}

/** An encrypted file pointer as the wire carries it. Malformed ones are dropped. */
export function sanitizeExamFile(value: unknown): ExamFile | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url.trim().slice(0, 2048) : '';
  const publicId = typeof raw.publicId === 'string' ? raw.publicId.trim().slice(0, 240) : '';
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, FILE_NAME_MAX) : '';
  const mime = typeof raw.mime === 'string' ? raw.mime.trim().slice(0, 160) : '';
  const bytes = typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? Math.max(0, Math.round(raw.bytes)) : 0;
  if (!url || !publicId || !name || bytes <= 0) return null;
  return { url, publicId, name, mime: mime || 'application/octet-stream', bytes };
}

/** One graded question (multiple choice or true/false) as the wire carries it. */
export function sanitizeExamKeyQuestion(value: unknown): ExamKeyQuestion | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, ID_MAX);
  if (!id) return null;
  const type = raw.type === 'boolean' ? 'boolean' : 'single';
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .flatMap((option) => {
      const clean = text(option, EXAM_CHOICE_MAX);
      return clean ? [clean] : [];
    })
    .slice(0, EXAM_CHOICES_MAX);
  const answer =
    typeof raw.answer === 'number' && Number.isInteger(raw.answer) && raw.answer >= 0 && raw.answer < options.length
      ? raw.answer
      : null;
  const points =
    typeof raw.points === 'number' && Number.isFinite(raw.points)
      ? Math.max(1, Math.min(EXAM_POINTS_MAX, Math.round(raw.points)))
      : 1;
  if (options.length < 2) return null;
  return { id, type, options, answer, points };
}

/** One test variant as the wire carries it. */
export function sanitizeExamVariant(value: unknown): ExamVariant | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, ID_MAX);
  if (!id) return null;
  const label = text(raw.label, EXAM_VARIANT_LABEL_MAX) || id.slice(0, 12);
  const file = sanitizeExamFile(raw.file);
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .flatMap((question) => {
      const clean = sanitizeExamKeyQuestion(question);
      return clean ? [clean] : [];
    })
    .slice(0, EXAM_QUESTIONS_MAX);
  if (questions.length === 0) return null;
  return { id, label, file, questions };
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

/** One question as the wire carries it. A malformed one is dropped, not guessed at. */
export function sanitizeExamQuestion(value: unknown): ExamQuestion | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, ID_MAX);
  const prompt = text(raw.prompt, EXAM_PROMPT_MAX);
  if (!id || !prompt) return null;
  const choices = (Array.isArray(raw.choices) ? raw.choices : [])
    .flatMap((choice) => {
      const clean = text(choice, EXAM_CHOICE_MAX);
      return clean ? [clean] : [];
    })
    .slice(0, EXAM_CHOICES_MAX);
  const points =
    typeof raw.points === 'number' && Number.isFinite(raw.points)
      ? Math.max(1, Math.min(100, Math.round(raw.points)))
      : 1;
  const written = choices.length === 0;
  const answer =
    typeof raw.answer === 'number' && Number.isInteger(raw.answer) && raw.answer >= 0 && raw.answer < choices.length
      ? raw.answer
      : null;
  // A choice question with no answer marked cannot be marked on the way back,
  // so it is read as a written one rather than silently scoring everyone wrong.
  if (!written && answer === null) return { id, prompt, choices, answer: null, points };
  return { id, prompt, choices: written ? [] : choices, answer: written ? null : answer, points };
}

/** An exam as the wire carries it. */
export function sanitizeExam(value: unknown): Exam | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, ID_MAX);
  const linkId = text(raw.linkId, LINK_MAX);
  const title = text(raw.title, EXAM_TITLE_MAX);
  const createdAt = timestamp(raw.createdAt);
  if (!id || !linkId || !title || !createdAt) return null;
  const kind: ExamKind = raw.kind === 'paper' ? 'paper' : 'test';
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .flatMap((question) => {
      const clean = sanitizeExamQuestion(question);
      return clean ? [clean] : [];
    })
    .slice(0, EXAM_QUESTIONS_MAX);
  const minutes =
    typeof raw.minutes === 'number' && Number.isFinite(raw.minutes)
      ? Math.max(1, Math.min(600, Math.round(raw.minutes)))
      : null;
  const dueAt = raw.dueAt === null || raw.dueAt === undefined || raw.dueAt === '' ? null : timestamp(raw.dueAt);
  if (raw.dueAt && !dueAt) return null;
  const variants = (Array.isArray(raw.variants) ? raw.variants : [])
    .flatMap((variant) => {
      const clean = sanitizeExamVariant(variant);
      return clean ? [clean] : [];
    })
    .slice(0, EXAM_VARIANTS_MAX);
  const paperFile = raw.paperFile === null || raw.paperFile === undefined ? null : sanitizeExamFile(raw.paperFile);
  const uploadMinutes =
    typeof raw.uploadMinutes === 'number' && Number.isFinite(raw.uploadMinutes)
      ? Math.max(EXAM_UPLOAD_MIN_MIN, Math.min(EXAM_UPLOAD_MIN_MAX, Math.round(raw.uploadMinutes)))
      : null;
  // A new-style exam is valid through its variants (test) or its paper file;
  // legacy exams remain valid through `questions` alone.
  if (kind === 'test' && questions.length === 0 && variants.length === 0) return null;
  if (kind === 'paper' && !paperFile) return null;
  return {
    id,
    linkId,
    author: text(raw.author, 60),
    title,
    subject: text(raw.subject, 60),
    note: text(raw.note, EXAM_NOTE_MAX),
    minutes,
    dueAt,
    questions,
    createdAt,
    kind,
    variants,
    paperFile,
    uploadMinutes,
  };
}

/** One sitting as the wire carries it. */
export function sanitizeExamSubmission(value: unknown): ExamSubmission | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, ID_MAX);
  const examId = text(raw.examId, ID_MAX);
  const linkId = text(raw.linkId, LINK_MAX);
  const submittedAt = timestamp(raw.submittedAt);
  if (!id || !examId || !linkId || !submittedAt) return null;
  const answers: Record<string, number> = {};
  const rawAnswers = raw.answers;
  if (rawAnswers && typeof rawAnswers === 'object') {
    for (const [key, value] of Object.entries(rawAnswers as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < EXAM_CHOICES_MAX) {
        answers[key.slice(0, ID_MAX)] = value;
      }
    }
  }
  const written: Record<string, string> = {};
  const rawWritten = raw.written;
  if (rawWritten && typeof rawWritten === 'object') {
    for (const [key, value] of Object.entries(rawWritten as Record<string, unknown>)) {
      const clean = text(value, EXAM_WRITTEN_MAX);
      if (clean) written[key.slice(0, ID_MAX)] = clean;
    }
  }
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .flatMap((file) => {
      const clean = sanitizeExamFile(file);
      return clean ? [clean] : [];
    })
    .slice(0, EXAM_FILES_MAX);
  const status =
    typeof raw.status === 'string' && SITTING_STATUSES.includes(raw.status as ExamSittingStatus)
      ? (raw.status as ExamSittingStatus)
      : undefined;
  return {
    id,
    examId,
    linkId,
    answers,
    written,
    score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? Math.max(0, Math.round(raw.score)) : 0,
    marked: typeof raw.marked === 'number' && Number.isFinite(raw.marked) ? Math.max(0, Math.round(raw.marked)) : 0,
    submittedAt,
    feedback: text(raw.feedback, EXAM_FEEDBACK_MAX),
    reviewedAt: raw.reviewedAt === null || raw.reviewedAt === undefined ? null : timestamp(raw.reviewedAt),
    status,
    kind: raw.kind === 'paper' ? 'paper' : raw.kind === 'test' ? 'test' : undefined,
    variantId: typeof raw.variantId === 'string' ? raw.variantId.slice(0, ID_MAX) : null,
    files,
    startedAt: raw.startedAt === null || raw.startedAt === undefined ? null : timestamp(raw.startedAt),
    uploadDeadline:
      raw.uploadDeadline === null || raw.uploadDeadline === undefined ? null : timestamp(raw.uploadDeadline),
    late: raw.late === true,
    maxScore:
      typeof raw.maxScore === 'number' && Number.isFinite(raw.maxScore)
        ? Math.max(0, Math.min(10_000, Math.round(raw.maxScore)))
        : null,
    resubmitGrantedAt:
      raw.resubmitGrantedAt === null || raw.resubmitGrantedAt === undefined ? null : timestamp(raw.resubmitGrantedAt),
    keyReleasedAt:
      raw.keyReleasedAt === null || raw.keyReleasedAt === undefined ? null : timestamp(raw.keyReleasedAt),
    right: idList(raw.right),
    wrong: idList(raw.wrong),
    blank: idList(raw.blank),
  };
}

/** A string-array field of question ids, bounded and stripped of junk. */
function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.slice(0, ID_MAX))
    .slice(0, EXAM_QUESTIONS_MAX);
}

/**
 * A persisted in-progress sitting. Drafts never leave the device, but they do
 * round-trip through local storage, so a reloaded app must get back exactly the
 * clock, variant and uploads the student had — never a fresh start.
 */
export function sanitizeStudentExamDraft(value: unknown): StudentExamDraft | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const examId = text(raw.examId, ID_MAX);
  const linkId = text(raw.linkId, LINK_MAX);
  const startedAt = timestamp(raw.startedAt);
  if (!examId || !linkId || !startedAt) return null;
  const answers: Record<string, number> = {};
  if (raw.answers && typeof raw.answers === 'object') {
    for (const [key, choice] of Object.entries(raw.answers as Record<string, unknown>)) {
      if (typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < EXAM_CHOICES_MAX) {
        answers[key.slice(0, ID_MAX)] = choice;
      }
    }
  }
  const pendingFiles = (Array.isArray(raw.pendingFiles) ? raw.pendingFiles : [])
    .flatMap((file) => {
      const clean = sanitizeExamFile(file);
      return clean ? [clean] : [];
    })
    .slice(0, EXAM_FILES_MAX);
  return {
    examId,
    linkId,
    kind: raw.kind === 'paper' ? 'paper' : 'test',
    startedAt,
    answers,
    variantId: typeof raw.variantId === 'string' ? raw.variantId.slice(0, ID_MAX) : null,
    uploadDeadline:
      raw.uploadDeadline === null || raw.uploadDeadline === undefined ? null : timestamp(raw.uploadDeadline),
    phase:
      typeof raw.phase === 'string' && SITTING_STATUSES.includes(raw.phase as ExamSittingStatus)
        ? (raw.phase as ExamSittingStatus)
        : 'sitting',
    pendingFiles,
  };
}

/* ------------------------------------------------------------------ building */

export interface ExamQuestionDraft {
  id: string;
  prompt: string;
  /** Options as typed; empty ones are dropped on send. */
  choices: string[];
  /** Index of the right option, or null while it is still being written. */
  answer: number | null;
  points: string;
}

export interface ExamDraft {
  title: string;
  subject: string;
  note: string;
  minutes: string;
  dueAt: string;
  questions: ExamQuestionDraft[];
}

export function emptyExamQuestion(id: string): ExamQuestionDraft {
  // Two empty options, not four: `cleanChoices` drops the blanks, so a fresh
  // question reads as a written one until the guardian types a second option.
  // Four boxes would ask for four answers before asking for the question.
  return { id, prompt: '', choices: ['', ''], answer: null, points: '1' };
}

export function emptyExamDraft(): ExamDraft {
  // One question already on the page: the composer is for writing an exam, and
  // an exam nobody has started is the one thing it should not open on.
  return { title: '', subject: '', note: '', minutes: '', dueAt: '', questions: [emptyExamQuestion('q1')] };
}

/** The options a question really has, in the order they were typed. */
export function cleanChoices(question: Pick<ExamQuestionDraft, 'choices'>): string[] {
  return question.choices.map((choice) => choice.trim()).filter(Boolean).slice(0, EXAM_CHOICES_MAX);
}

/** Whether this question is a written answer rather than a choice. */
export function isWrittenQuestion(question: Pick<ExamQuestionDraft, 'choices'>): boolean {
  return cleanChoices(question).length === 0;
}

/**
 * What stops this exam from being sent.
 *
 * Checked before anything is written, and worded for the guardian writing it:
 * an exam that arrives half-built is worse than one that is refused here.
 */
export function examDraftError(draft: ExamDraft): string | null {
  if (!draft.title.trim()) return t('Give the exam a name.');
  const asked = draft.questions.filter((question) => question.prompt.trim());
  if (asked.length === 0) return t('Write at least one question.');
  if (draft.questions.some((question) => !question.prompt.trim() && question.choices.some((choice) => choice.trim())))
    return t('Give each question its words, or take the empty one away.');
  if (asked.length > EXAM_QUESTIONS_MAX) return t('An exam can hold up to 25 questions.');
  for (const question of asked) {
    const choices = cleanChoices(question);
    if (choices.length === 1) return t('A question needs two options or more, or none at all.');
    if (choices.length > 1 && question.answer === null)
      return t('Mark the right answer on every question with options.');
    if (question.answer !== null && choices[question.answer] === undefined)
      return t('Mark the right answer on every question with options.');
    const points = Number(question.points);
    if (question.points && (!Number.isFinite(points) || points < 1 || points > 100))
      return t('Give each question between 1 and 100 points.');
  }
  if (draft.minutes) {
    const minutes = Number(draft.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) return t('Allow between 1 and 600 minutes.');
  }
  if (draft.dueAt && draft.dueAt < todayISO()) return t('The due day cannot be behind you.');
  return null;
}

/** The questions an exam will carry, from the draft the guardian wrote. */
export function buildExamQuestions(draft: ExamDraft): ExamQuestion[] {
  return draft.questions
    .filter((question) => question.prompt.trim())
    .map((question) => {
      const choices = cleanChoices(question);
      const points = Number(question.points);
      return {
        id: question.id,
        prompt: question.prompt.trim().slice(0, EXAM_PROMPT_MAX),
        choices,
        answer: choices.length > 1 && question.answer !== null && choices[question.answer] !== undefined ? question.answer : null,
        points: Number.isFinite(points) && points >= 1 ? Math.max(1, Math.min(100, Math.round(points))) : 1,
      };
    })
    .slice(0, EXAM_QUESTIONS_MAX);
}

/* ------------------------------------------------------------------ marking */

export interface ExamScore {
  /** Points earned on the questions that could be marked. */
  score: number;
  /** Points that could be marked — the written answers are not in it. */
  marked: number;
  /** Every point on the exam, marked or not. */
  total: number;
  /** Questions left out of the score because nobody marked them. */
  unmarked: number;
  /** Which choice questions were right, by question id. */
  right: string[];
  /** Which choice questions were wrong, by question id. */
  wrong: string[];
}

/**
 * Mark a sitting.
 *
 * Only questions with an answer marked on them are counted: `marked` is what
 * the score is out of, and `total` is the whole exam, so a panel can say "9 of
 * 10 marked, 2 written answers waiting" instead of a number that quietly counts
 * an unread answer as wrong.
 */
export function scoreExam(exam: Exam, answers: Record<string, number>): ExamScore {
  let score = 0;
  let marked = 0;
  let unmarked = 0;
  const right: string[] = [];
  const wrong: string[] = [];
  for (const question of exam.questions) {
    if (question.answer === null) {
      unmarked += 1;
      continue;
    }
    marked += question.points;
    if (answers[question.id] === question.answer) {
      score += question.points;
      right.push(question.id);
    } else {
      wrong.push(question.id);
    }
  }
  return {
    score,
    marked,
    total: exam.questions.reduce((sum, question) => sum + question.points, 0),
    unmarked,
    right,
    wrong,
  };
}

/** A sitting, ready to travel: marked here so both sides read the same number. */
export function submitExam(
  exam: Exam,
  input: { answers: Record<string, number>; written: Record<string, string> },
  now = new Date(),
): ExamSubmission {
  const score = scoreExam(exam, input.answers);
  const written: Record<string, string> = {};
  for (const question of exam.questions) {
    if (question.answer !== null) continue;
    const answer = (input.written[question.id] ?? '').trim().slice(0, EXAM_WRITTEN_MAX);
    if (answer) written[question.id] = answer;
  }
  const answers: Record<string, number> = {};
  for (const question of exam.questions) {
    const chosen = input.answers[question.id];
    if (question.answer !== null && typeof chosen === 'number' && chosen >= 0 && chosen < question.choices.length) {
      answers[question.id] = chosen;
    }
  }
  return {
    id: `sitting-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    examId: exam.id,
    linkId: exam.linkId,
    answers,
    written,
    score: score.score,
    marked: score.marked,
    submittedAt: now.toISOString(),
    feedback: '',
    reviewedAt: null,
  };
}

/* -------------------------------------------------------------- reading back */

export interface ExamAnswerRead {
  id: string;
  prompt: string;
  /** The options as they were asked. */
  choices: string[];
  /** Which option was chosen, when the question had options. */
  chosen: number | null;
  /** Which option was right, when the question had a key. */
  correct: number | null;
  /** Right, wrong, or null for a written answer nobody has marked. */
  verdict: 'right' | 'wrong' | null;
  /** What was written, for a written question. */
  written: string | null;
  points: number;
  /** Points earned on this question, when it could be marked. */
  earned: number | null;
}

/**
 * The sitting, question by question.
 *
 * One shape for both sides, because it is the same fact seen from two chairs:
 * the student wants to know which ones to look at again, and the guardian wants
 * to know which ones to talk about. The answer key was on the exam all along —
 * it is what marked the score — so there is nothing here either side has to wait
 * for the other to send.
 */
export function examReview(exam: Exam, submission: ExamSubmission): ExamAnswerRead[] {
  return exam.questions.map((question) => {
    const chosen = submission.answers[question.id];
    const written = submission.written[question.id] ?? null;
    const hasKey = question.answer !== null;
    const verdict: ExamAnswerRead['verdict'] = !hasKey ? null : chosen === question.answer ? 'right' : 'wrong';
    return {
      id: question.id,
      prompt: question.prompt,
      choices: question.choices,
      chosen: typeof chosen === 'number' ? chosen : null,
      correct: hasKey ? question.answer : null,
      verdict,
      written,
      points: question.points,
      earned: hasKey ? (verdict === 'right' ? question.points : 0) : null,
    };
  });
}

/** How much of an exam is filled in, question by question, in order. */
export function examProgress(
  exam: Exam,
  answers: Record<string, number>,
  written: Record<string, string>,
): { answered: number; total: number; /** Ids of the questions still blank, in the order they are asked. */ blanks: string[] } {
  const blanks: string[] = [];
  for (const question of exam.questions) {
    const filled =
      question.answer !== null ? answers[question.id] !== undefined : !!written[question.id]?.trim();
    if (!filled) blanks.push(question.id);
  }
  return { answered: exam.questions.length - blanks.length, total: exam.questions.length, blanks };
}

/** What the guardian is about to send, in one line, before they send it. */
export function draftExamSummary(draft: ExamDraft): { questions: number; points: number; written: number } {
  const asked = draft.questions.filter((question) => question.prompt.trim());
  return {
    questions: asked.length,
    points: asked.reduce(
      (sum, question) =>
        sum + Math.max(1, Math.min(100, Math.round(Number(question.points) || 1))),
      0,
    ),
    written: asked.filter((question) => isWrittenQuestion(question)).length,
  };
}

/* ------------------------------------------------------------------- merging */

/** Exams the guardian has sent, newest first. A withdrawn one disappears here. */
export function mergeExams(current: Exam[], incoming: Exam[]): Exam[] {
  const byId = new Map<string, Exam>();
  for (const exam of [...current, ...incoming]) byId.set(exam.id, exam);
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, EXAMS_KEPT);
}

/**
 * Sittings, newest first.
 *
 * A sitting happens once: an earlier one is never replaced by a later pull, and
 * the guardian's feedback lands on the sitting it answers rather than beside
 * it. Because the two sides now write the same sitting at different moments —
 * the student uploads files, the guardian re-grants an attempt — the merge is
 * field-level, not last-write-wins: files union, flags survive, and the later
 * review/grant timestamp wins rather than an older copy blanking a newer one.
 */
export function mergeExamSubmissions(current: ExamSubmission[], incoming: ExamSubmission[]): ExamSubmission[] {
  const byId = new Map<string, ExamSubmission>();
  for (const submission of [...incoming, ...current]) {
    const previous = byId.get(submission.id);
    if (!previous) {
      byId.set(submission.id, submission);
      continue;
    }
    const files = new Map<string, ExamFile>();
    for (const file of [...(previous.files ?? []), ...(submission.files ?? [])]) {
      files.set(file.publicId, file);
    }
    const later = (a: string | null | undefined, b: string | null | undefined): string | null => {
      if (!a) return b ?? null;
      if (!b) return a;
      return a.localeCompare(b) >= 0 ? a : b;
    };
    byId.set(submission.id, {
      ...submission,
      ...previous,
      files: [...files.values()],
      late: previous.late || submission.late,
      feedback: previous.feedback || submission.feedback,
      reviewedAt: later(previous.reviewedAt, submission.reviewedAt),
      resubmitGrantedAt: later(previous.resubmitGrantedAt, submission.resubmitGrantedAt),
      keyReleasedAt: later(previous.keyReleasedAt, submission.keyReleasedAt),
      // Status moves forward through the sitting's life and never back:
      // missed → submitted (a granted re-upload arriving) → reviewed. A copy
      // arriving out of order must not walk a progressed sitting backwards.
      status:
        previous.status === 'reviewed' || submission.status === 'reviewed'
          ? 'reviewed'
          : previous.status === 'submitted' || submission.status === 'submitted'
            ? 'submitted'
            : (submission.status ?? previous.status),
    });
  }
  return [...byId.values()]
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, EXAM_RESULTS_KEPT);
}

/** The sitting for one exam, when there is one. */
export function submissionFor(submissions: ExamSubmission[] | undefined, examId: string): ExamSubmission | undefined {
  return (submissions ?? []).find((submission) => submission.examId === examId);
}

/** Whether an exam is still open to sit: not yet handed in, and not past its day. */
export function examOpen(exam: Exam, submissions: ExamSubmission[] | undefined, today = todayISO()): boolean {
  if (submissionFor(submissions, exam.id)) return false;
  return !exam.dueAt || exam.dueAt >= today;
}

/** How many exams are waiting on this student. */
export function openExamCount(exams: Exam[] | undefined, submissions: ExamSubmission[] | undefined, today = todayISO()): number {
  return (exams ?? []).filter((exam) => examOpen(exam, submissions, today)).length;
}

/* -------------------------------------------------------------- state moves */

/** Student: keep the sitting locally; the next sync carries it to the guardian. */
export function withStudentExamSubmission(panels: Panels, submission: ExamSubmission): Panels {
  return {
    ...panels,
    student: {
      ...panels.student,
      examSubmissions: mergeExamSubmissions(panels.student.examSubmissions ?? [], [submission]),
    },
  };
}

/** Student: persist an in-progress sitting so the clock and answers survive reloads. */
export function withStudentExamDraft(panels: Panels, draft: NonNullable<Panels['student']['examDrafts']>[string]): Panels {
  return {
    ...panels,
    student: {
      ...panels.student,
      examDrafts: { ...(panels.student.examDrafts ?? {}), [draft.examId]: draft },
    },
  };
}

/** Student: drop the local sitting draft once the submission has been made. */
export function withoutStudentExamDraft(panels: Panels, examId: string): Panels {
  if (!panels.student.examDrafts?.[examId]) return panels;
  const drafts = { ...panels.student.examDrafts };
  delete drafts[examId];
  return { ...panels, student: { ...panels.student, examDrafts: drafts } };
}

/**
 * The variant this student answers. Assigned at Start and then fixed in the
 * persisted draft, so re-opening the exam can never roll them onto another
 * paper. Random across variants — two students on the same guardian get
 * different papers without the guardian hand-picking per student.
 */
export function drawVariantId(exam: Exam): string | null {
  const variants = exam.variants ?? [];
  if (variants.length === 0) return null;
  const at = Math.floor(Math.random() * variants.length);
  return variants[at]?.id ?? variants[0]!.id;
}

/** Guardian: fold a sitting in, and put the words back on the one it answers. */
export function withGuardianExamResult(panels: Panels, submission: ExamSubmission): Panels {
  return {
    ...panels,
    guardian: {
      ...panels.guardian,
      links: panels.guardian.links.map((link) =>
        link.linkId === submission.linkId
          ? { ...link, examResults: mergeExamSubmissions(link.examResults ?? [], [submission]) }
          : link,
      ),
    },
  };
}

/** Guardian: send the exam, and keep it in the list of exams sent. */
export function withLinkExam(panels: Panels, linkId: string, exam: Exam): Panels {
  return {
    ...panels,
    guardian: {
      ...panels.guardian,
      links: panels.guardian.links.map((link) =>
        link.linkId === linkId ? { ...link, exams: mergeExams(link.exams ?? [], [exam]) } : link,
      ),
    },
  };
}

/** Guardian: take an exam back. A sitting already handed in stays on record. */
export function withoutLinkExam(panels: Panels, linkId: string, examId: string): Panels {
  return {
    ...panels,
    guardian: {
      ...panels.guardian,
      links: panels.guardian.links.map((link) =>
        link.linkId === linkId ? { ...link, exams: (link.exams ?? []).filter((exam) => exam.id !== examId) } : link,
      ),
    },
  };
}

/* ============================================================ file exams */

/** One question while the guardian is still writing the answer key. */
export interface KeyQuestionDraft {
  id: string;
  type: 'single' | 'boolean';
  /** Two to five options for a single-choice question; ignored for boolean. */
  options: string[];
  /** Chosen correct index, or null while unset. */
  answer: number | null;
  points: string;
}

/** One variant while composing: its paper, its questions, its key. */
export interface VariantDraft {
  id: string;
  label: string;
  file: ExamFile | null;
  questions: KeyQuestionDraft[];
}

/** A test exam: variants, each with a file and an answer key. */
export interface TestExamDraft {
  kind: 'test';
  title: string;
  subject: string;
  note: string;
  minutes: string;
  dueAt: string;
  variants: VariantDraft[];
}

/** A paper exam: one file, a clock, and an upload window afterwards. */
export interface PaperExamDraft {
  kind: 'paper';
  title: string;
  subject: string;
  note: string;
  minutes: string;
  dueAt: string;
  uploadMinutes: string;
  paperFile: ExamFile | null;
}

export type ExamComposerDraft = TestExamDraft | PaperExamDraft;

const BOOLEAN_OPTIONS = (): [string, string] => [t('True'), t('False')];

export function emptyKeyQuestion(id: string): KeyQuestionDraft {
  return { id, type: 'boolean', options: [...BOOLEAN_OPTIONS()], answer: null, points: '1' };
}

export function emptyVariant(id: string, label: string, questionCount: number): VariantDraft {
  return {
    id,
    label,
    file: null,
    questions: Array.from({ length: Math.max(1, questionCount) }, (_, at) => emptyKeyQuestion(`q${at + 1}`)),
  };
}

export function emptyTestDraft(): TestExamDraft {
  return {
    kind: 'test',
    title: '',
    subject: '',
    note: '',
    minutes: '',
    dueAt: '',
    variants: [emptyVariant('v1', t('Variant {0}', { 0: 'A' }), 1)],
  };
}

export function emptyPaperDraft(): PaperExamDraft {
  return {
    kind: 'paper',
    title: '',
    subject: '',
    note: '',
    minutes: '',
    dueAt: '',
    uploadMinutes: String(EXAM_UPLOAD_WINDOW_MIN),
    paperFile: null,
  };
}

/**
 * Grow or shrink a variant's question list to exactly `count`. Existing
 * answers survive; new questions arrive as true/false, the lightest shape.
 */
export function withQuestionCount(variant: VariantDraft, count: number): VariantDraft {
  const safe = Math.max(1, Math.min(EXAM_QUESTIONS_MAX, Math.round(count) || 1));
  if (safe === variant.questions.length) return variant;
  if (safe < variant.questions.length) return { ...variant, questions: variant.questions.slice(0, safe) };
  const added = Array.from({ length: safe - variant.questions.length }, (_, at) =>
    emptyKeyQuestion(`q${variant.questions.length + at + 1}`),
  );
  return { ...variant, questions: [...variant.questions, ...added] };
}

/** Bulk answer entry: one correct index per question, in question order. */
export function applyBulkAnswers(variant: VariantDraft, answers: Array<number | null>): VariantDraft {
  return {
    ...variant,
    questions: variant.questions.map((question, at) => {
      const answer = answers[at];
      return typeof answer === 'number' && answer >= 0 && answer < question.options.length
        ? { ...question, answer }
        : question;
    }),
  };
}

/** The student's copy of an exam: every answer key stripped before it travels. */
export function keylessExam(exam: Exam): Exam {
  if (examKind(exam) !== 'test' || !exam.variants?.length) return exam;
  return {
    ...exam,
    variants: exam.variants.map((variant) => ({
      ...variant,
      questions: variant.questions.map((question) => ({ ...question, answer: null })),
    })),
  };
}

function buildKeyQuestion(draft: KeyQuestionDraft): ExamKeyQuestion | null {
  const options = draft.type === 'boolean'
    ? [...BOOLEAN_OPTIONS()]
    : draft.options.map((option) => option.trim()).filter(Boolean).slice(0, EXAM_CHOICES_MAX);
  if (options.length < 2) return null;
  const points = Number(draft.points);
  return {
    id: draft.id,
    type: draft.type,
    options,
    answer: draft.answer !== null && draft.answer < options.length ? draft.answer : null,
    points: Number.isFinite(points) && points >= 1 ? Math.max(1, Math.min(EXAM_POINTS_MAX, Math.round(points))) : 1,
  };
}

/** What stops this composer draft from being sent, worded for the guardian. */
export function composerDraftError(draft: ExamComposerDraft): string | null {
  if (!draft.title.trim()) return t('Give the exam a name.');
  if (draft.dueAt && draft.dueAt < todayISO()) return t('The due day cannot be behind you.');
  if (draft.minutes) {
    const minutes = Number(draft.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) return t('Allow between 1 and 600 minutes.');
  }
  if (draft.kind === 'paper') {
    if (!draft.paperFile) return t('Add the question paper file.');
    if (!draft.minutes.trim()) return t('Set how long the exam lasts. The clock starts when they begin.');
    const upload = Number(draft.uploadMinutes);
    if (!Number.isFinite(upload) || upload < EXAM_UPLOAD_MIN_MIN || upload > EXAM_UPLOAD_MIN_MAX) {
      return t('The upload window must be between {0} and {1} minutes.', { 0: EXAM_UPLOAD_MIN_MIN, 1: EXAM_UPLOAD_MIN_MAX });
    }
    return null;
  }
  if (draft.variants.length === 0) return t('Add at least one variant.');
  const labels = draft.variants.map((variant) => variant.label.trim());
  if (labels.some((label) => !label)) return t('Name every variant.');
  if (new Set(labels).size !== labels.length) return t('Variant names must be different.');
  for (const variant of draft.variants) {
    if (!variant.file) return t('Add the question paper for variant {0}.', { 0: variant.label || '—' });
    if (variant.questions.length === 0) return t('Set the number of questions on {0}.', { 0: variant.label });
    for (const question of variant.questions) {
      if (question.type === 'single' && question.options.map((option) => option.trim()).filter(Boolean).length < 2) {
        return t('Every multiple-choice question needs two options or more.');
      }
      if (question.answer === null) return t('Mark the right answer on every question.');
      const points = Number(question.points);
      if (question.points && (!Number.isFinite(points) || points < 1 || points > EXAM_POINTS_MAX)) {
        return t('Give each question between 1 and {0} points.', { 0: EXAM_POINTS_MAX });
      }
    }
  }
  return null;
}

/** The full exam object, key included — this copy stays with the guardian. */
export function buildComposedExam(draft: ExamComposerDraft, meta: { id: string; linkId: string; author: string; now: Date }): Exam {
  const minutes = draft.minutes.trim() ? Math.max(1, Math.min(600, Math.round(Number(draft.minutes)))) : null;
  const base: Exam = {
    id: meta.id,
    linkId: meta.linkId,
    author: meta.author,
    title: draft.title.trim().slice(0, EXAM_TITLE_MAX),
    subject: draft.subject.trim().slice(0, 60),
    note: draft.note.trim().slice(0, EXAM_NOTE_MAX),
    minutes,
    dueAt: draft.dueAt || null,
    questions: [],
    createdAt: meta.now.toISOString(),
  };
  if (draft.kind === 'paper') {
    return {
      ...base,
      kind: 'paper',
      paperFile: draft.paperFile,
      uploadMinutes: Math.max(
        EXAM_UPLOAD_MIN_MIN,
        Math.min(EXAM_UPLOAD_MIN_MAX, Math.round(Number(draft.uploadMinutes) || EXAM_UPLOAD_WINDOW_MIN)),
      ),
    };
  }
  return {
    ...base,
    kind: 'test',
    variants: draft.variants
      .map((variant): ExamVariant => ({
        id: variant.id,
        label: variant.label.trim().slice(0, EXAM_VARIANT_LABEL_MAX),
        file: variant.file,
        questions: variant.questions
          .map(buildKeyQuestion)
          .filter((question): question is ExamKeyQuestion => question !== null),
      }))
      .filter((variant) => variant.questions.length > 0)
      .slice(0, EXAM_VARIANTS_MAX),
  };
}

/** Total points of one variant, and how many questions it holds. */
export function variantSummary(variant: { questions: Array<{ points: number | string }> }): { questions: number; points: number } {
  return {
    questions: variant.questions.length,
    points: variant.questions.reduce((sum, question) => sum + Math.max(0, Number(question.points) || 0), 0),
  };
}

/* ------------------------------------------------------------------ marking */

export interface KeyScore {
  score: number;
  total: number;
  right: string[];
  wrong: string[];
  blank: string[];
}

/**
 * Grade a test variant against the guardian's key.
 *
 * Unlike the legacy mixed exam, every question here is machine-markable, so
 * `total` covers the whole paper and a blank answer is reported as blank
 * rather than silently counted as wrong.
 */
export function scoreKeyQuestions(questions: ExamKeyQuestion[], answers: Record<string, number>): KeyScore {
  let score = 0;
  let total = 0;
  const right: string[] = [];
  const wrong: string[] = [];
  const blank: string[] = [];
  for (const question of questions) {
    total += question.points;
    const chosen = answers[question.id];
    if (chosen === undefined) {
      blank.push(question.id);
      continue;
    }
    if (chosen === question.answer) {
      score += question.points;
      right.push(question.id);
    } else {
      wrong.push(question.id);
    }
  }
  return { score, total, right, wrong, blank };
}

/* ------------------------------------------------------------- paper timing */

/** When the answer-paper upload window shuts, or null when there is no clock. */
export function uploadDeadline(exam: Exam, startedAt: string): string | null {
  if (!exam.minutes) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const windowMin = exam.uploadMinutes ?? EXAM_UPLOAD_WINDOW_MIN;
  return new Date(start + (exam.minutes + windowMin) * 60_000).toISOString();
}

/** The answer window length in ms (zero when the exam has no clock). */
export function uploadWindowMs(exam: Exam): number {
  return (exam.uploadMinutes ?? EXAM_UPLOAD_WINDOW_MIN) * 60_000;
}

export type PaperPhase = 'sitting' | 'upload' | 'submitted' | 'missed' | 'reviewed';

/**
 * Where a paper exam currently is, from wall-clock times that survive the
 * device sleeping and the tab being killed.
 */
export function paperPhase(
  exam: Exam,
  sitting: { startedAt?: string | null; uploadDeadline?: string | null; status?: ExamSittingStatus; files?: ExamFile[]; reviewedAt?: string | null } | undefined,
  now = Date.now(),
): PaperPhase | null {
  if (examKind(exam) !== 'paper') return null;
  if (!sitting?.startedAt) return null;
  if (sitting.status === 'reviewed' || sitting.reviewedAt) return 'reviewed';
  const hasFiles = (sitting.files?.length ?? 0) > 0;
  if (sitting.status === 'submitted' && hasFiles) return 'submitted';
  const deadline = sitting.uploadDeadline ? Date.parse(sitting.uploadDeadline) : NaN;
  if (!Number.isFinite(deadline)) return hasFiles ? 'submitted' : 'sitting';
  if (now > deadline) return hasFiles ? 'submitted' : 'missed';
  const endOfExam = deadline - uploadWindowMs(exam);
  return now < endOfExam ? 'sitting' : 'upload';
}

/** Whether the student may upload answer files right now. */
export function canUploadPapers(
  sitting: { status?: ExamSittingStatus; uploadDeadline?: string | null; files?: ExamFile[]; resubmitGrantedAt?: string | null } | undefined,
  now = Date.now(),
): boolean {
  if (!sitting) return false;
  if ((sitting.files?.length ?? 0) > 0 && !sitting.resubmitGrantedAt) return false;
  const deadline = sitting.uploadDeadline ? Date.parse(sitting.uploadDeadline) : NaN;
  if (Number.isFinite(deadline) && now > deadline && !sitting.resubmitGrantedAt) return false;
  return true;
}

/** One attempt, ever: a finished sitting of either kind locks the exam. */
export function examHasAttempt(submission: ExamSubmission | undefined): boolean {
  if (!submission) return false;
  if (submission.status === 'missed' && (submission.files?.length ?? 0) === 0) return true;
  return Boolean(submission.status === 'submitted' || submission.status === 'reviewed' || submission.submittedAt);
}
