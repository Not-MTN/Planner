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
} from './types';
import type { Exam, ExamQuestion, ExamSubmission, Panels } from './types';

const ID_MAX = 80;
const LINK_MAX = 64;

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
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .flatMap((question) => {
      const clean = sanitizeExamQuestion(question);
      return clean ? [clean] : [];
    })
    .slice(0, EXAM_QUESTIONS_MAX);
  if (questions.length === 0) return null;
  const minutes =
    typeof raw.minutes === 'number' && Number.isFinite(raw.minutes)
      ? Math.max(1, Math.min(600, Math.round(raw.minutes)))
      : null;
  const dueAt = raw.dueAt === null || raw.dueAt === undefined || raw.dueAt === '' ? null : timestamp(raw.dueAt);
  if (raw.dueAt && !dueAt) return null;
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
 * the guardian's feedback lands on the sitting it answers rather than beside it.
 */
export function mergeExamSubmissions(current: ExamSubmission[], incoming: ExamSubmission[]): ExamSubmission[] {
  const byId = new Map<string, ExamSubmission>();
  for (const submission of [...incoming, ...current]) {
    const previous = byId.get(submission.id);
    if (!previous) {
      byId.set(submission.id, submission);
      continue;
    }
    // Feedback that has already arrived stays; an older copy of the same
    // sitting must not take it back off.
    byId.set(submission.id, previous.feedback ? { ...submission, feedback: previous.feedback, reviewedAt: previous.reviewedAt ?? submission.reviewedAt } : submission);
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
