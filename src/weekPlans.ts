/**
 * Week lesson plans and the daily reports that answer them.
 *
 * A guardian plans a week day by day; the student reports each planned day
 * back. Everything here is pure and local: what travels over the encrypted
 * link is decided in `auth/links.ts`, and these are the shapes both sides
 * agree on before anything is sent.
 */
import { addDays, isValidISODate, isValidTime, todayISO, weekdayIndex } from './dates';
import { t } from './i18n';
import type { Reminder } from './reminders';
import { ACK_REACTIONS, DAY_REPORTS_KEPT, DAY_REPORT_NOTE_MAX, LESSON_URL_MAX, PLAN_REQUEST_DAYS, type DayReport, type FocusLog, type GuardianNotice, type GuardianPlan, type Panels, type PlanItem, type PlanRequest, type ReportAck, type Task } from './types';

/** A week plan holds seven days of lessons; sixty is eight a day with room to spare. */
export const WEEK_LESSON_LIMIT = 60;
/** Only recent weeks can ask for reports — an old plan must not nag forever. */
const REPORT_LOOKBACK_DAYS = 21;

/** The seven days a week plan covers, oldest first. Empty when the start is not a date. */
export function planWeekDays(plan: Pick<GuardianPlan, 'start'>): string[] {
  if (!isValidISODate(plan.start)) return [];
  return Array.from({ length: 7 }, (_, offset) => addDays(plan.start, offset));
}

/**
 * Lessons in reading order: dated days first, timed lessons before untimed
 * ones within a day. Anything without a usable day sorts last, under "any
 * day", so plans from the older step composer still read sensibly.
 */
export function sortPlanItems(items: PlanItem[]): PlanItem[] {
  const dayOf = (item: PlanItem): string =>
    item.date && isValidISODate(item.date) ? item.date : '9999-99-99';
  const timeOf = (item: PlanItem): string =>
    item.time && isValidTime(item.time) ? item.time : '99:99';
  return [...items].sort(
    (a, b) =>
      dayOf(a).localeCompare(dayOf(b)) ||
      timeOf(a).localeCompare(timeOf(b)) ||
      a.title.localeCompare(b.title),
  );
}

/** The lessons planned for one day, timed first and earliest first. */
export function itemsForDay(plan: GuardianPlan, date: string): PlanItem[] {
  return sortPlanItems(plan.items.filter((item) => item.date === date));
}

/** Lessons with no usable day — shown together under "any day". */
export function datelessItems(plan: GuardianPlan): PlanItem[] {
  const days = new Set(planWeekDays(plan));
  return sortPlanItems(
    plan.items.filter((item) => !item.date || !isValidISODate(item.date) || !days.has(item.date)),
  );
}

export function reportFor(reports: DayReport[], planId: string, date: string): DayReport | undefined {
  return reports.find((report) => report.planId === planId && report.date === date);
}

export interface MissingDay {
  plan: GuardianPlan;
  date: string;
  lessons: PlanItem[];
}

/**
 * Finished plan days with lessons but no report — the oldest first, so a
 * student catching up starts where the week did. Only week plans ask: day and
 * month plans keep their ticks and ask for nothing more.
 */
export function missingReportDays(
  plans: GuardianPlan[],
  reports: DayReport[],
  today = todayISO(),
): MissingDay[] {
  const earliest = addDays(today, -REPORT_LOOKBACK_DAYS);
  const missing: MissingDay[] = [];
  for (const plan of plans) {
    if (plan.cadence !== 'week') continue;
    for (const date of planWeekDays(plan)) {
      if (date >= today || date < earliest) continue;
      if (isRestDay(plan, date)) continue;
      const lessons = itemsForDay(plan, date);
      if (lessons.length === 0 || reportFor(reports, plan.id, date)) continue;
      missing.push({ plan, date, lessons });
    }
  }
  return missing.sort((a, b) => a.date.localeCompare(b.date) || a.plan.start.localeCompare(b.plan.start));
}

