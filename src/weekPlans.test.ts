// @vitest-environment node
/**
 * The week-plan rules, without a screen: timed lessons sort themselves, only
 * finished lesson-days ask for reports, a report sets its day's ticks, and an
 * old plan can never lock a panel.
 */
import { describe, expect, it } from 'vitest';
import { addDays, formatFullDate } from './dates';
import {
  createEmptyState,
  PLAN_CHANGE_DAYS,
  PLAN_CHANGES_KEPT,
  type GuardianNotice,
  type GuardianPlan,
  type PlanChangeRequest,
  type PlanItem,
} from './types';
import { withPlanItemToggled } from './panels';
import {
  ackFor,
  answeredChangeRequest,
  applyChangeRequest,
  buildChangeRequest,
  canAnswerChangeRequest,
  canApprovePlanPeriod,
  canEditPlanDay,
  canRequestPlanChange,
  changeRequestLabel,
  changeRequestNotice,
  crossedTimeboxes,
  datelessItems,
  diffPlanDay,
  editablePlanDays,
  emptyWeekPlanDraft,
  examWarningDates,
  focusMatchesLesson,
  isRestDay,
  itemsForDay,
  lessonDurationLabel,
  lessonSpanMinutes,
  lessonTimeLabel,
  mergeAcks,
  mergeChangeRequests,
  mergeLinkReports,
  missingReportDays,
  missingReportReminders,
  normalizeLessonEnd,
  normalizeLessonUrl,
  nudgedToday,
  openChangeRequests,
  openRequests,
  pendingChangeRequests,
  planDayChangeSummary,
  planDays,
  planFocusMinutes,
  planWeekDays,
  repairUsed,
  reportFor,
  reportStats,
  requestNotice,
  rollTarget,
  sortPlanItems,
  studentCanTogglePlanItem,
  timetableModel,
  toggleReaction,
  WEEK_LESSON_LIMIT,
  weekPlanDraftError,
  weekReview,
  withDayReport,
  withLessonRolled,
  withPlanDayRewritten,
  withPlanDaysRewritten,
  withStudentChangeRequest,
  withoutStudentChangeRequest,
} from './weekPlans';

const TODAY = '2026-10-12';

function item(partial: Partial<PlanItem> & { id: string; title: string }): PlanItem {
  return { date: null, minutes: null, subject: null, done: false, ...partial };
}

function plan(partial: Partial<GuardianPlan> = {}): GuardianPlan {
  return {
    id: 'plan-1',
    author: 'Parent',
    linkId: 'link-1',
    cadence: 'week',
    start: addDays(TODAY, -6),
    title: 'A week of lessons',
    note: '',
    items: [],
    createdAt: `${TODAY}T08:00:00.000Z`,
    updatedAt: `${TODAY}T08:00:00.000Z`,
    ...partial,
  };
}

function report(planId: string, date: string, doneIds: string[] = []) {
  return {
    id: `report-${planId}-${date}`,
    planId,
    linkId: 'link-1',
    date,
    doneIds,
    note: '',
    createdAt: `${date}T20:00:00.000Z`,
    updatedAt: `${date}T20:00:00.000Z`,
  };
}

describe('reading a week plan', () => {
  it('covers seven days from the chosen start', () => {
    expect(planWeekDays(plan({ start: '2026-10-12' })) ).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(planWeekDays(plan({ start: 'not-a-date' }))).toEqual([]);
  });

  it('sorts a day by time, with untimed lessons last', () => {
    const week = plan({
      items: [
        item({ id: 'c', title: 'Chemistry', date: TODAY, time: '17:00' }),
        item({ id: 'a', title: 'Maths', date: TODAY, time: '08:00' }),
        item({ id: 'u', title: 'Reading', date: TODAY }),
        item({ id: 'b', title: 'Physics', date: TODAY, time: '10:30' }),
      ],
    });
    expect(itemsForDay(week, TODAY).map((lesson) => lesson.id)).toEqual(['a', 'b', 'c', 'u']);
  });

  it('sorts whole plans by day first, and gathers the dateless under any day', () => {
    const week = plan({
      start: TODAY,
      items: [
        item({ id: 'late', title: 'Late', date: addDays(TODAY, 2), time: '08:00' }),
        item({ id: 'early', title: 'Early', date: TODAY, time: '18:00' }),
        item({ id: 'free', title: 'Free' }),
      ],
    });
    expect(sortPlanItems(week.items).map((lesson) => lesson.id)).toEqual(['early', 'late', 'free']);
    expect(datelessItems(week).map((lesson) => lesson.id)).toEqual(['free']);
    expect(datelessItems(plan({ start: TODAY, items: [item({ id: 'out', title: 'Out', date: addDays(TODAY, 9) })] })).map(
      (lesson) => lesson.id,
    )).toEqual(['out']);
  });

  it('treats a bad time as no time rather than failing the week', () => {
    const week = plan({ items: [item({ id: 'bad', title: 'Bad', date: TODAY, time: '25:99' })] });
    expect(itemsForDay(week, TODAY).map((lesson) => lesson.id)).toEqual(['bad']);
  });
});

