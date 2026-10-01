/**
 * Helpers for the optional student and guardian panels.
 *
 * The retention rule lives here: detail (a change and the reason for it) stays
 * inside the active week, and once the week rolls over only the results remain.
 * A guardian never receives the detail at all — only weekly results.
 */
import { addDays, parseISODate, startOfWeek, toISODate, todayISO } from './dates';
import { t } from './i18n';
import { GOAL_ANSWERS_KEPT, PANEL_GOALS_KEPT } from './types';
import type { ChangeNote, GoalAnswer, GoalSuggestion, GuardianLink, GuardianPlan, Panels, PlanCadence, PlannerState, StudentSubject, WeekResults } from './types';

export function weekOf(date = todayISO()): string {
  return startOfWeek(date);
}

/** Results are all that survives a week: counts and focused minutes. */
export function weekResults(state: PlannerState, week = weekOf()): WeekResults {
  const days = new Set<string>();
  for (let index = 0; index < 7; index += 1) days.add(addDays(week, index));

  const inWeek = (iso: string | null): boolean => !!iso && days.has(iso);
  const events = state.events.filter((event) => inWeek(event.date));
  const tasks = state.tasks.filter((task) => inWeek(task.dueDate));
  const focusMinutes = state.focusLog
    .filter((entry) => inWeek(entry.date))
    .reduce((total, entry) => total + (entry.minutes ?? 0), 0);

  const done = tasks.filter((task) => task.completed).length + events.filter((event) => event.completed).length;
  const planned = tasks.length + events.length;
  const notes = state.panels.student.explanations.filter((note) => note.weekOf === week);

  // Where the focused minutes went: grouped by category, top four, totals only.
  const minutes = new Map<string, number>();
  for (const entry of state.focusLog) {
    if (!inWeek(entry.date)) continue;
    const name = state.tasks.find((task) => task.id === entry.taskId)?.category?.trim() || 'Other';
    minutes.set(name, (minutes.get(name) ?? 0) + (entry.minutes ?? 0));
  }
  const subjects = [...minutes.entries()]
    .map(([name, value]) => ({ name, minutes: Math.round(value) }))
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 4);

  return {
    weekOf: week,
    planned,
    done,
    focusMinutes,
    subjects,
    headline: notes[0]?.summary ?? null,
    updatedAt: new Date().toISOString(),
  };
}

/** Minutes focused this week on tasks belonging to a subject (matched by category). */
export function subjectMinutes(state: PlannerState, subject: StudentSubject, week = weekOf()): number {
  const days = new Set<string>();
  for (let index = 0; index < 7; index += 1) days.add(addDays(week, index));
  const key = subject.name.trim().toLowerCase();
  const taskIds = new Set(
    state.tasks.filter((task) => (task.category ?? '').trim().toLowerCase() === key).map((task) => task.id),
  );
  return state.focusLog
    .filter((entry) => days.has(entry.date) && entry.taskId && taskIds.has(entry.taskId))
    .reduce((total, entry) => total + (entry.minutes ?? 0), 0);
}

export function subjectProgress(state: PlannerState, subject: StudentSubject, week = weekOf()): { done: number; total: number } {
  const days = new Set<string>();
  for (let index = 0; index < 7; index += 1) days.add(addDays(week, index));
  const key = subject.name.trim().toLowerCase();
  const tasks = state.tasks.filter((task) => (task.category ?? '').trim().toLowerCase() === key && days.has(task.dueDate ?? ''));
  return { done: tasks.filter((task) => task.completed).length, total: tasks.length };
}

/**
 * Splits explanations into this week's detail and a count per older week.
 * Older detail is not deleted here — the panel simply stops showing it, and the
 * rolling weekly results are what get shared.
 */
export function splitExplanations(
  notes: ChangeNote[],
  week = weekOf(),
): { current: ChangeNote[]; past: Array<{ week: string; count: number }> } {
  const current: ChangeNote[] = [];
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (note.weekOf === week) {
      current.push(note);
      continue;
    }
    counts.set(note.weekOf, (counts.get(note.weekOf) ?? 0) + 1);
  }
  current.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const past = [...counts.entries()]
    .map(([weekStart, count]) => ({ week: weekStart, count }))
    .sort((a, b) => b.week.localeCompare(a.week));
  return { current, past };
}