/** How many planned days were reported — for the guardian's "waiting on" flag. */
export function reportStats(plans: GuardianPlan[], reports: DayReport[], today = todayISO()): { reported: number; missing: number } {
  const earliest = addDays(today, -REPORT_LOOKBACK_DAYS);
  let reported = 0;
  let missing = 0;
  for (const plan of plans) {
    if (plan.cadence !== 'week') continue;
    for (const date of planWeekDays(plan)) {
      if (date >= today || date < earliest || itemsForDay(plan, date).length === 0) continue;
      if (isRestDay(plan, date)) continue;
      if (reportFor(reports, plan.id, date)) reported += 1;
      else missing += 1;
    }
  }
  return { reported, missing };
}

/**
 * Student: file a daily report. The report is the day's truth, so the day's
 * ticks are set from it — other days are left alone — and then it travels on
 * the next sync like everything else the student sends.
 */
export function withDayReport(panels: Panels, report: DayReport): Panels {
  const clean: DayReport = {
    ...report,
    note: report.note.trim().slice(0, DAY_REPORT_NOTE_MAX),
    doneIds: [...new Set(report.doneIds.filter((id) => typeof id === 'string'))],
  };
  const plans = panels.student.inbox.plans.map((plan) => {
    if (plan.id !== clean.planId) return plan;
    const done = new Set(clean.doneIds);
    return {
      ...plan,
      items: plan.items.map((item) =>
        item.date === clean.date ? { ...item, done: done.has(item.id) } : item,
      ),
    };
  });
  const reports = [clean, ...(panels.student.reports ?? []).filter((item) => item.id !== clean.id)]
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, DAY_REPORTS_KEPT);
  return {
    ...panels,
    student: { ...panels.student, inbox: { ...panels.student.inbox, plans }, reports },
  };
}

/** Guardian: fold freshly pulled reports into what a link already holds. */
export function mergeLinkReports(current: DayReport[], incoming: DayReport[]): DayReport[] {
  const byId = new Map(current.map((report) => [report.id, report]));
  for (const report of incoming) byId.set(report.id, report);
  return [...byId.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, DAY_REPORTS_KEPT);
}

export interface WeekLessonDraft {
  id: string;
  name: string;
  time: string;
  /** Prep link as typed — normalized on send, so drafts may hold anything. */
  url: string;
}

export interface WeekDayDraft {
  /** Day within the week, 0–6 from the chosen start — absolute dates are computed on send. */
  offset: number;
  lessons: WeekLessonDraft[];
}

export interface WeekPlanDraft {
  title: string;
  note: string;
  start: string;
  field: string;
  grade: string;
  /** An exam to plan around. Local only — exam dates are never sent. */
  examDate: string;
  /** Weekdays (0 = Sunday) that need no daily report. */
  restDays: number[];
  days: WeekDayDraft[];
}

export function emptyWeekPlanDraft(start: string): WeekPlanDraft {
  return {
    title: '',
    note: '',
    start,
    field: '',
    grade: '',
    examDate: '',
    restDays: [],
    days: Array.from({ length: 7 }, (_, offset) => ({ offset, lessons: [] })),
  };
}

export function weekPlanLessonCount(draft: WeekPlanDraft): number {
  return draft.days.reduce((sum, day) => sum + day.lessons.filter((lesson) => lesson.name.trim()).length, 0);
}

/** Reject an unnamed plan, a bad start, bad times, bad links, and a week that overflows the wire. */
export function weekPlanDraftError(draft: WeekPlanDraft): string | null {
  const named = draft.days.flatMap((day) => day.lessons).filter((lesson) => lesson.name.trim());
  if (!draft.title.trim() || named.length === 0) return t('Give the plan a name and at least one thing to do.');
  if (!isValidISODate(draft.start)) return t('Choose a valid start date.');
  if (named.some((lesson) => lesson.time && !isValidTime(lesson.time))) return t('Choose a valid time.');
  if (named.some((lesson) => lesson.url.trim() && !normalizeLessonUrl(lesson.url)))
    return t('One of the links is not a valid web address.');
  if (named.length > WEEK_LESSON_LIMIT) return t('A week plan can hold up to 60 lessons.');
  return null;
}

