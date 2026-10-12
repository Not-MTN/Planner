// @vitest-environment node
/**
 * The week-plan rules, without a screen: timed lessons sort themselves, only
 * finished lesson-days ask for reports, a report sets its day's ticks, and an
 * old plan can never lock a panel.
 */
import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { createEmptyState, type GuardianNotice, type GuardianPlan, type PlanItem } from './types';
import {
  ackFor,
  crossedTimeboxes,
  datelessItems,
  emptyWeekPlanDraft,
  examWarningDates,
  focusMatchesLesson,
  isRestDay,
  itemsForDay,
  mergeAcks,
  mergeLinkReports,
  missingReportDays,
  missingReportReminders,
  normalizeLessonUrl,
  nudgedToday,
  openRequests,
  planFocusMinutes,
  planWeekDays,
  repairUsed,
  reportFor,
  reportStats,
  requestNotice,
  rollTarget,
  sortPlanItems,
  timetableModel,
  toggleReaction,
  weekPlanDraftError,
  weekReview,
  withDayReport,
  withLessonRolled,
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

  it('never locks a panel over a plan older than three weeks', () => {
    const old = plan({ start: addDays(TODAY, -30), items: lessons(addDays(TODAY, -25)) });
    expect(missingReportDays([old], [], TODAY)).toHaveLength(0);
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

  it('trims the note and keeps the newest thirty reports', () => {
    const state = createEmptyState();
    const many = Array.from({ length: 35 }, (_, index) =>
      report('plan-1', addDays(TODAY, -(index + 1)), []),
    );
    let panels = state.panels;
    for (const entry of many) panels = withDayReport(panels, entry);
    expect(panels.student.reports).toHaveLength(30);
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
  it('merges by id, newest first, capped at thirty', () => {
    const current = [report('plan-1', addDays(TODAY, -3))];
    const incoming = [report('plan-1', addDays(TODAY, -1)), report('plan-1', addDays(TODAY, -3))];
    const merged = mergeLinkReports(current, incoming);
    expect(merged.map((entry) => entry.date)).toEqual([addDays(TODAY, -1), addDays(TODAY, -3)]);
    const overflow = Array.from({ length: 40 }, (_, index) => report(`plan-${index}`, addDays(TODAY, -1)));
    expect(mergeLinkReports([], overflow)).toHaveLength(30);
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

  it('skips past days, rest days, and days already reported', () => {
    const week = plan({
      start: addDays(TODAY, -2),
      // Tomorrow rests; the lesson rolls past it.
      restDays: [new Date(`${addDays(TODAY, 1)}T12:00:00Z`).getUTCDay()],
    });
    const rolling = item({ id: 'a', title: 'Maths', date: addDays(TODAY, -2) });
    // Today is reported, tomorrow rests — the day after tomorrow takes it.
    const reports = [report('plan-1', TODAY)];
    expect(rollTarget(week, rolling, reports, TODAY)).toBe(addDays(TODAY, 2));
    // When every upcoming day is closed, there is nowhere to roll.
    const allReported = [TODAY, addDays(TODAY, 2), addDays(TODAY, 3), addDays(TODAY, 4)].map((date) =>
      report('plan-1', date),
    );
    expect(rollTarget(week, rolling, allReported, TODAY)).toBeNull();
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