describe('asking for daily reports', () => {
  const lessons = (date: string) => [item({ id: `m-${date}`, title: 'Maths', date, time: '08:00' })];

  it('asks for finished lesson-days, oldest first', () => {
    const week = plan({ start: addDays(TODAY, -6), items: [...lessons(addDays(TODAY, -2)), ...lessons(addDays(TODAY, -1))] });
    const missing = missingReportDays([week], [], TODAY);
    expect(missing.map((day) => day.date)).toEqual([addDays(TODAY, -2), addDays(TODAY, -1)]);
    expect(missing[0]?.lessons).toHaveLength(1);
  });

  it('never asks for today, the future, or days with no lessons', () => {
    const week = plan({ start: addDays(TODAY, -3), items: lessons(TODAY) });
    expect(missingReportDays([week], [], TODAY)).toHaveLength(0);
    const empty = plan({ start: addDays(TODAY, -6) });
    expect(missingReportDays([empty], [], TODAY)).toHaveLength(0);
  });

  it('lets a student tick today only, then freezes that day when its report is filed', () => {
    const yesterday = addDays(TODAY, -1);
    const tomorrow = addDays(TODAY, 1);
    const week = plan({
      start: TODAY,
      items: [item({ id: 'past', title: 'Past lesson', date: yesterday }), item({ id: 'today', title: 'Today lesson', date: TODAY }), item({ id: 'future', title: 'Future lesson', date: tomorrow })],
    });
    const empty = createEmptyState().panels;
    const student = { ...empty, student: { ...empty.student, inbox: { ...empty.student.inbox, plans: [week] } } };
    expect(studentCanTogglePlanItem(student, week.id, 'past', TODAY)).toBe(false);
    expect(studentCanTogglePlanItem(student, week.id, 'today', TODAY)).toBe(true);
    expect(studentCanTogglePlanItem(student, week.id, 'future', TODAY)).toBe(false);
    const ticked = withPlanItemToggled(student, week.id, 'today', TODAY);
    expect(ticked.student.inbox.plans[0]?.items.find((entry) => entry.id === 'today')?.done).toBe(true);
    const filed = { ...ticked, student: { ...ticked.student, reports: [report(week.id, TODAY, ['today'])] } };
    expect(studentCanTogglePlanItem(filed, week.id, 'today', TODAY)).toBe(false);
    expect(withPlanItemToggled(filed, week.id, 'today', TODAY)).toBe(filed);
  });

  it('stops asking once the report is in', () => {
    const date = addDays(TODAY, -1);
    const week = plan({ start: addDays(TODAY, -6), items: lessons(date) });
    expect(missingReportDays([week], [report(week.id, date)], TODAY)).toHaveLength(0);
    // A report for another plan or day does not count.
    expect(missingReportDays([week], [report('other-plan', date)], TODAY)).toHaveLength(1);
    expect(missingReportDays([week], [report(week.id, addDays(TODAY, -2))], TODAY)).toHaveLength(1);
  });

  it('asks per plan: two guardians, two reports', () => {
    const date = addDays(TODAY, -1);
    const first = plan({ id: 'plan-a', start: addDays(TODAY, -6), items: lessons(date) });
    const second = plan({ id: 'plan-b', start: addDays(TODAY, -6), items: lessons(date) });
    expect(missingReportDays([first, second], [report('plan-a', date)], TODAY).map((day) => day.plan.id)).toEqual([
      'plan-b',
    ]);
  });

  it('leaves day and month plans to their ticks', () => {
    const day = plan({ cadence: 'day', start: addDays(TODAY, -1), items: lessons(addDays(TODAY, -1)) });
    const month = plan({ cadence: 'month', start: addDays(TODAY, -20), items: lessons(addDays(TODAY, -1)) });
    expect(missingReportDays([day, month], [], TODAY)).toHaveLength(0);
  });

  it('keeps an old missed report locked until the student submits it', () => {
    const old = plan({ start: addDays(TODAY, -30), items: lessons(addDays(TODAY, -25)) });
    expect(missingReportDays([old], [], TODAY)).toHaveLength(1);
    expect(missingReportDays([old], [report(old.id, addDays(TODAY, -25))], TODAY)).toHaveLength(0);
    const recent = plan({ start: addDays(TODAY, -20), items: lessons(addDays(TODAY, -15)) });
    expect(missingReportDays([recent], [], TODAY)).toHaveLength(1);
  });

  it('counts reported against missing for the guardian', () => {
    const week = plan({
      start: addDays(TODAY, -6),
      items: [...lessons(addDays(TODAY, -2)), ...lessons(addDays(TODAY, -1))],
    });
    expect(reportStats([week], [], TODAY)).toEqual({ reported: 0, missing: 2 });
    expect(reportStats([week], [report(week.id, addDays(TODAY, -2))], TODAY)).toEqual({ reported: 1, missing: 1 });
  });

  it('requires each report to be submitted and guardian-approved before finishing a week', () => {
    const start = '2026-10-01';
    const week = plan({ start, items: [item({ id: 'a', title: 'Maths', date: start }), item({ id: 'b', title: 'Physics', date: '2026-10-02' })] });
    const first = report(week.id, start, ['a']);
    const second = report(week.id, '2026-10-02', ['b']);
    const approvals = [first, second].map((entry) => ({
      id: `ack-${entry.id}`, reportId: entry.id, planId: week.id, linkId: week.linkId, date: entry.date,
      text: '', reactions: [], approvedAt: '2026-10-08T12:00:00.000Z', createdAt: '2026-10-08T12:00:00.000Z',
    }));
    expect(canApprovePlanPeriod(week, [first, second], approvals, '2026-10-07')).toBe(false);
    expect(canApprovePlanPeriod(week, [first], approvals, '2026-10-08')).toBe(false);
    expect(canApprovePlanPeriod(week, [first, second], [approvals[0]!, { ...approvals[1]!, approvedAt: null }], '2026-10-08')).toBe(false);
    expect(canApprovePlanPeriod(week, [first, second], approvals, '2026-10-08')).toBe(true);
    expect(canApprovePlanPeriod({ ...week, approvedAt: '2026-10-08T12:00:00.000Z' }, [first, second], approvals, '2026-10-09')).toBe(false);
  });

  it('finds one report among many', () => {
    const reports = [report('plan-1', addDays(TODAY, -1)), report('plan-1', addDays(TODAY, -2))];
    expect(reportFor(reports, 'plan-1', addDays(TODAY, -2))?.id).toBe(`report-plan-1-${addDays(TODAY, -2)}`);
    expect(reportFor(reports, 'plan-1', TODAY)).toBeUndefined();
  });
});

describe('filing a daily report', () => {
  it('saves the report and sets its day’s ticks, leaving other days alone', () => {
    const yesterday = addDays(TODAY, -1);
    const state = createEmptyState();
    state.panels.student.inbox.plans = [
      plan({
        items: [
          item({ id: 'y1', title: 'Maths', date: yesterday }),
          item({ id: 'y2', title: 'Physics', date: yesterday, done: true }),
          item({ id: 't1', title: 'Chemistry', date: TODAY, done: true }),
        ],
      }),
    ];
    const next = withDayReport(state.panels, report('plan-1', yesterday, ['y1']));
    expect(next.student.reports).toHaveLength(1);
    const items = next.student.inbox.plans[0]?.items ?? [];
    expect(items.find((entry) => entry.id === 'y1')?.done).toBe(true);
    expect(items.find((entry) => entry.id === 'y2')?.done).toBe(false);
    expect(items.find((entry) => entry.id === 't1')?.done).toBe(true);
  });

  it('trims the note and keeps the newest seventy reports for delayed synchronization', () => {
    const state = createEmptyState();
    const many = Array.from({ length: 75 }, (_, index) =>
      report('plan-1', addDays(TODAY, -(index + 1)), []),
    );
    let panels = state.panels;
    for (const entry of many) panels = withDayReport(panels, entry);
    expect(panels.student.reports).toHaveLength(70);
    expect(panels.student.reports?.[0]?.date).toBe(addDays(TODAY, -1));

    const noted = withDayReport(state.panels, { ...report('plan-1', addDays(TODAY, -1)), note: `  ${'x'.repeat(400)}  ` });
    expect(noted.student.reports?.[0]?.note).toHaveLength(280);
  });

  it('filing the last missing report clears the lock', () => {
    const date = addDays(TODAY, -1);
    const state = createEmptyState();
    state.panels.student.inbox.plans = [plan({ items: [item({ id: 'y1', title: 'Maths', date })] })];
    const before = missingReportDays(state.panels.student.inbox.plans, [], TODAY);
    expect(before).toHaveLength(1);
    const after = withDayReport(state.panels, report('plan-1', date, ['y1']));
    expect(missingReportDays(after.student.inbox.plans, after.student.reports ?? [], TODAY)).toHaveLength(0);
  });
});

