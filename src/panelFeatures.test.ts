import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, setWeekStart } from './dates';
import { addEvent, addTask, logFocus, toggleTask } from './mutate';
import { planEnd, subjectMinutes } from './panels';
import {
  emptyPlanStep,
  filterGuardianLinks,
  guardianResultStatus,
  planDraftError,
  saveStudentSubject,
  studyPlanTemplate,
  studyQueue,
  subjectDraftError,
  upcomingExams,
  type PanelPlanDraft,
} from './panelFeatures';
import { createEmptyState, type GuardianLink, type PlannerState, type StudentSubject, type TaskInput } from './types';

const today = '2026-09-30';
const subject: StudentSubject = {
  id: 'physics',
  name: 'Physics',
  accent: 'blue',
  examDate: '2026-10-02',
  targetMinutes: 120,
};
const input: TaskInput = {
  title: 'Revise',
  priority: 'medium',
  dueDate: today,
  dueTime: null,
  category: 'Physics',
  note: '',
  goalId: null,
};

function studentState(): PlannerState {
  const state = createEmptyState();
  state.panels.student = {
    ...state.panels.student,
    enabled: true,
    subjects: [subject, { ...subject, id: 'maths', name: 'Maths' }],
  };
  return state;
}

function link(id: string, extra: Partial<GuardianLink> = {}): GuardianLink {
  return {
    id,
    username: id,
    displayName: id,
    status: 'linked',
    history: [],
    linkId: id,
    code: null,
    wrappedShareKey: 'key',
    results: null,
    plans: [],
    ...extra,
  };
}

function result(week: string, updatedAt = `${week}T12:00:00Z`) {
  return { weekOf: week, planned: 0, done: 0, focusMinutes: 0, subjects: [], headline: null, updatedAt };
}

beforeEach(() => setWeekStart(1));
afterEach(() => setWeekStart(1));

describe('student study queue', () => {
  it('includes overdue work, matches categories case-insensitively, and excludes completed, waiting, and personal tasks', () => {
    let state = studentState();
    state = addTask(state, { ...input, title: 'Overdue', dueDate: '2026-09-20', category: ' physics ' }, 'late');
    state = addTask(state, input, 'today');
    state = addTask(state, { ...input, dueDate: '2026-10-04' }, 'weekend');
    state = addTask(state, { ...input, dueDate: '2026-10-05' }, 'next-week');
    state = addTask(state, { ...input, dueDate: null }, 'undated');
    state = addTask(state, { ...input, waiting: 'A reply' }, 'waiting');
    state = addTask(state, { ...input, category: 'personal' }, 'personal');
    state = addTask(state, input, 'done');
    state = toggleTask(state, 'done');
    expect(studyQueue(state, 'today', '', today).map((task) => task.id)).toEqual(['late', 'today']);
    expect(studyQueue(state, 'week', '', today).map((task) => task.id)).toEqual(['late', 'today', 'weekend']);
    expect(studyQueue(state, 'all', '', today).map((task) => task.id)).toEqual([
      'late',
      'today',
      'weekend',
      'next-week',
      'undated',
    ]);
    expect(state.tasks).toHaveLength(8);
  });

  it('filters by subject id and keeps chronological ordering without changing stored task order', () => {
    let state = addTask(studentState(), { ...input, category: 'Maths', dueTime: '12:00' }, 'math');
    state = addTask(state, { ...input, dueTime: '14:00' }, 'afternoon');
    state = addTask(state, { ...input, dueTime: '09:00' }, 'morning');
    expect(studyQueue(state, 'today', 'physics', today).map((task) => task.id)).toEqual(['morning', 'afternoon']);
    expect(state.tasks.map((task) => task.id)).toEqual(['math', 'afternoon', 'morning']);
  });

  it('only lists valid upcoming exams, including today, nearest first', () => {
    const exams = upcomingExams(
      [
        subject,
        { ...subject, id: 'past', examDate: '2026-09-29' },
        { ...subject, id: 'now', examDate: today },
        { ...subject, id: 'none', examDate: null },
        { ...subject, id: 'bad', examDate: '2026-02-30' },
      ],
      today,
    );
    expect(exams.map(({ subject: item, days }) => [item.id, days])).toEqual([
      ['now', 0],
      ['physics', 2],
    ]);
  });
});

