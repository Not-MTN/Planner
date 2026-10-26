/**
 * The guardian's subject-by-subject review.
 *
 * Weekly results already say where focused time went, but a guardian planning
 * the next week asks three more specific questions: how much of each lesson
 * got done, how many tests have been sat, and where the homework stands. This
 * folds the plans, daily reports, exams and homework on a link into one
 * per-subject table. Everything here is a count the link already carries —
 * nothing private is read to compute it.
 */
import type {
  ExamSubmission,
  GuardianLink,
  GuardianPlan,
  HomeworkAssignment,
  HomeworkSubmission,
  PlanItem,
  WeekResults,
} from './types';
import { subjectKey } from './panelFeatures';

export type ReviewWindow = 'week' | 'month' | 'all';

export interface SubjectReview {
  /** Display name as the student/guardian wrote it. */
  name: string;
  /** Study lessons planned across the window's plans. */
  lessonsPlanned: number;
  /** Lessons the student ticked (or filed as done in a daily report). */
  lessonsDone: number;
  /** Sum of the lessons' own minute estimates. */
  plannedMinutes: number;
  /** Focused minutes attributed to this subject in shared weekly results. */
  focusMinutes: number;
  /** Tests (exams) the guardian set for this subject. */
  testsSet: number;
  /** Sittings handed in. */
  testsTaken: number;
  /** Average marked score as a percentage, or null when nothing was marked. */
  averageScore: number | null;
  /** Homework pieces assigned. */
  homeworkSet: number;
  /** Homework with a submission waiting or approved. */
  homeworkSubmitted: number;
  /** Homework approved by the guardian. */
  homeworkApproved: number;
  /** Homework still waiting on a submission. */
  homeworkPending: number;
}

export interface GuardianReviewSummary {
  subjects: SubjectReview[];
  lessonsPlanned: number;
  lessonsDone: number;
  plannedMinutes: number;
  focusMinutes: number;
  testsSet: number;
  testsTaken: number;
  homeworkSet: number;
  homeworkSubmitted: number;
  homeworkApproved: number;
  homeworkPending: number;
  /** 0–1 completion ratio for lessons, or null with no lessons planned. */
  completion: number | null;
}