/**
 * The one daily nudge a missing report earns. The key carries today's date so
 * the sweep fires it once a day while days stay missing — and never again once
 * the reports are in.
 */
export function missingReportReminders(panels: Panels, today = todayISO()): Reminder[] {
  if (!panels.student.enabled) return [];
  const missing = missingReportDays(panels.student.inbox.plans, panels.student.reports ?? [], today);
  if (missing.length === 0) return [];
  return [
    {
      key: `${today}|report-missing`,
      title: t('Daily report missing'),
      body: t('You can send the missing daily reports when you are ready.'),
    },
  ];
}

/* ------------------------------------------------------- rest days (1) */

/** True when the guardian gave this weekday off — no report is ever asked for it. */
export function isRestDay(plan: Pick<GuardianPlan, 'restDays'>, date: string): boolean {
  if (!plan.restDays || plan.restDays.length === 0 || !isValidISODate(date)) return false;
  return plan.restDays.includes(weekdayIndex(date));
}

/* --------------------------------------------------- acknowledgments (2) */

export function ackFor(acks: ReportAck[], reportId: string): ReportAck | undefined {
  return acks.find((ack) => ack.reportId === reportId);
}

/** Fold freshly pulled answers into the ones already held, newest first. */
export function mergeAcks(current: ReportAck[], incoming: ReportAck[]): ReportAck[] {
  const byId = new Map(current.map((ack) => [ack.id, ack]));
  for (const ack of incoming) byId.set(ack.id, ack);
  return [...byId.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, DAY_REPORTS_KEPT);
}

/* --------------------------------------------------- week in review (3) */

export interface WeekReview {
  /** Finished lesson-days that could be reported (rest days excluded). */
  lessonDays: number;
  /** How many of them were reported. */
  reported: number;
  lessonsDone: number;
  lessonsTotal: number;
  /** Reported days in a row, counting back over rest and empty days. */
  streak: number;
}

export function weekReview(plan: GuardianPlan, reports: DayReport[], today = todayISO()): WeekReview {
  const days = planWeekDays(plan);
  const reportable = (date: string) =>
    date < today && itemsForDay(plan, date).length > 0 && !isRestDay(plan, date);
  const lessonDays = days.filter(reportable);
  const reported = lessonDays.filter((date) => reportFor(reports, plan.id, date)).length;
  const lessonsTotal = plan.items.length;
  const lessonsDone = plan.items.filter((item) => item.done).length;
  let streak = 0;
  const latest = [...lessonDays].sort().reverse()[0];
  if (latest) {
    let cursor: string | null = latest;
    while (cursor && cursor >= (days[0] as string)) {
      if (reportable(cursor)) {
        if (!reportFor(reports, plan.id, cursor)) break;
        streak += 1;
      }
      cursor = addDays(cursor, -1);
    }
  }
  return { lessonDays: lessonDays.length, reported, lessonsDone, lessonsTotal, streak };
}

/* ---------------------------------------------------------- timetable (4) */

export interface TimetableModel {
  days: string[];
  /** Distinct lesson times across the week, earliest first. */
  times: string[];
  /** Lessons in one cell; null time means the untimed row. */
  lessonsFor: (date: string, time: string | null) => PlanItem[];
  reported: (date: string) => boolean;
  rest: (date: string) => boolean;
}

export function timetableModel(plan: GuardianPlan, reports: DayReport[]): TimetableModel {
  const days = planWeekDays(plan);
  const times = [
    ...new Set(
      plan.items
        .filter((item) => item.time && isValidTime(item.time))
        .map((item) => item.time as string),
    ),
  ].sort();
  return {
    days,
    times,
    lessonsFor: (date, time) =>
      itemsForDay(plan, date).filter((lesson) =>
        time === null ? !lesson.time || !isValidTime(lesson.time) : lesson.time === time,
      ),
    reported: (date) => !!reportFor(reports, plan.id, date),
    rest: (date) => isRestDay(plan, date),
  };
}

