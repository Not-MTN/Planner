/** Actionable panel features, computed locally without widening the sharing boundary. */
import { addDays, isValidISODate, todayISO } from './dates';
import { t } from './i18n';
import { daysUntil, newId, planEnd, weekOf, withSubject } from './panels';
import type { GuardianLink, PlanCadence, PlannerState, StudentSubject, Task } from './types';

export const SUBJECT_LIMIT = 40;
export const PLAN_STEP_LIMIT = 40;

export function subjectKey(name: string): string {
  return name.trim().toLowerCase();
}

export type StudyWindow = 'today' | 'week' | 'all';

/** Only tracked subjects; overdue work stays visible, waiting work does not. */
export function studyQueue(state: PlannerState, window: StudyWindow, subjectId = '', today = todayISO()): Task[] {
  const subjects = state.panels.student.subjects.filter((subject) => !subjectId || subject.id === subjectId);
  const names = new Set(subjects.map((subject) => subjectKey(subject.name)));
  const end = window === 'today' ? today : addDays(weekOf(today), 6);
  return state.tasks
    .filter((task) => !task.completed && !task.waiting && names.has(subjectKey(task.category)))
    .filter((task) => window === 'all' || (!!task.dueDate && task.dueDate <= end))
    .sort(
      (a, b) =>
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') ||
        a.sortOrder - b.sortOrder,
    );
}

/** Past and invalid exams never crowd out the next exam. */
export function upcomingExams(
  subjects: StudentSubject[],
  today = todayISO(),
): Array<{ subject: StudentSubject; days: number }> {
  return subjects
    .flatMap((subject) => {
      if (!subject.examDate || !isValidISODate(subject.examDate)) return [];
      const days = daysUntil(subject.examDate, today);
      return days !== null && days >= 0 ? [{ subject, days }] : [];
    })
    .sort((a, b) => a.days - b.days || a.subject.name.localeCompare(b.subject.name));
}

export interface SubjectDraft {
  name: string;
  examDate: string;
  targetHours: string;
}

export function subjectDraftError(subjects: StudentSubject[], draft: SubjectDraft, editingId?: string): string | null {
  if (!draft.name.trim()) return t('Give the subject a name.');
  if (subjects.some((subject) => subject.id !== editingId && subjectKey(subject.name) === subjectKey(draft.name)))
    return t('You already track a subject with that name.');
  if (!editingId && subjects.length >= SUBJECT_LIMIT) return t('You can track up to 40 subjects.');
  if (draft.examDate && !isValidISODate(draft.examDate)) return t('Choose a valid exam date.');
  const hours = Number(draft.targetHours);
  if (draft.targetHours && (!Number.isFinite(hours) || hours < 0.5 || hours > 168))
    return t('Choose a weekly target between 0.5 and 168 hours, or leave it empty.');
  return null;
}

/** Rename atomically with its categories, so existing tasks and focus attribution survive. */
export function saveStudentSubject(
  state: PlannerState,
  subject: StudentSubject,
  now = new Date().toISOString(),
): PlannerState {
  const previous = state.panels.student.subjects.find((item) => item.id === subject.id);
  if (!previous) {
    if (state.panels.student.subjects.length >= SUBJECT_LIMIT) return state;
    return { ...state, panels: withSubject(state.panels, subject) };
  }
  const renamed = previous.name !== subject.name;
  const matches = (category: string) => renamed && subjectKey(category) === subjectKey(previous.name);
  return {
    ...state,
    panels: {
      ...state.panels,
      student: {
        ...state.panels.student,
        subjects: state.panels.student.subjects.map((item) => (item.id === subject.id ? subject : item)),
      },
    },
    tasks: renamed
      ? state.tasks.map((task) => (matches(task.category) ? { ...task, category: subject.name, updatedAt: now } : task))
      : state.tasks,
    events: renamed
      ? state.events.map((event) =>
          matches(event.category) ? { ...event, category: subject.name, updatedAt: now } : event,
        )
      : state.events,
  };
}

export type GuardianResultStatus = 'pending' | 'awaiting' | 'current' | 'older';
export type RosterFilter = 'all' | 'current' | 'waiting' | 'older';
export type RosterSort = 'name' | 'updated';