function plansForWindow(link: GuardianLink, window: ReviewWindow, today: string): GuardianPlan[] {
  if (window === 'all') return link.plans;
  const weeks = window === 'week' ? 1 : 4;
  const cutoff = new Date(today + 'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - (weeks * 7 - 1));
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return link.plans.filter((plan) => plan.start >= cutoffIso);
}

function resultsForWindow(link: GuardianLink, window: ReviewWindow, today: string): WeekResults[] {
  const current = link.results ? [link.results] : [];
  if (window === 'all') return [...current, ...link.history];
  const weeks = window === 'week' ? 1 : 4;
  const cutoff = new Date(today + 'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - (weeks * 7 - 1));
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return [...current, ...link.history].filter((week) => week.weekOf >= cutoffIso);
}

function itemSubject(item: PlanItem): string {
  return (item.subject || item.title || '').trim() || '—';
}

/** Build the full review for one guardian link over the chosen window. */
export function buildGuardianReview(
  link: GuardianLink,
  window: ReviewWindow = 'month',
  today = new Date().toISOString().slice(0, 10),
): GuardianReviewSummary {
  const plans = plansForWindow(link, window, today);
  const weeks = resultsForWindow(link, window, today);

  const bySubject = new Map<string, SubjectReview>();
  const row = (name: string): SubjectReview => {
    const key = subjectKey(name);
    let entry = [...bySubject.values()].find((item) => subjectKey(item.name) === key);
    if (!entry) {
      entry = {
        name,
        lessonsPlanned: 0,
        lessonsDone: 0,
        plannedMinutes: 0,
        focusMinutes: 0,
        testsSet: 0,
        testsTaken: 0,
        averageScore: null,
        homeworkSet: 0,
        homeworkSubmitted: 0,
        homeworkApproved: 0,
        homeworkPending: 0,
      };
      bySubject.set(key, entry);
    }
    return entry;
  };

  // Lessons from the plans themselves.
  for (const plan of plans) {
    for (const item of plan.items) {
      // Homework and tests have their own rows below; don't double-count them.
      if (item.kind === 'homework' || item.kind === 'test') continue;
      const entry = row(itemSubject(item));
      entry.lessonsPlanned += 1;
      if (item.done) entry.lessonsDone += 1;
      if (item.minutes) entry.plannedMinutes += Math.max(0, item.minutes);
    }
  }

  // Focused minutes come from the shared weekly snapshots, subject by subject.
  for (const week of weeks) {
    for (const subject of week.subjects) {
      row(subject.name).focusMinutes += subject.minutes;
    }
  }

  // Exams: set, sat, and the average marked score.
  const scoreTotals = new Map<string, { sum: number; count: number }>();
  const sittingsByExam = new Map<string, ExamSubmission[]>();
  for (const sitting of link.examResults ?? []) {
    const list = sittingsByExam.get(sitting.examId) ?? [];
    list.push(sitting);
    sittingsByExam.set(sitting.examId, list);
    if (sitting.marked > 0) {
      const total = scoreTotals.get(sitting.examId) ?? { sum: 0, count: 0 };
      total.sum += sitting.score / sitting.marked;
      total.count += 1;
      scoreTotals.set(sitting.examId, total);
    }
  }
  for (const exam of link.exams ?? []) {
    const entry = row(exam.subject || exam.title);
    entry.testsSet += 1;
    const sittings = sittingsByExam.get(exam.id) ?? [];
    entry.testsTaken += sittings.length;
    const score = scoreTotals.get(exam.id);
    if (score && score.count > 0) entry.averageScore = Math.round((score.sum / score.count) * 100);
  }

  // Homework: assigned, submitted, approved, and still waiting.
  const submissionsByAssignment = new Map<string, HomeworkSubmission[]>();
  for (const submission of link.homeworkSubmissions ?? []) {
    const list = submissionsByAssignment.get(submission.assignmentId) ?? [];
    list.push(submission);
    submissionsByAssignment.set(submission.assignmentId, list);
  }
  const homework: HomeworkAssignment[] = link.homework ?? [];
  for (const assignment of homework) {
    const entry = row(assignment.subject || assignment.title);
    entry.homeworkSet += 1;
    const submissions = submissionsByAssignment.get(assignment.id) ?? [];
    if (submissions.length > 0) {
      entry.homeworkSubmitted += 1;
      if (submissions.some((item) => item.status === 'approved')) entry.homeworkApproved += 1;
    } else {
      entry.homeworkPending += 1;
    }
  }

  // A subject with focus minutes but no planned lessons still reads first.
  const subjects = [...bySubject.values()].sort((a, b) =>
      b.lessonsPlanned - a.lessonsPlanned ||
      b.focusMinutes - a.focusMinutes ||
      b.homeworkSet - a.homeworkSet ||
      a.name.localeCompare(b.name),
    );

  const sum = (pick: (entry: SubjectReview) => number): number =>
    subjects.reduce((total, entry) => total + pick(entry), 0);

  const lessonsPlanned = sum((entry) => entry.lessonsPlanned);
  const lessonsDone = sum((entry) => entry.lessonsDone);
  const plannedMinutes = sum((entry) => entry.plannedMinutes);
  const focusMinutes = sum((entry) => entry.focusMinutes);
  const testsSet = sum((entry) => entry.testsSet);
  const testsTaken = sum((entry) => entry.testsTaken);
  const homeworkSet = sum((entry) => entry.homeworkSet);
  const homeworkSubmitted = sum((entry) => entry.homeworkSubmitted);
  const homeworkApproved = sum((entry) => entry.homeworkApproved);
  const homeworkPending = sum((entry) => entry.homeworkPending);

  return {
    subjects,
    lessonsPlanned,
    lessonsDone,
    plannedMinutes,
    focusMinutes,
    testsSet,
    testsTaken,
    homeworkSet,
    homeworkSubmitted,
    homeworkApproved,
    homeworkPending,
    completion: lessonsPlanned > 0 ? lessonsDone / lessonsPlanned : null,
  };
}