/* ---------------------------------------------------------- roll-over (5) */

/**
 * Where an unfinished lesson moves: the upcoming day with the fewest lessons,
 * earliest first when tied — tomorrow when the week is evenly spread, further
 * out when tomorrow is already full. Only forward, never into the past, and
 * never onto a rest day or a day already reported: rolling there would undo
 * the rest or rewrite a filed day.
 */
export function rollTarget(
  plan: GuardianPlan,
  item: PlanItem,
  reports: DayReport[] = [],
  today = todayISO(),
): string | null {
  if (!item.date || !isValidISODate(item.date)) return null;
  const from = item.date;
  const candidates = planWeekDays(plan).filter(
    (date) => date > from && date >= today && !isRestDay(plan, date) && !reportFor(reports, plan.id, date),
  );
  if (candidates.length === 0) return null;
  return (
    candidates.sort(
      (a, b) => itemsForDay(plan, a).length - itemsForDay(plan, b).length || (a < b ? -1 : 1),
    )[0] ?? null
  );
}

/** Student: push one unfinished lesson to its quietest upcoming day. Ticks travel as usual. */
export function withLessonRolled(panels: Panels, planId: string, itemId: string, today = todayISO()): Panels {
  const plan = panels.student.inbox.plans.find((entry) => entry.id === planId);
  const item = plan?.items.find((entry) => entry.id === itemId);
  const target = plan && item ? rollTarget(plan, item, panels.student.reports ?? [], today) : null;
  if (!plan || !item || item.done || !target) return panels;
  return {
    ...panels,
    student: {
      ...panels.student,
      inbox: {
        ...panels.student.inbox,
        plans: panels.student.inbox.plans.map((entry) =>
          entry.id === planId
            ? { ...entry, items: entry.items.map((lesson) => (lesson.id === itemId ? { ...lesson, date: target } : lesson)) }
            : entry,
        ),
      },
    },
  };
}

/* ------------------------------------------------------ plan requests (6) */

/** Open asks that have not gone stale, oldest first — the order they were asked in. */
export function openRequests(requests: PlanRequest[], today = todayISO()): PlanRequest[] {
  const earliest = addDays(today, -PLAN_REQUEST_DAYS);
  return requests
    .filter((request) => request.createdAt.slice(0, 10) >= earliest)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** What a guardian reads: the ask as a notice, the lesson planner one tap away. */
export function requestNotice(request: PlanRequest, studentName: string, studentUsername: string): GuardianNotice {
  const summary = `${t('{0} asked for a week plan', { 0: studentName })}${request.note ? `: ${request.note}` : ''}`;
  return {
    id: `req-${request.id}`,
    student: studentUsername,
    author: studentName,
    summary: summary.slice(0, 160),
    weekOf: '',
    createdAt: request.createdAt,
    read: false,
    kind: 'request',
  };
}

/* -------------------------------------------------- exam-aware planning (7) */

/** A day this full, just before an exam, earns a warning — never a refusal. */
export const HEAVY_DAY_LESSONS = 3;
/** The exam day and the two days before it are the days that matter. */
export const EXAM_LOOKBACK_DAYS = 2;

/** Plan dates carrying a heavy load on the exam day or just before it. */
export function examWarningDates(days: WeekDayDraft[], start: string, exam: string): string[] {
  if (!isValidISODate(start) || !isValidISODate(exam)) return [];
  const window = new Set(
    Array.from({ length: EXAM_LOOKBACK_DAYS + 1 }, (_, back) => addDays(exam, back - EXAM_LOOKBACK_DAYS)),
  );
  return days
    .filter(
      (day) =>
        window.has(addDays(start, day.offset)) &&
        day.lessons.filter((lesson) => lesson.name.trim()).length >= HEAVY_DAY_LESSONS,
    )
    .map((day) => addDays(start, day.offset));
}

/* ------------------------------------------------------------- nudges (8) */

/** Whether this student was already nudged today — one gentle nudge a day is plenty. */
export function nudgedToday(notices: GuardianNotice[], username: string, today = todayISO()): boolean {
  return notices.some(
    (notice) => notice.kind === 'nudge' && notice.student === username && notice.createdAt.slice(0, 10) === today,
  );
}

/* ------------------------------------------------- focus attribution (9) */

/** Words too short to mean anything on their own — 'PE' should not match 'open'. */
const FOCUS_WORD_MIN = 3;

function focusWords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[\s\-–—_.,;:!?()«»""''[\]]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= FOCUS_WORD_MIN);
}

