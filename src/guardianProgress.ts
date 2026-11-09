/**
 * Small, privacy-preserving progress summaries for a guardian.
 *
 * Every value comes from information already shared over the guardian link:
 * weekly totals, marked tests, assigned classes/homework, and accepted goal
 * counts. No private planner tasks, notes, messages, answers, or photo contents
 * are read here.
 */
import type { GuardianLink, WeekResults } from './types';

export interface WeeklyCompletionPoint {
  weekOf: string;
  done: number;
  planned: number;
  /** Null means nothing was planned; an empty week is not a zero-percent week. */
  percent: number | null;
}

export interface MarkedTestResult {
  id: string;
  title: string;
  subject: string;
  submittedAt: string;
  percent: number;
}

export interface HomeworkProgress {
  assigned: number;
  notSubmitted: number;
  awaitingReview: number;
  approved: number;
}

export interface ClassSubjectProgress {
  subject: string;
  assigned: number;
  completed: number;
}

export interface AcceptedGoalProgress {
  id: string;
  title: string;
  done: number;
  total: number;
  updatedAt: string;
}

export interface GuardianProgressSummary {
  weeks: WeeklyCompletionPoint[];
  tests: MarkedTestResult[];
  homework: HomeworkProgress;
  classes: ClassSubjectProgress[];
  goals: AcceptedGoalProgress[];
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function safeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

/** The latest snapshot wins if it also appears in the saved history. */
export function weeklyCompletionTrend(link: GuardianLink, limit = 8): WeeklyCompletionPoint[] {
  const byWeek = new Map<string, WeekResults>();
  for (const week of link.history ?? []) {
    if (typeof week.weekOf === 'string' && week.weekOf) byWeek.set(week.weekOf, week);
  }
  if (link.results?.weekOf) byWeek.set(link.results.weekOf, link.results);

  const take = safeLimit(limit);
  if (take === 0) return [];
  const weeks = [...byWeek.values()].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  return weeks.slice(-take).map((week) => {
    const planned = safeCount(week.planned);
    const done = safeCount(week.done);
    return {
      weekOf: week.weekOf,
      done,
      planned,
      percent: planned > 0 ? Math.max(0, Math.min(100, Math.round((done / planned) * 100))) : null,
    };
  });
}

/** Marked scores only; unmarked and in-progress exam work is not a grade. */
export function markedTestResults(link: GuardianLink, limit = 6): MarkedTestResult[] {
  const take = safeLimit(limit);
  if (take === 0) return [];

  const exams = new Map((link.exams ?? []).map((exam) => [exam.id, exam]));
  return (link.examResults ?? [])
    .filter((result) => Number.isFinite(result.score) && Number.isFinite(result.marked) && result.marked > 0)
    .map((result) => {
      const exam = exams.get(result.examId);
      const percent = Math.round(Math.max(0, Math.min(1, result.score / result.marked)) * 100);
      return {
        id: result.id,
        title: exam?.title?.trim() ?? '',
        subject: exam?.subject?.trim() ?? '',
        submittedAt: result.submittedAt,
        percent,
      };
    })
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id))
    .slice(-take);
}

export function homeworkProgress(link: GuardianLink): HomeworkProgress {
  const homework = link.homework ?? [];
  const submissions = link.homeworkSubmissions ?? [];
  let notSubmitted = 0;
  let awaitingReview = 0;
  let approved = 0;

  for (const assignment of homework) {
    const related = submissions.filter((submission) => submission.assignmentId === assignment.id);
    if (related.some((submission) => submission.status === 'approved')) approved += 1;
    else if (related.length > 0) awaitingReview += 1;
    else notSubmitted += 1;
  }

  return { assigned: homework.length, notSubmitted, awaitingReview, approved };
}

export function classProgressBySubject(link: GuardianLink): ClassSubjectProgress[] {
  const progress = new Map((link.classProgress ?? []).map((entry) => [entry.classId, entry]));
  const bySubject = new Map<string, ClassSubjectProgress>();

  for (const assignment of link.classes ?? []) {
    const subject = assignment.subject.trim();
    const entry = bySubject.get(subject) ?? { subject, assigned: 0, completed: 0 };
    entry.assigned += 1;
    if (progress.get(assignment.id)?.completedAt) entry.completed += 1;
    bySubject.set(subject, entry);
  }

  return [...bySubject.values()].sort((a, b) => b.assigned - a.assigned || a.subject.localeCompare(b.subject));
}

export function acceptedGoalProgress(link: GuardianLink): AcceptedGoalProgress[] {
  const answers = new Map((link.goalAnswers ?? []).map((answer) => [answer.suggestionId, answer]));
  return (link.goals ?? [])
    .flatMap((goal) => {
      const answer = answers.get(goal.id);
      if (!answer || answer.state !== 'accepted' || safeCount(answer.total) === 0) return [];
      const total = safeCount(answer.total);
      return [{
        id: goal.id,
        title: goal.title,
        done: Math.min(total, safeCount(answer.done)),
        total,
        updatedAt: answer.updatedAt,
      }];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function buildGuardianProgress(link: GuardianLink): GuardianProgressSummary {
  return {
    weeks: weeklyCompletionTrend(link),
    tests: markedTestResults(link),
    homework: homeworkProgress(link),
    classes: classProgressBySubject(link),
    goals: acceptedGoalProgress(link),
  };
}