describe('receiving reports as a guardian', () => {
  it('merges by id, newest first, capped at seventy', () => {
    const current = [report('plan-1', addDays(TODAY, -3))];
    const incoming = [report('plan-1', addDays(TODAY, -1)), report('plan-1', addDays(TODAY, -3))];
    const merged = mergeLinkReports(current, incoming);
    expect(merged.map((entry) => entry.date)).toEqual([addDays(TODAY, -1), addDays(TODAY, -3)]);
    const filed = report('plan-shared', addDays(TODAY, -2));
    const duplicate = { ...filed, id: 'report-from-another-device', note: 'A competing filing.', createdAt: '2026-10-12T21:00:00.000Z' };
    expect(mergeLinkReports([duplicate], [filed])).toEqual([filed]);
    const overflow = Array.from({ length: 80 }, (_, index) => report(`plan-${index}`, addDays(TODAY, -1)));
    expect(mergeLinkReports([], overflow)).toHaveLength(70);
  });
});

describe('planning a week', () => {
  it('starts empty, seven days from the chosen start', () => {
    const draft = emptyWeekPlanDraft('2026-10-12');
    expect(draft.days.map((day) => day.offset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(draft.days.every((day) => day.lessons.length === 0)).toBe(true);
  });

  it('asks for a name, a start, and at least one lesson', () => {
    expect(weekPlanDraftError(emptyWeekPlanDraft('2026-10-12'))).toBe('Give the plan a name and at least one thing to do.');
    const named = { ...emptyWeekPlanDraft('2026-10-12'), title: 'Week' };
    expect(weekPlanDraftError(named)).toBe('Give the plan a name and at least one thing to do.');
    const dated = { ...named, start: 'nope' };
    dated.days[0] = { offset: 0, lessons: [{ id: 'l1', name: 'Maths', time: '', url: '' }] };
    expect(weekPlanDraftError(dated)).toBe('Choose a valid start date.');
  });

  it('rejects a bad time and a week past sixty lessons', () => {
    const draft = emptyWeekPlanDraft('2026-10-12');
    draft.title = 'Week';
    draft.days[0] = { offset: 0, lessons: [{ id: 'l1', name: 'Maths', time: '9 o’clock', url: '' }] };
    expect(weekPlanDraftError(draft)).toBe('Choose a valid time.');
    draft.days[0] = {
      offset: 0,
      lessons: Array.from({ length: 61 }, (_, index) => ({ id: `l${index}`, name: 'Maths', time: '08:00', url: '' })),
    };
    expect(weekPlanDraftError(draft)).toBe('A week plan can hold up to 60 lessons.');
    draft.days[0]!.lessons = draft.days[0]!.lessons.slice(0, 60);
    expect(weekPlanDraftError(draft)).toBeNull();
  });
});

describe('reminding a student about missing reports', () => {
  it('says nothing when the panel is off or nothing is missing', () => {
    const off = createEmptyState().panels;
    expect(missingReportReminders(off, TODAY)).toEqual([]);
    const on = createEmptyState().panels;
    on.student.enabled = true;
    expect(missingReportReminders(on, TODAY)).toEqual([]);
  });

  it('sends one nudge a day while days stay missing', () => {
    const date = addDays(TODAY, -1);
    const panels = createEmptyState().panels;
    panels.student.enabled = true;
    panels.student.inbox.plans = [plan({ items: [item({ id: 'y1', title: 'Maths', date })] })];
    const reminders = missingReportReminders(panels, TODAY);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.key).toBe(`${TODAY}|report-missing`);
    expect(reminders[0]?.title).toBe('Daily report missing');
    const filed = withDayReport(panels, report('plan-1', date, ['y1']));
    expect(missingReportReminders(filed, TODAY)).toEqual([]);
  });
});

describe('rest days', () => {
  const friday = '2026-10-09'; // a Friday
  const planWithRest = () =>
    plan({
      start: '2026-10-05',
      restDays: [5],
      items: [item({ id: 'f', title: 'Maths', date: friday, time: '08:00' })],
    });

  it('knows a rest day by its weekday', () => {
    expect(isRestDay(planWithRest(), friday)).toBe(true);
    expect(isRestDay(planWithRest(), '2026-10-10')).toBe(false);
    expect(isRestDay(plan(), friday)).toBe(false);
    expect(isRestDay(planWithRest(), 'not-a-date')).toBe(false);
  });

  it('never asks for a report on a rest day', () => {
    const week = planWithRest();
    expect(missingReportDays([week], [], TODAY)).toHaveLength(0);
    expect(reportStats([week], [], TODAY)).toEqual({ reported: 0, missing: 0 });
    expect(missingReportDays([{ ...week, restDays: [] }], [], TODAY)).toHaveLength(1);
  });
});

describe('answering reports', () => {
  const ack = (id: string, reportId: string, createdAt: string, text = '', reactions: string[] = []) => ({
    id,
    reportId,
    planId: 'plan-1',
    linkId: 'link-1',
    date: addDays(TODAY, -1),
    text,
    reactions,
    createdAt,
  });

  it('finds the answer to one report', () => {
    expect(ackFor([ack('a1', 'r1', `${TODAY}T08:00:00.000Z`)], 'r1')?.id).toBe('a1');
    expect(ackFor([], 'r1')).toBeUndefined();
  });

  it('merges answers by id, newest first', () => {
    const merged = mergeAcks(
      [ack('old', 'r1', `${TODAY}T08:00:00.000Z`)],
      [ack('new', 'r2', `${TODAY}T09:00:00.000Z`), ack('old', 'r1', `${TODAY}T08:00:00.000Z`)],
    );
    expect(merged.map((entry) => entry.id)).toEqual(['new', 'old']);
  });
});

describe('the week in review', () => {
  function streakWeek(): GuardianPlan {
    const start = addDays(TODAY, -6);
    return plan({
      start,
      items: [4, 3, 2, 1].map((back) =>
        item({ id: `d${back}`, title: 'Maths', date: addDays(TODAY, -back), time: '08:00', done: back > 1 }),
      ),
    });
  }

  it('counts reported days, lessons, and the running streak', () => {
    const week = streakWeek();
    const reports = [4, 3, 2].map((back) => report('plan-1', addDays(TODAY, -back), [`d${back}`]));
    // Yesterday is missing, so the streak is broken even though older days reported.
    expect(weekReview(week, reports, TODAY)).toEqual({
      lessonDays: 4,
      reported: 3,
      lessonsDone: 3,
      lessonsTotal: 4,
      streak: 0,
    });
    const filed = [...reports, report('plan-1', addDays(TODAY, -1), ['d1'])];
    expect(weekReview(week, filed, TODAY)).toEqual({
      lessonDays: 4,
      reported: 4,
      lessonsDone: 3,
      lessonsTotal: 4,
      streak: 4,
    });
  });

  it('lets rest and empty days pass without breaking the streak', () => {
    const week = streakWeek();
    week.restDays = [new Date(`${addDays(TODAY, -2)}T12:00:00Z`).getDay()];
    const reports = [4, 3, 1].map((back) => report('plan-1', addDays(TODAY, -back), [`d${back}`]));
    const review = weekReview(week, reports, TODAY);
    expect(review.lessonDays).toBe(3);
    expect(review.reported).toBe(3);
    expect(review.streak).toBe(3);
  });

  it('stays quiet when there is nothing to review', () => {
    expect(weekReview(plan({ start: TODAY }), [], TODAY)).toEqual({
      lessonDays: 0,
      reported: 0,
      lessonsDone: 0,
      lessonsTotal: 0,
      streak: 0,
    });
  });
});

describe('the timetable model', () => {
  it('groups lessons by day and time, with the untimed in their own row', () => {
    const week = plan({
      start: TODAY,
      items: [
        item({ id: 'b', title: 'Physics', date: TODAY, time: '10:00' }),
        item({ id: 'a', title: 'Maths', date: TODAY, time: '08:00' }),
        item({ id: 'c', title: 'Reading', date: TODAY }),
        item({ id: 'd', title: 'Chemistry', date: addDays(TODAY, 1), time: '08:00' }),
      ],
    });
    const grid = timetableModel(week, []);
    expect(grid.days).toHaveLength(7);
    expect(grid.times).toEqual(['08:00', '10:00']);
    expect(grid.lessonsFor(TODAY, '08:00').map((lesson) => lesson.id)).toEqual(['a']);
    expect(grid.lessonsFor(TODAY, null).map((lesson) => lesson.id)).toEqual(['c']);
    expect(grid.lessonsFor(addDays(TODAY, 1), '10:00')).toHaveLength(0);
  });

  it('marks reported and rest days', () => {
    const week = plan({ start: addDays(TODAY, -6), restDays: [0, 1, 2, 3, 4, 5, 6] });
    const grid = timetableModel(week, [report('plan-1', addDays(TODAY, -1))]);
    expect(grid.reported(addDays(TODAY, -1))).toBe(true);
    expect(grid.reported(TODAY)).toBe(false);
    expect(grid.rest(addDays(TODAY, -1))).toBe(true);
  });
});

describe('rolling a lesson over', () => {
  it('moves to the next day, but never past the week’s end', () => {
    const week = plan({ start: TODAY });
    expect(rollTarget(week, item({ id: 'a', title: 'Maths', date: TODAY }), [], TODAY)).toBe(addDays(TODAY, 1));
    expect(rollTarget(week, item({ id: 'b', title: 'Physics', date: addDays(TODAY, 6) }), [], TODAY)).toBeNull();
    expect(rollTarget(week, item({ id: 'c', title: 'Free' }), [], TODAY)).toBeNull();
  });

  it('never rolls a past lesson, and skips rest or already-reported days for today’s lesson', () => {
    const week = plan({
      start: addDays(TODAY, -2),
      // Tomorrow rests; a lesson due today can move past it.
      restDays: [new Date(`${addDays(TODAY, 1)}T12:00:00Z`).getUTCDay()],
    });
    const past = item({ id: 'past', title: 'Maths', date: addDays(TODAY, -2) });
    expect(rollTarget(week, past, [], TODAY)).toBeNull();
    const todayItem = item({ id: 'today', title: 'Physics', date: TODAY });
    expect(rollTarget(week, todayItem, [], TODAY)).toBe(addDays(TODAY, 2));
    const allReported = [TODAY, addDays(TODAY, 2), addDays(TODAY, 3), addDays(TODAY, 4)].map((date) =>
      report('plan-1', date),
    );
    expect(rollTarget(week, todayItem, allReported, TODAY)).toBeNull();
  });

  it('picks the quietest upcoming day, earliest first when tied', () => {
    const week = plan({
      start: TODAY,
      items: [
        item({ id: 'busy-1', title: 'Busy one', date: addDays(TODAY, 1) }),
        item({ id: 'busy-2', title: 'Busy two', date: addDays(TODAY, 1) }),
        item({ id: 'busy-3', title: 'Busy three', date: addDays(TODAY, 1) }),
        item({ id: 'calm', title: 'Calm', date: addDays(TODAY, 3) }),
      ],
    });
    // Tomorrow is full; the empty day after it wins over the calmer-but-later one.
    expect(rollTarget(week, item({ id: 'a', title: 'Maths', date: TODAY }), [], TODAY)).toBe(addDays(TODAY, 2));
  });

  it('pushes one unfinished lesson on, keeping its time', () => {
    const state = createEmptyState();
    state.panels.student.inbox.plans = [
      plan({
        start: TODAY,
        items: [
          item({ id: 'a', title: 'Maths', date: TODAY, time: '08:00' }),
          item({ id: 'b', title: 'Done', date: TODAY, done: true }),
        ],
      }),
    ];
    const next = withLessonRolled(state.panels, 'plan-1', 'a', TODAY);
    const items = next.student.inbox.plans[0]?.items ?? [];
    expect(items.find((entry) => entry.id === 'a')).toMatchObject({ date: addDays(TODAY, 1), time: '08:00' });
    // Finished lessons and unknown ids leave the panels untouched.
    expect(withLessonRolled(state.panels, 'plan-1', 'b', TODAY)).toBe(state.panels);
    expect(withLessonRolled(state.panels, 'plan-1', 'nope', TODAY)).toBe(state.panels);
  });
});

describe('nudges, focus, and streak repair', () => {
  const notice = (partial: { kind?: GuardianNotice['kind']; student?: string; createdAt?: string }): GuardianNotice => ({
    id: 'notice-1',
    student: 'nina',
    author: 'Dr Noor',
    summary: 'A gentle nudge',
    weekOf: '',
    createdAt: `${TODAY}T09:00:00.000Z`,
    read: false,
    ...partial,
  });

  it('allows one nudge per student per day', () => {
    expect(nudgedToday([], 'nina', TODAY)).toBe(false);
    expect(nudgedToday([notice({ kind: 'note' })], 'nina', TODAY)).toBe(false);
    expect(nudgedToday([notice({ kind: 'nudge' })], 'nina', TODAY)).toBe(true);
    expect(nudgedToday([notice({ kind: 'nudge', student: 'omar' })], 'nina', TODAY)).toBe(false);
    expect(nudgedToday([notice({ kind: 'nudge', createdAt: `${addDays(TODAY, -1)}T09:00:00Z` })], 'nina', TODAY)).toBe(
      false,
    );
  });

  it('matches focus sessions to lessons by word, title, or subject', () => {
    const lesson = item({ id: 'a', title: 'Physics problems', subject: 'Physics' });
    expect(focusMatchesLesson('physics homework', lesson)).toBe(true);
    expect(focusMatchesLesson('Evening reading', item({ id: 'b', title: 'Evening reading' }))).toBe(true);
    expect(focusMatchesLesson('Read ten pages', lesson, 'physics')).toBe(true);
    expect(focusMatchesLesson('Open the pod bay doors', item({ id: 'c', title: 'PE' }))).toBe(false);
    expect(focusMatchesLesson('Water the plants', lesson, 'home')).toBe(false);
  });

  it('counts each matching session once, on lesson days only', () => {
    const week = plan({
      start: TODAY,
      items: [
        item({ id: 'a', title: 'Maths', date: TODAY }),
        item({ id: 'b', title: 'Maths revision', date: TODAY }),
      ],
    });
    const sessions = [
      { id: 's1', taskId: null, title: 'maths homework', minutes: 25, date: TODAY, endedAt: `${TODAY}T18:00:00Z` },
      { id: 's2', taskId: null, title: 'water the plants', minutes: 10, date: TODAY, endedAt: `${TODAY}T19:00:00Z` },
      { id: 's3', taskId: null, title: 'maths', minutes: 30, date: addDays(TODAY, 1), endedAt: `${TODAY}T19:00:00Z` },
    ];
    // One matching session counts once despite matching two lessons; the
    // others miss on words and on the lesson-less day.
    expect(planFocusMinutes(week, sessions, [])).toBe(25);
  });

  it('spends the weekly mulligan once per plan', () => {
    expect(repairUsed([], 'plan-1')).toBe(false);
    expect(repairUsed([report('plan-1', addDays(TODAY, -1))], 'plan-1')).toBe(false);
    expect(repairUsed([{ ...report('plan-1', addDays(TODAY, -1)), repair: true }], 'plan-1')).toBe(true);
    expect(repairUsed([{ ...report('plan-1', addDays(TODAY, -1)), repair: true }], 'plan-2')).toBe(false);
  });
});

describe('asking for a plan', () => {
  const ask = (id: string, createdAt: string) => ({ id, linkId: 'link-1', note: '', createdAt });

  it('keeps fresh asks oldest first and drops stale ones', () => {
    const requests = openRequests(
      [
        ask('new', `${TODAY}T08:00:00.000Z`),
        ask('stale', `${addDays(TODAY, -15)}T08:00:00.000Z`),
        ask('old', `${addDays(TODAY, -2)}T08:00:00.000Z`),
      ],
      TODAY,
    );
    expect(requests.map((request) => request.id)).toEqual(['old', 'new']);
  });

  it('reads as a notice naming the student and their words', () => {
    const notice = requestNotice(
      { id: 'q1', linkId: 'link-1', note: 'Exams soon', createdAt: `${TODAY}T08:00:00.000Z` },
      'Nina',
      'nina',
    );
    expect(notice).toMatchObject({ id: 'req-q1', student: 'nina', author: 'Nina', kind: 'request', read: false });
    expect(notice.summary).toContain('Nina asked for a week plan');
    expect(notice.summary).toContain('Exams soon');
  });
});

describe('planning around an exam', () => {
  it('warns about heavy days on the exam day and just before it', () => {
    const start = '2026-10-12';
    const heavy = (offset: number) => ({
      offset,
      lessons: [
        { id: `${offset}a`, name: 'Maths', time: '', url: '' },
        { id: `${offset}b`, name: 'Physics', time: '', url: '' },
        { id: `${offset}c`, name: 'Chemistry', time: '', url: '' },
      ],
    });
    const days = [
      heavy(0),
      { offset: 1, lessons: [] },
      { offset: 2, lessons: [{ id: 'x', name: 'Maths', time: '', url: '' }] },
      heavy(3),
      heavy(4),
      { offset: 5, lessons: [] },
      { offset: 6, lessons: [] },
    ];
    // Exam on day 4: day 2 is too early and too light, day 0 is long past.
    expect(examWarningDates(days, start, '2026-10-16')).toEqual(['2026-10-15', '2026-10-16']);
    expect(examWarningDates(days, start, '')).toEqual([]);
    expect(examWarningDates(days, 'not-a-date', '2026-10-16')).toEqual([]);
  });
});

describe('prep links', () => {
  it('normalizes a typed link and rejects what is not one', () => {
    expect(normalizeLessonUrl('')).toBeNull();
    expect(normalizeLessonUrl('   ')).toBeNull();
    expect(normalizeLessonUrl('example.com/worksheet')).toBe('https://example.com/worksheet');
    expect(normalizeLessonUrl('  https://example.com/vid  ')).toBe('https://example.com/vid');
    expect(normalizeLessonUrl('http://example.com/vid')).toBe('http://example.com/vid');
    expect(normalizeLessonUrl('javascript://example.com/x')).toBeNull();
    expect(normalizeLessonUrl('not a link at all')).toBeNull();
    expect(normalizeLessonUrl('x'.repeat(600))).toBe(`https://${'x'.repeat(500)}`);
  });

  it('refuses to send a week with a broken link', () => {
    const draft = emptyWeekPlanDraft('2026-10-12');
    draft.title = 'Week';
    draft.days[0] = {
      offset: 0,
      lessons: [{ id: 'l1', name: 'Maths', time: '', url: 'not a link at all' }],
    };
    expect(weekPlanDraftError(draft)).toBe('One of the links is not a valid web address.');
    draft.days[0]!.lessons[0]!.url = 'example.com/worksheet';
    expect(weekPlanDraftError(draft)).toBeNull();
  });
});

describe('reacting to a report', () => {
  it('toggles one tap on and off', () => {
    expect(toggleReaction([], '🎉')).toEqual(['🎉']);
    expect(toggleReaction(['🎉'], '🎉')).toEqual([]);
    expect(toggleReaction(['🎉'], '💪')).toEqual(['🎉', '💪']);
  });

  it('refuses emoji that were never offered', () => {
    expect(toggleReaction([], '🍕')).toEqual([]);
    expect(toggleReaction(['🎉'], '🍕')).toEqual(['🎉']);
  });
});

describe('the time-box nudge', () => {
  const lesson = (id: string, minutes: number | null) => ({
    id,
    title: id,
    date: TODAY,
    time: null,
    minutes,
    subject: null,
    url: null,
    done: false,
  });

  it('fires for lessons the session outgrew', () => {
    const lessons = [lesson('a', 1), lesson('b', 25), lesson('c', null)];
    expect(crossedTimeboxes(lessons, 59, new Set())).toEqual([]);
    expect(crossedTimeboxes(lessons, 60, new Set()).map((entry) => entry.id)).toEqual(['a']);
    expect(crossedTimeboxes(lessons, 25 * 60, new Set()).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('never fires twice for the same lesson', () => {
    const lessons = [lesson('a', 1)];
    expect(crossedTimeboxes(lessons, 3600, new Set(['a']))).toEqual([]);
  });
});

/* --------------------------------------------------------- lesson times (14) */

describe('a lesson as a span of time', () => {
  it('keeps an end only when the lesson ends after it starts', () => {
    expect(normalizeLessonEnd('09:00', '11:00')).toBe('11:00');
    expect(normalizeLessonEnd('09:00', '09:00')).toBeNull();
    expect(normalizeLessonEnd('11:00', '09:00')).toBeNull();
    expect(normalizeLessonEnd(null, '11:00')).toBeNull();
    expect(normalizeLessonEnd('09:00', 'eleven')).toBeNull();
  });

  it('measures the span, and words it the way the card reads it', () => {
    expect(lessonSpanMinutes({ time: '09:00', end: '11:00' })).toBe(120);
    expect(lessonSpanMinutes({ time: '09:00', end: null })).toBeNull();
    expect(lessonTimeLabel({ time: '09:00', end: '11:00' })).toBe('09:00 – 11:00');
    expect(lessonTimeLabel({ time: '09:00', end: '08:00' })).toBe('09:00');
    expect(lessonTimeLabel({ time: null, end: '11:00' })).toBeNull();
    expect(lessonDurationLabel({ time: '09:00', end: '11:00' })).toBe('2 h');
    expect(lessonDurationLabel({ time: '09:00', end: '10:30' })).toBe('1 h 30 min');
    expect(lessonDurationLabel({ time: '09:00', end: null })).toBeNull();
  });

  it('sorts a day by when a lesson starts, span or no span', () => {
    const sorted = sortPlanItems([
      item({ id: 'late', title: 'Late', date: TODAY, time: '16:00', end: '17:30' }),
      item({ id: 'early', title: 'Early', date: TODAY, time: '09:00', end: '11:00' }),
      item({ id: 'any', title: 'Any time', date: TODAY }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['early', 'late', 'any']);
  });
});

/* ----------------------------------------------- changing a running plan (15) */

describe('changing a plan that is already running', () => {
  const CLOSED = `${TODAY}T08:00:00.000Z`;

  const running = (partial: Partial<GuardianPlan> = {}) =>
    plan({
      start: addDays(TODAY, -2),
      items: [
        item({ id: 'past', title: 'History', date: addDays(TODAY, -2), time: '09:00', end: '10:00', done: true }),
        item({ id: 'today', title: 'Maths', date: TODAY, time: '09:00' }),
        item({ id: 'next', title: 'Chemistry', date: addDays(TODAY, 1), time: '14:00', end: '16:00' }),
      ],
      ...partial,
    });

  it('lists every day the plan covers', () => {
    expect(planDays(running())).toEqual([
      addDays(TODAY, -2),
      addDays(TODAY, -1),
      TODAY,
      addDays(TODAY, 1),
      addDays(TODAY, 2),
      addDays(TODAY, 3),
      addDays(TODAY, 4),
    ]);
    expect(planDays(running({ start: 'not a date' }))).toEqual([]);
  });

  it('leaves today and the days after it open, and never a day that has gone by', () => {
    const week = running();
    expect(canEditPlanDay(week, addDays(TODAY, -1), TODAY)).toBe(false);
    expect(canEditPlanDay(week, TODAY, TODAY)).toBe(true);
    expect(canEditPlanDay(week, addDays(TODAY, 4), TODAY)).toBe(true);
    expect(canEditPlanDay(week, addDays(TODAY, 5), TODAY)).toBe(false);
    expect(canEditPlanDay(running({ approvedAt: CLOSED }), TODAY, TODAY)).toBe(false);
    expect(editablePlanDays(week, TODAY)).toEqual([
      TODAY,
      addDays(TODAY, 1),
      addDays(TODAY, 2),
      addDays(TODAY, 3),
      addDays(TODAY, 4),
    ]);
    expect(editablePlanDays(running({ approvedAt: CLOSED }), TODAY)).toEqual([]);
  });

  it('rewrites one day and leaves every other day exactly as it was', () => {
    const changed = withPlanDayRewritten(
      running(),
      TODAY,
      [
        { id: 'today', title: 'Maths', time: '10:00', end: '12:00' },
        { title: 'Geometry', time: '15:00' },
      ],
      TODAY,
      new Date('2026-10-12T12:00:00.000Z'),
    )!;
    expect(itemsForDay(changed, TODAY).map((entry) => entry.title)).toEqual(['Maths', 'Geometry']);
    expect(itemsForDay(changed, TODAY)[0]).toMatchObject({ id: 'today', time: '10:00', end: '12:00' });
    // The day that has gone by keeps its tick, and the day after keeps its span.
    expect(itemsForDay(changed, addDays(TODAY, -2))[0]).toMatchObject({ id: 'past', done: true, time: '09:00' });
    expect(itemsForDay(changed, addDays(TODAY, 1))[0]).toMatchObject({ id: 'next', time: '14:00', end: '16:00' });
    // A changed week has to look changed on the wire, or the edit never travels.
    expect(changed.updatedAt).toBe('2026-10-12T12:00:00.000Z');
  });

  it('refuses a past day, a closed period, and a week that would overflow', () => {
    expect(withPlanDayRewritten(running(), addDays(TODAY, -2), [], TODAY)).toBeNull();
    expect(withPlanDayRewritten(running({ approvedAt: CLOSED }), TODAY, [], TODAY)).toBeNull();
    const full = running({
      items: Array.from({ length: WEEK_LESSON_LIMIT - 1 }, (_, index) =>
        item({ id: `fill-${index}`, title: `Lesson ${index}`, date: addDays(TODAY, 2) }),
      ),
    });
    expect(
      withPlanDayRewritten(full, TODAY, [{ title: 'One more' }, { title: 'And another' }], TODAY),
    ).toBeNull();
    // Rewriting a day replaces it, so the same day can be emptied back down.
    expect(withPlanDayRewritten(full, addDays(TODAY, 2), [{ title: 'One lesson' }], TODAY)?.items).toHaveLength(1);
  });

  it('drops a lesson with nothing in it, and an end before the start', () => {
    const changed = withPlanDayRewritten(
      running(),
      TODAY,
      [{ title: '    ' }, { id: 'today', title: 'Maths', time: '11:00', end: '09:00' }],
      TODAY,
    )!;
    expect(itemsForDay(changed, TODAY)).toHaveLength(1);
    expect(itemsForDay(changed, TODAY)[0]).toMatchObject({ title: 'Maths', time: '11:00', end: null });
  });

  it('applies several days at once, or none of them', () => {
    const week = running();
    const changed = withPlanDaysRewritten(
      week,
      [
        { date: TODAY, lessons: [{ id: 'today', title: 'Maths', time: '09:00', end: '11:00' }] },
        { date: addDays(TODAY, 1), lessons: [{ id: 'next', title: 'Chemistry', time: '15:00', end: '17:00' }] },
      ],
      TODAY,
    )!;
    expect(itemsForDay(changed, TODAY)[0]).toMatchObject({ time: '09:00', end: '11:00' });
    expect(itemsForDay(changed, addDays(TODAY, 1))[0]).toMatchObject({ time: '15:00', end: '17:00' });
    expect(itemsForDay(changed, addDays(TODAY, -2))).toHaveLength(1);
    // One locked day in the batch locks the whole change: half-applied weeks are
    // the kind of thing a guardian cannot see from the other side.
    expect(
      withPlanDaysRewritten(
        week,
        [
          { date: TODAY, lessons: [] },
          { date: addDays(TODAY, -1), lessons: [] },
        ],
        TODAY,
      ),
    ).toBeNull();
    expect(withPlanDaysRewritten(week, [], TODAY)).toBeNull();
  });

  it('says what a day did, in one line for the student', () => {
    const week = running();
    const changed = withPlanDayRewritten(
      week,
      TODAY,
      [{ id: 'today', title: 'Maths', time: '10:00', end: '12:00' }, { title: 'Geometry', time: '15:00' }],
      TODAY,
    )!;
    expect(diffPlanDay(itemsForDay(week, TODAY), itemsForDay(changed, TODAY))).toEqual({
      added: ['Geometry'],
      removed: [],
      retimed: ['Maths'],
    });
    expect(diffPlanDay(itemsForDay(week, TODAY), itemsForDay(week, TODAY))).toEqual({
      added: [],
      removed: [],
      retimed: [],
    });
    const summary = planDayChangeSummary(TODAY, { added: ['Geometry'], removed: [], retimed: ['Maths'] });
    expect(summary).toContain('Plan changed for');
    expect(summary).toContain(formatFullDate(TODAY));
    expect(summary).toContain('Geometry');
    expect(summary).toContain('Maths');
    expect(planDayChangeSummary(TODAY, { added: [], removed: [], retimed: [] })).toContain('unchanged');
  });
});

/* ------------------------------------------------------- change asks (16) */

describe('asking the guardian for a change', () => {
  const CLOSED = `${TODAY}T08:00:00.000Z`;

  const week = (partial: Partial<GuardianPlan> = {}) =>
    plan({
      start: addDays(TODAY, -1),
      items: [
        item({ id: 'history', title: 'History', date: addDays(TODAY, -1), done: true }),
        item({ id: 'maths', title: 'Maths', date: TODAY, time: '09:00', end: '11:00' }),
        item({ id: 'chem', title: 'Chemistry', date: addDays(TODAY, 2), time: '14:00' }),
      ],
      ...partial,
    });

  const ask = (partial: Partial<PlanChangeRequest> = {}): PlanChangeRequest => ({
    id: 'change-1',
    linkId: 'link-1',
    planId: 'plan-1',
    date: TODAY,
    kind: 'add',
    title: 'Physics',
    note: '',
    state: 'open',
    createdAt: `${TODAY}T08:00:00.000Z`,
    ...partial,
  });

  it('builds an ask for a day that has not gone by', () => {
    const built = buildChangeRequest(
      week(),
      'link-1',
      {
        kind: 'add',
        title: '  Physics  ',
        date: addDays(TODAY, 1),
        time: '10:00',
        end: '12:00',
        note: '  We have a test that morning.  ',
      },
      TODAY,
      new Date('2026-10-12T09:00:00.000Z'),
    )!;
    expect(built).toMatchObject({
      linkId: 'link-1',
      planId: 'plan-1',
      kind: 'add',
      title: 'Physics',
      date: addDays(TODAY, 1),
      time: '10:00',
      end: '12:00',
      note: 'We have a test that morning.',
      state: 'open',
      itemId: null,
      reply: '',
      answeredAt: null,
      createdAt: '2026-10-12T09:00:00.000Z',
    });
    expect(built.id).toMatch(/^change-/);
  });

  it('refuses an ask with no lesson, for a past day, or on a closed plan', () => {
    expect(buildChangeRequest(week(), 'link-1', { kind: 'add', title: '   ', date: TODAY }, TODAY)).toBeNull();
    expect(
      buildChangeRequest(week(), 'link-1', { kind: 'add', title: 'Physics', date: addDays(TODAY, -1) }, TODAY),
    ).toBeNull();
    expect(
      buildChangeRequest(week({ approvedAt: CLOSED }), 'link-1', { kind: 'add', title: 'Physics', date: TODAY }, TODAY),
    ).toBeNull();
    // An end before the start travels as no end at all, not as a nonsense span.
    const built = buildChangeRequest(
      week(),
      'link-1',
      { kind: 'add', title: 'Physics', date: TODAY, time: '11:00', end: '09:00' },
      TODAY,
    )!;
    expect(built.end).toBeNull();
  });

  it('points a removal at the lesson it names, and an add at nothing', () => {
    const removal = buildChangeRequest(
      week(),
      'link-1',
      { kind: 'remove', title: 'Chemistry', itemId: 'chem', date: addDays(TODAY, 2) },
      TODAY,
    )!;
    expect(removal).toMatchObject({ kind: 'remove', itemId: 'chem', title: 'Chemistry' });
    expect(
      buildChangeRequest(week(), 'link-1', { kind: 'add', title: 'Physics', itemId: 'maths', date: TODAY }, TODAY)!
        .itemId,
    ).toBeNull();
  });

  it('travels with the student, and can be taken back while it is open', () => {
    const panels = createEmptyState().panels;
    const withAsk = withStudentChangeRequest(panels, ask());
    expect(withAsk.student.changeRequests).toHaveLength(1);
    expect(withoutStudentChangeRequest(withAsk, 'change-1').student.changeRequests).toHaveLength(0);
    // An answered ask is a record of what happened, not something to take back.
    const answered = withStudentChangeRequest(panels, ask({ state: 'approved', answeredAt: `${TODAY}T09:00:00.000Z` }));
    expect(withoutStudentChangeRequest(answered, 'change-1')).toBe(answered);
    // Only twelve are kept, so a week of asking does not grow the state forever.
    const capped = Array.from({ length: PLAN_CHANGES_KEPT + 2 }, (_, index) =>
      ask({ id: `change-${index}`, createdAt: `${TODAY}T08:${String(index).padStart(2, '0')}:00.000Z` }),
    ).reduce((state, request) => withStudentChangeRequest(state, request), panels);
    expect(capped.student.changeRequests).toHaveLength(PLAN_CHANGES_KEPT);
  });

  it('says whether an ask is still worth making', () => {
    expect(canRequestPlanChange(week(), TODAY, TODAY)).toBe(true);
    expect(canRequestPlanChange(week(), null, TODAY)).toBe(true);
    expect(canRequestPlanChange(week(), addDays(TODAY, -1), TODAY)).toBe(false);
    expect(canRequestPlanChange(week(), addDays(TODAY, 9), TODAY)).toBe(false);
    expect(canRequestPlanChange(week({ approvedAt: CLOSED }), TODAY, TODAY)).toBe(false);
    // With no day named, the ask is refused only once the whole period is behind.
    expect(canRequestPlanChange(week({ start: addDays(TODAY, -20) }), null, TODAY)).toBe(false);
  });

  it('keeps the asks that matter, oldest first', () => {
    const requests = [
      ask({ id: 'c3', createdAt: `${TODAY}T10:00:00.000Z` }),
      ask({ id: 'c1', createdAt: `${TODAY}T08:00:00.000Z` }),
      ask({ id: 'c2', createdAt: `${TODAY}T09:00:00.000Z`, state: 'approved', answeredAt: `${TODAY}T11:00:00.000Z` }),
      ask({ id: 'old', createdAt: `${addDays(TODAY, -(PLAN_CHANGE_DAYS + 1))}T08:00:00.000Z` }),
    ];
    expect(openChangeRequests(requests, TODAY).map((entry) => entry.id)).toEqual(['c1', 'c2', 'c3']);
    expect(pendingChangeRequests(requests, TODAY).map((entry) => entry.id)).toEqual(['c1', 'c3']);
  });

  it('words an ask for the panel, and for the guardian\u2019s notices', () => {
    expect(changeRequestLabel(ask())).toBe(`Add · ${formatFullDate(TODAY)} · Physics`);
    expect(changeRequestLabel(ask({ kind: 'remove', title: 'Chemistry', date: null }))).toBe(
      'Remove · Any day · Chemistry',
    );
    const notice = changeRequestNotice(ask({ note: 'We have a test.' }), 'Nina', 'nina');
    expect(notice).toMatchObject({
      id: 'change-change-1',
      student: 'nina',
      author: 'Nina',
      kind: 'request',
      read: false,
      createdAt: `${TODAY}T08:00:00.000Z`,
    });
    expect(notice.summary).toContain('Nina asked to add Physics to the plan');
    expect(notice.summary).toContain('We have a test.');
    expect(changeRequestNotice(ask({ kind: 'remove', title: 'Chemistry' }), 'Nina', 'nina').summary).toContain(
      'Nina asked to take Chemistry off the plan',
    );
  });

  it('applies an approved ask to the plan, the same way on both sides', () => {
    const approved = applyChangeRequest(
      week(),
      ask({ date: addDays(TODAY, 1), time: '10:00', end: '12:00' }),
      TODAY,
      new Date('2026-10-12T12:00:00.000Z'),
    )!;
    expect(itemsForDay(approved, addDays(TODAY, 1)).find((entry) => entry.title === 'Physics')).toMatchObject({
      time: '10:00',
      end: '12:00',
      date: addDays(TODAY, 1),
    });
    expect(approved.updatedAt).toBe('2026-10-12T12:00:00.000Z');
    // The same ask twice is the same week, not two of the same lesson.
    expect(applyChangeRequest(approved, ask({ date: addDays(TODAY, 1) }), TODAY)).toBeNull();
    // A removal drops the lesson it points at, and only that one.
    const removed = applyChangeRequest(
      week(),
      ask({ kind: 'remove', title: 'Chemistry', itemId: 'chem', date: addDays(TODAY, 2) }),
      TODAY,
    )!;
    expect(removed.items.map((entry) => entry.id)).not.toContain('chem');
    expect(removed.items).toHaveLength(2);
    // An ask whose id went stale still finds the lesson it named, by day and title.
    const stale = applyChangeRequest(
      week(),
      ask({ kind: 'remove', title: 'Chemistry', itemId: 'an-id-from-an-older-sync', date: addDays(TODAY, 2) }),
      TODAY,
    )!;
    expect(stale.items.map((entry) => entry.id)).not.toContain('chem');
  });

  it('refuses an ask the week can no longer honour', () => {
    // The day went by while the ask waited.
    expect(applyChangeRequest(week(), ask({ date: addDays(TODAY, -1) }), TODAY)).toBeNull();
    // The lesson it points at is already ticked off.
    expect(
      applyChangeRequest(
        week(),
        ask({ kind: 'remove', title: 'History', itemId: 'history', date: addDays(TODAY, -1) }),
        TODAY,
      ),
    ).toBeNull();
    // A lesson that is not in the plan is not removed by an ask that names it.
    expect(
      applyChangeRequest(week(), ask({ kind: 'remove', title: 'Astronomy', itemId: 'gone', date: TODAY }), TODAY),
    ).toBeNull();
    // And the plan is closed.
    expect(applyChangeRequest(week({ approvedAt: CLOSED }), ask(), TODAY)).toBeNull();
  });

  it('answers an ask once, and an answer beats the open ask it answers', () => {
    const request = ask();
    const declined = answeredChangeRequest(request, 'declined', '  Not this week.  ', new Date('2026-10-12T12:00:00.000Z'));
    expect(declined).toMatchObject({
      state: 'declined',
      reply: 'Not this week.',
      answeredAt: '2026-10-12T12:00:00.000Z',
    });
    // A device that still holds the open ask must not undo the answer.
    expect(mergeChangeRequests([declined], [request]).map((entry) => entry.state)).toEqual(['declined']);
    // The latest answer wins over an older one, whichever side it arrives from.
    const later = answeredChangeRequest(request, 'approved', 'Yes', new Date('2026-10-12T14:00:00.000Z'));
    expect(mergeChangeRequests([later], [declined])[0]?.state).toBe('approved');
    expect(mergeChangeRequests([declined], [later])[0]?.state).toBe('approved');
    expect(mergeChangeRequests([], [request])).toEqual([request]);
  });

  it('knows when an answer is still possible', () => {
    expect(canAnswerChangeRequest(week(), ask(), TODAY)).toBe(true);
    expect(canAnswerChangeRequest(week(), ask({ state: 'declined' }), TODAY)).toBe(false);
    expect(canAnswerChangeRequest(week(), ask({ date: addDays(TODAY, -1) }), TODAY)).toBe(false);
    expect(canAnswerChangeRequest(undefined, ask(), TODAY)).toBe(false);
    // This answers "can the ask still be honoured", which is what approving
    // needs. A day that has gone by can still be declined with a word back —
    // the panel offers that separately, because the student is owed an answer.
  });
});