/** Freshness is a fact, not a judgement about the student's performance. */
export function guardianResultStatus(link: GuardianLink, today = todayISO()): GuardianResultStatus {
  if (link.status === 'pending') return 'pending';
  if (!link.results) return 'awaiting';
  // The student and guardian may choose different week starts. Use the
  // snapshot's own seven-day period, rather than the guardian's preference.
  const start = link.results.weekOf;
  return isValidISODate(start) && start <= today && today <= addDays(start, 6) ? 'current' : 'older';
}

export function guardianStatusLabel(status: GuardianResultStatus): string {
  switch (status) {
    case 'pending':
      return t('Invitation pending');
    case 'awaiting':
      return t('Awaiting results');
    case 'current':
      return t('This week');
    case 'older':
      return t('Older results');
  }
}

export function filterGuardianLinks(
  links: GuardianLink[],
  query: string,
  filter: RosterFilter,
  sort: RosterSort,
  today = todayISO(),
): GuardianLink[] {
  const search = query.trim().replace(/^@/, '').toLowerCase();
  return links
    .filter((link) => !search || `${link.displayName}\n${link.username}`.toLowerCase().includes(search))
    .filter((link) => {
      const status = guardianResultStatus(link, today);
      return (
        filter === 'all' || (filter === 'waiting' ? status === 'pending' || status === 'awaiting' : status === filter)
      );
    })
    .sort((a, b) => {
      if (sort === 'updated') {
        const order = (b.results?.updatedAt ?? '').localeCompare(a.results?.updatedAt ?? '');
        if (order) return order;
      }
      return a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username);
    });
}

export interface PlanStepDraft {
  id: string;
  title: string;
  subject: string;
  minutes: string;
  date: string;
}

export interface PanelPlanDraft {
  cadence: PlanCadence;
  start: string;
  title: string;
  note: string;
  items: PlanStepDraft[];
}

export function emptyPlanStep(): PlanStepDraft {
  return { id: newId('step'), title: '', subject: '', minutes: '', date: '' };
}

/** Reject impossible dates, out-of-period steps and non-finite effort before sending. */
export function planDraftError(draft: PanelPlanDraft): string | null {
  const items = draft.items.filter((item) => item.title.trim());
  if (!draft.title.trim() || items.length === 0) return t('Give the plan a name and at least one thing to do.');
  if (!isValidISODate(draft.start)) return t('Choose a valid start date.');
  const end = planEnd(draft);
  if (items.some((item) => item.date && (!isValidISODate(item.date) || item.date < draft.start || item.date > end)))
    return t('Every step date must fall inside the plan’s dates.');
  if (
    items.some(
      (item) =>
        item.minutes &&
        (!Number.isFinite(Number(item.minutes)) || Number(item.minutes) < 1 || Number(item.minutes) > 1440),
    )
  )
    return t('Choose between 1 and 1440 minutes per step, or leave it empty.');
  if (draft.items.some((item) => !item.title.trim() && (item.date || item.minutes || item.subject.trim())))
    return t('Give each filled-in step a title.');
  if (items.length > PLAN_STEP_LIMIT) return t('A plan can have up to 40 steps.');
  return null;
}

/** Templates are editable suggestions, not automatic changes to a student's planner. */
export function studyPlanTemplate(
  kind: 'revision' | 'balanced',
  cadence: PlanCadence,
  start: string,
  subject = '',
  from = todayISO(),
): PanelPlanDraft {
  const last = planEnd({ cadence, start });
  const first = from > start && from <= last ? from : start;
  const offset = cadence === 'month' ? [0, 7, 14] : [0, 2, 4];
  const titles =
    kind === 'revision'
      ? [t('Review the tricky topics'), t('Try practice questions'), t('Check what needs another pass')]
      : [t('Choose one topic to work on'), t('Practice what you learned'), t('Review the week and make room to rest')];
  return {
    cadence,
    start,
    title: kind === 'revision' ? t('Exam preparation') : t('A steady study week'),
    note: t('Short sessions, with room to rest. Adjust this together.'),
    items: titles.map((title, index) => ({
      ...emptyPlanStep(),
      title,
      subject,
      minutes: index === 2 ? '15' : '25',
      date: addDays(first, offset[index]!) <= last ? addDays(first, offset[index]!) : last,
    })),
  };
}