describe('subject editing', () => {
  it('rejects duplicate names, invalid dates, impossible targets, and overflowing the storage cap', () => {
    const draft = { name: ' physics ', examDate: '', targetHours: '' };
    expect(subjectDraftError([subject], draft)).toContain('already track');
    expect(subjectDraftError([subject], draft, subject.id)).toBeNull();
    expect(subjectDraftError([], { ...draft, name: '  ' })).toContain('name');
    expect(subjectDraftError([], { ...draft, examDate: '2026-02-30' })).toContain('valid exam');
    for (const targetHours of ['-1', '0', 'NaN', 'Infinity', '169'])
      expect(subjectDraftError([], { ...draft, targetHours })).toContain('weekly target');
    expect(subjectDraftError([], { ...draft, targetHours: '0.5' })).toBeNull();
    expect(
      subjectDraftError(
        Array.from({ length: 40 }, (_, index) => ({ ...subject, id: String(index), name: String(index) })),
        { ...draft, name: 'New' },
      ),
    ).toContain('40 subjects');
  });

  it('renames matching task/event categories atomically, preserving ids, completions, private notes, and focus attribution', () => {
    let state = addTask(studentState(), { ...input, category: ' physics ', note: 'private reason' }, 'tracked');
    state = addTask(state, { ...input, category: 'personal' }, 'private');
    state = toggleTask(state, 'tracked');
    state = addEvent(
      state,
      {
        title: 'Revision',
        date: today,
        startTime: '09:00',
        endTime: '10:00',
        category: 'Physics',
        note: '',
        important: false,
      },
      'lesson',
    );
    state = logFocus(state, { taskId: 'tracked', title: 'Revise', minutes: 30 }, 'focus', `${today}T10:00:00Z`, today);
    const renamed = { ...subject, name: 'Physical science', targetMinutes: 90 };
    const next = saveStudentSubject(state, renamed, 'edit-time');
    expect(next.panels.student.subjects[0]).toEqual(renamed);
    expect(next.tasks[0]).toMatchObject({
      id: 'tracked',
      category: 'Physical science',
      completed: true,
      note: 'private reason',
      updatedAt: 'edit-time',
    });
    expect(next.events[0].category).toBe('Physical science');
    expect(next.tasks[1]).toBe(state.tasks[1]);
    expect(next.focusLog).toBe(state.focusLog);
    expect(next.notes).toBe(state.notes);
    expect(subjectMinutes(next, renamed, '2026-09-28')).toBe(30);
    expect(state.tasks[0].category).toBe(' physics ');
  });

  it('adds a new subject without rewriting unrelated planner data', () => {
    const state = createEmptyState();
    const next = saveStudentSubject(state, subject);
    expect(next.panels.student.subjects).toEqual([subject]);
    expect(next.tasks).toBe(state.tasks);
    expect(next.panels.student.enabled).toBe(false);
  });
});

describe('guardian roster', () => {
  it('distinguishes a pending invitation from a linked student waiting for their first results', () => {
    expect(guardianResultStatus(link('pending', { status: 'pending' }), today)).toBe('pending');
    expect(guardianResultStatus(link('first-share'), today)).toBe('awaiting');
    expect(guardianResultStatus(link('quiet', { results: result('2026-09-28') }), today)).toBe('current');
    expect(guardianResultStatus(link('old', { results: result('2026-09-21') }), today)).toBe('older');
  });

  it('uses the configured week start rather than a hard-coded Monday', () => {
    setWeekStart(6);
    expect(guardianResultStatus(link('student', { results: result('2026-09-26') }), today)).toBe('current');
    // A Monday-start student's snapshot is current even for a Saturday-start guardian.
    expect(guardianResultStatus(link('other-week-start', { results: result('2026-09-28') }), today)).toBe('current');
  });

  it('searches names and @usernames, filters freshness, sorts updates, and leaves the stored roster alone', () => {
    const roster = [
      link('zoe', { displayName: 'Zoe', results: result('2026-09-28', `${today}T12:00:00Z`) }),
      link('amir', { displayName: 'Amir', results: result('2026-09-21') }),
      link('sara', { displayName: 'Sara', status: 'pending' }),
      link('nina', { displayName: 'Nina' }),
    ];
    expect(filterGuardianLinks(roster, ' @ZOE ', 'all', 'name', today).map((item) => item.id)).toEqual(['zoe']);
    expect(filterGuardianLinks(roster, '', 'waiting', 'name', today).map((item) => item.id)).toEqual(['nina', 'sara']);
    expect(filterGuardianLinks(roster, '', 'older', 'name', today).map((item) => item.id)).toEqual(['amir']);
    expect(filterGuardianLinks(roster, '', 'current', 'name', today).map((item) => item.id)).toEqual(['zoe']);
    expect(filterGuardianLinks(roster, '', 'all', 'updated', today).map((item) => item.id)).toEqual([
      'zoe',
      'amir',
      'nina',
      'sara',
    ]);
    expect(roster.map((item) => item.id)).toEqual(['zoe', 'amir', 'sara', 'nina']);
  });
});