/**
 * Whether a focus session belonged to a lesson: a shared word of substance,
 * equal titles, or a session from a task filed under a category named like
 * the lesson's subject. Deliberately explainable — a student reading the
 * review line should be able to guess why each session counted.
 */
export function focusMatchesLesson(sessionTitle: string, lesson: PlanItem, taskCategory?: string | null): boolean {
  const sessionWords = new Set(focusWords(sessionTitle));
  if (focusWords(lesson.title).some((word) => sessionWords.has(word))) return true;
  const full = (value: string) => value.toLowerCase().trim();
  if (lesson.title.trim() && full(sessionTitle) === full(lesson.title)) return true;
  return !!taskCategory && !!lesson.subject && full(taskCategory) === full(lesson.subject);
}

/** Focused minutes that belonged to this plan's lessons, each session counted once. */
export function planFocusMinutes(plan: GuardianPlan, sessions: FocusLog[], tasks: Task[]): number {
  const days = new Set(planWeekDays(plan));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  let total = 0;
  for (const session of sessions) {
    if (!days.has(session.date)) continue;
    const lessons = itemsForDay(plan, session.date);
    if (lessons.length === 0) continue;
    const task = session.taskId ? byId.get(session.taskId) : undefined;
    if (lessons.some((lesson) => focusMatchesLesson(session.title, lesson, task?.category ?? null))) {
      total += session.minutes;
    }
  }
  return total;
}

/* ------------------------------------------------------ streak repair (10) */

/** Whether this plan's one weekly mulligan is spent. A repair files a report, so it travels as one. */
export function repairUsed(reports: DayReport[], planId: string): boolean {
  return reports.some((report) => report.planId === planId && report.repair === true);
}

/* ------------------------------------------------------- prep links (11) */

/**
 * Normalize a prep link: trimmed, https:// assumed when no scheme is given,
 * http(s) only. Null when it is not a link at all — the one check the
 * composer, the wire, and storage all agree on.
 */
export function normalizeLessonUrl(raw: string): string | null {
  const clean = raw.trim().slice(0, LESSON_URL_MAX);
  if (!clean) return null;
  const withScheme = clean.includes('://') ? clean : `https://${clean}`;
  if (!/^https?:\/\/\S+$/.test(withScheme)) return null;
  return withScheme;
}

/* ---------------------------------------------------------- reactions (12) */

/** Toggle one emoji on an answer — unknown emoji are ignored, never stored. */
export function toggleReaction(reactions: string[], emoji: string): string[] {
  if (!(ACK_REACTIONS as readonly string[]).includes(emoji)) return reactions;
  return reactions.includes(emoji) ? reactions.filter((entry) => entry !== emoji) : [...reactions, emoji];
}

/* ------------------------------------------------------ time-box nudge (13) */

/**
 * Lessons whose planned minutes the focus session just outgrew — each fires
 * once, tracked by the caller in nudgedIds.
 */
export function crossedTimeboxes(
  lessons: PlanItem[],
  elapsedSeconds: number,
  nudgedIds: ReadonlySet<string>,
): PlanItem[] {
  return lessons.filter(
    (lesson) => (lesson.minutes ?? 0) > 0 && elapsedSeconds >= lesson.minutes! * 60 && !nudgedIds.has(lesson.id),
  );
}