export function daysUntil(iso: string | null, from = todayISO()): number | null {
  if (!iso) return null;
  const start = Date.parse(`${from}T00:00:00`);
  const target = Date.parse(`${iso}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(target)) return null;
  return Math.round((target - start) / 86_400_000);
}

/**
 * The grade list, and the only place its wording lives. Labels are getters so
 * they follow the language chosen at load time rather than being frozen in
 * English at module load — the same trick `constants.ts` uses.
 */
export const GRADE_LABELS: Array<{ id: string; label: string }> = [
  { id: 'school-9', get label() { return t('Grade 9'); } },
  { id: 'school-10', get label() { return t('Grade 10'); } },
  { id: 'school-11', get label() { return t('Grade 11'); } },
  { id: 'school-12', get label() { return t('Grade 12'); } },
  { id: 'university', get label() { return t('University'); } },
  { id: 'postgrad', get label() { return t('Masters or PhD'); } },
  { id: 'other', get label() { return t('Something else'); } },
];

/** Human label for a stored grade id, or null when nothing is chosen. */
export function gradeLabel(grade: string | null): string | null {
  if (!grade) return null;
  return GRADE_LABELS.find((item) => item.id === grade)?.label ?? grade;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function withSubject(panels: Panels, subject: StudentSubject): Panels {
  return { ...panels, student: { ...panels.student, subjects: [...panels.student.subjects, subject] } };
}

export function withoutSubject(panels: Panels, id: string): Panels {
  return { ...panels, student: { ...panels.student, subjects: panels.student.subjects.filter((item) => item.id !== id) } };
}

export function withExplanation(panels: Panels, note: ChangeNote): Panels {
  return { ...panels, student: { ...panels.student, explanations: [note, ...panels.student.explanations].slice(0, 200) } };
}

export function withoutExplanation(panels: Panels, id: string): Panels {
  return { ...panels, student: { ...panels.student, explanations: panels.student.explanations.filter((item) => item.id !== id) } };
}

/* ------------------------------------------------------------------- plans */

/** How many of a plan's items are ticked off. */
export function planProgress(plan: GuardianPlan): { done: number; total: number } {
  return { done: plan.items.filter((item) => item.done).length, total: plan.items.length };
}

/** The first day a new plan should cover, for its cadence. */
export function planStartFor(cadence: PlanCadence, from = todayISO()): string {
  if (cadence === 'day') return from;
  if (cadence === 'week') return startOfWeek(from);
  const date = parseISODate(from);
  return toISODate(new Date(date.getFullYear(), date.getMonth(), 1));
}

/** The last day a plan covers: its start, plus the rest of the day/week/month. */
export function planEnd(plan: Pick<GuardianPlan, 'cadence' | 'start'>): string {
  if (plan.cadence === 'day') return plan.start;
  if (plan.cadence === 'week') return addDays(plan.start, 6);
  const date = parseISODate(plan.start);
  return toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/** \"Week of 28 Sep\", \"Today\", or \"September 2026\" — what the plan covers. */
export function planPeriodLabel(plan: GuardianPlan, from = todayISO()): string {
  if (plan.cadence === 'day') {
    if (plan.start === from) return t('Today');
    return plan.start;
  }
  if (plan.cadence === 'week') return t('Week of {0}', { 0: plan.start });
  const date = parseISODate(plan.start);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Tick a plan item on or off, on the student's side. */
export function withPlanItemToggled(panels: Panels, planId: string, itemId: string): Panels {
  const plans = panels.student.inbox.plans.map((plan) =>
    plan.id !== planId
      ? plan
      : {
          ...plan,
          items: plan.items.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item)),
        },
  );
  return { ...panels, student: { ...panels.student, inbox: { ...panels.student.inbox, plans } } };
}

/** Student side: every inbox notice has been seen. */
export function markInboxRead(panels: Panels): Panels {
  if (panels.student.inbox.notices.every((notice) => notice.read)) return panels;
  const notices = panels.student.inbox.notices.map((notice) => (notice.read ? notice : { ...notice, read: true }));
  return { ...panels, student: { ...panels.student, inbox: { ...panels.student.inbox, notices } } };
}

/** Guardian side: the plans sent to one student, newest first. */
export function withLinkPlan(panels: Panels, linkId: string, plan: GuardianPlan): Panels {
  const links = panels.guardian.links.map((link) =>
    link.linkId !== linkId
      ? link
      : { ...link, plans: [plan, ...link.plans.filter((item) => item.id !== plan.id)].slice(0, 10) },
  );
  return { ...panels, guardian: { ...panels.guardian, links } };
}

export function withoutLinkPlan(panels: Panels, linkId: string, planId: string): Panels {
  const links = panels.guardian.links.map((link) =>
    link.linkId !== linkId ? link : { ...link, plans: link.plans.filter((item) => item.id !== planId) },
  );
  return { ...panels, guardian: { ...panels.guardian, links } };
}

/** Guardian: remember a goal suggested to this student, newest first. */
export function withLinkGoal(panels: Panels, linkId: string, goal: GoalSuggestion): Panels {
  const links = panels.guardian.links.map((link) =>
    link.linkId !== linkId
      ? link
      : {
          ...link,
          goals: [goal, ...(link.goals ?? []).filter((item) => item.id !== goal.id)].slice(0, PANEL_GOALS_KEPT),
          // A fresh suggestion starts unanswered; an old answer to this id is
          // about a different question now.
          goalAnswers: (link.goalAnswers ?? []).filter((item) => item.suggestionId !== goal.id),
        },
  );
  return { ...panels, guardian: { ...panels.guardian, links } };
}

/** Guardian: forget a suggestion, and the answer that came back for it. */
export function withoutLinkGoal(panels: Panels, linkId: string, goalId: string): Panels {
  const links = panels.guardian.links.map((link) =>
    link.linkId !== linkId
      ? link
      : {
          ...link,
          goals: (link.goals ?? []).filter((item) => item.id !== goalId),
          goalAnswers: (link.goalAnswers ?? []).filter((item) => item.suggestionId !== goalId),
        },
  );
  return { ...panels, guardian: { ...panels.guardian, links } };
}

/**
 * Student: record how a suggested goal was answered. A refusal is remembered
 * here so it is not asked again; an acceptance is remembered so the goal can be
 * dropped without the answer going with it.
 */
export function withGoalAnswer(panels: Panels, answer: GoalAnswer): Panels {
  const answers = [
    answer,
    ...(panels.student.goalAnswers ?? []).filter((item) => item.suggestionId !== answer.suggestionId),
  ].slice(0, GOAL_ANSWERS_KEPT);
  return { ...panels, student: { ...panels.student, goalAnswers: answers } };
}

/** Student: how a suggestion stands — unanswered, or how they answered it. */
export function goalAnswerFor(panels: Panels, suggestionId: string): GoalAnswer | undefined {
  return (panels.student.goalAnswers ?? []).find((item) => item.suggestionId === suggestionId);
}

/** Guardian: the answer that came back for one suggestion, if it has. */
export function goalAnswerOnLink(link: GuardianLink, suggestionId: string): GoalAnswer | undefined {
  return (link.goalAnswers ?? []).find((item) => item.suggestionId === suggestionId);
}

/**
 * Student: the suggestions still waiting for an answer.
 *
 * An answered one is kept on the wire until the guardian takes it back — the
 * answer has to keep travelling — but it is not a question any more, so it is
 * not shown as one.
 */
export function openGoalSuggestions(panels: Panels): GoalSuggestion[] {
  return (panels.student.inbox.goals ?? []).filter((goal) => !goalAnswerFor(panels, goal.id));
}

/**
 * Weekly results for the past few weeks, oldest first — the student's own
 * charts. Everything is computed from the planner; nothing new is stored.
 */
export function weeklyHistory(state: PlannerState, count = 6, from = todayISO()): WeekResults[] {
  const weeks: WeekResults[] = [];
  let week = startOfWeek(from);
  for (let index = 0; index < count; index += 1) {
    weeks.push(weekResults(state, week));
    week = addDays(week, -7);
  }
  return weeks.reverse();
}