describe('guardian plan drafts', () => {
  const fresh = (): PanelPlanDraft => ({
    cadence: 'week',
    start: '2026-09-28',
    title: 'Physics week',
    note: '',
    items: [{ ...emptyPlanStep(), title: 'Practice', date: today, minutes: '25' }],
  });

  it('validates real dates and step dates inside the plan period before anything is sent', () => {
    const draft = fresh();
    expect(planDraftError(draft)).toBeNull();
    expect(planDraftError({ ...draft, start: '2026-02-30' })).toContain('valid start');
    expect(planDraftError({ ...draft, items: [{ ...draft.items[0], date: '2026-10-05' }] })).toContain('inside');
    expect(planDraftError({ ...draft, cadence: 'day' })).toContain('inside');
    expect(planDraftError({ ...draft, cadence: 'day', items: [{ ...draft.items[0], date: draft.start }] })).toBeNull();
  });

  it('rejects blank plans, untitled filled-in steps, and non-finite or unbounded effort', () => {
    const draft = fresh();
    expect(planDraftError({ ...draft, title: ' ' })).toContain('name');
    expect(planDraftError({ ...draft, items: [emptyPlanStep()] })).toContain('name');
    expect(planDraftError({ ...draft, items: [...draft.items, { ...emptyPlanStep(), subject: 'Maths' }] })).toContain(
      'title',
    );
    for (const minutes of ['-5', '0', 'NaN', 'Infinity', '1441'])
      expect(planDraftError({ ...draft, items: [{ ...draft.items[0], minutes }] })).toContain('minutes');
    expect(
      planDraftError({ ...draft, items: [{ ...draft.items[0], minutes: '', date: '' }, emptyPlanStep()] }),
    ).toBeNull();
    expect(
      planDraftError({ ...draft, items: Array.from({ length: 41 }, () => ({ ...emptyPlanStep(), title: 'Study' })) }),
    ).toContain('40 steps');
  });

  it.each(['day', 'week', 'month'] as const)(
    'keeps every editable starter step within a %s plan, even at month end',
    (cadence) => {
      for (const kind of ['revision', 'balanced'] as const) {
        const draft = studyPlanTemplate(kind, cadence, '2026-09-30', 'Physics');
        expect(draft.items).toHaveLength(3);
        expect(new Set(draft.items.map((item) => item.id)).size).toBe(3);
        expect(
          draft.items.every(
            (item) => item.subject === 'Physics' && item.date >= draft.start && item.date <= planEnd(draft),
          ),
        ).toBe(true);
        expect(planDraftError(draft)).toBeNull();
        expect(draft.items.reduce((sum, item) => sum + Number(item.minutes), 0)).toBe(65);
      }
    },
  );

  it('starts current-period templates today instead of assigning work to days that already passed', () => {
    const week = studyPlanTemplate('revision', 'week', '2026-09-28', 'Physics', today);
    expect(week.items.map((item) => item.date)).toEqual(['2026-09-30', '2026-10-02', '2026-10-04']);
    const month = studyPlanTemplate('balanced', 'month', '2026-09-01', '', today);
    expect(month.items.every((item) => item.date === today)).toBe(true);
  });

  it('uses calendar-month boundaries, including leap years', () => {
    const draft = studyPlanTemplate('balanced', 'month', '2028-02-28');
    expect(planEnd(draft)).toBe('2028-02-29');
    expect(draft.items[2].date).toBe(addDays('2028-02-28', 1));
  });
});
