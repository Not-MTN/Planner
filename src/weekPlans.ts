/**
 * Week lesson plans and the daily reports that answer them.
 *
 * A guardian plans a week day by day; the student reports each planned day
 * back. Everything here is pure and local: what travels over the encrypted
 * link is decided in `auth/links.ts`, and these are the shapes both sides
 * agree on before anything is sent.
 */
import { addDays, displayTime, formatDuration, formatFullDate, isValidISODate, isValidTime, parseISODate, timeToMinutes, todayISO, toISODate, weekdayIndex } from './dates';
import { t } from './i18n';
import type { Reminder } from './reminders';
import { ACK_REACTIONS, DAY_REPORTS_KEPT, DAY_REPORT_NOTE_MAX, LESSON_URL_MAX, PLAN_CHANGE_DAYS, PLAN_CHANGES_KEPT, PLAN_CHANGE_NOTE_MAX, PLAN_CHANGE_TITLE_MAX, PLAN_REQUEST_DAYS, type DayReport, type FocusLog, type GuardianNotice, type GuardianPlan, type Panels, type PlanChangeKind, type PlanChangeRequest, type PlanItem, type PlanRequest, type ReportAck, type Task } from './types';

/** A week plan holds seven days of lessons; sixty is eight a day with room to spare. */
export const WEEK_LESSON_LIMIT = 60;
function planPeriodEnd(plan: Pick<GuardianPlan, 'cadence' | 'start'>): string {
  if (plan.cadence === 'day') return plan.start;
  if (plan.cadence === 'week') return addDays(plan.start, 6);
  const date = parseISODate(plan.start);
  return toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

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
  const missing: MissingDay[] = [];
  for (const plan of plans) {
    if (plan.cadence !== 'week' || plan.approvedAt) continue;
    for (const date of planWeekDays(plan)) {
      if (date >= today) continue;
      if (isRestDay(plan, date)) continue;
      const lessons = itemsForDay(plan, date);
      if (lessons.length === 0 || reportFor(reports, plan.id, date)) continue;
      missing.push({ plan, date, lessons });
    }
  }
  return missing.sort((a, b) => a.date.localeCompare(b.date) || a.plan.start.localeCompare(b.plan.start));
}

/** An earlier unfiled day is the only day a student may report first. */
export function reportBlockedByEarlierDay(
  plans: GuardianPlan[],
  reports: DayReport[],
  date: string,
  today = todayISO(),
): boolean {
  return missingReportDays(plans, reports, today).some((day) => day.date < date);
}

/** True only for an existing, unfiled day that has come around. */
export function canSubmitDayReport(
  panels: Panels,
  planId: string,
  date: string,
  today = todayISO(),
): boolean {
  const plan = panels.student.inbox.plans.find((entry) => entry.id === planId);
  const reports = panels.student.reports ?? [];
  if (!plan || plan.cadence !== 'week' || plan.approvedAt || !isValidISODate(date) || date > today) return false;
  if (!planWeekDays(plan).includes(date) || isRestDay(plan, date) || itemsForDay(plan, date).length === 0) return false;
  if (reportFor(reports, plan.id, date)) return false;
  return !reportBlockedByEarlierDay(panels.student.inbox.plans, reports, date, today);
}

/**
 * A student may only tick today's work. A missed report from any earlier day
 * locks the next day's ticks until the student files the oldest missing report.
 */
export function studentCanTogglePlanItem(
  panels: Panels,
  planId: string,
  itemId: string,
  today = todayISO(),
): boolean {
  const plan = panels.student.inbox.plans.find((entry) => entry.id === planId);
  const item = plan?.items.find((entry) => entry.id === itemId);
  if (!plan || !item || plan.approvedAt || today < plan.start || today > planPeriodEnd(plan)) return false;
  if (reportBlockedByEarlierDay(panels.student.inbox.plans, panels.student.reports ?? [], today, today)) return false;
  if (plan.cadence === 'week') {
    if (!planWeekDays(plan).includes(today) || (item.date && item.date !== today)) return false;
    if (reportFor(panels.student.reports ?? [], plan.id, today)) return false;
    return true;
  }
  if (item.date && item.date !== today) return false;
  return today >= plan.start && today <= planPeriodEnd(plan);
}

/** How many planned days were reported — for the guardian's "waiting on" flag. */
export function reportStats(plans: GuardianPlan[], reports: DayReport[], today = todayISO()): { reported: number; missing: number } {
  let reported = 0;
  let missing = 0;
  for (const plan of plans) {
    if (plan.cadence !== 'week' || plan.approvedAt) continue;
    for (const date of planWeekDays(plan)) {
      if (date >= today || itemsForDay(plan, date).length === 0) continue;
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
export function withDayReport(panels: Panels, report: DayReport, today = todayISO()): Panels {
  const existingReports = panels.student.reports ?? [];
  // Reports are one-time filings: resubmitting a date must never rewrite it,
  // including after a guardian has already approved it.
  if (existingReports.some((entry) => entry.planId === report.planId && entry.date === report.date)) return panels;
  if (panels.student.inbox.plans.some((entry) => entry.id === report.planId) &&
      !canSubmitDayReport(panels, report.planId, report.date, today)) return panels;
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
  const byDay = new Map<string, DayReport>();
  for (const report of [...incoming, ...current]) {
    const key = `${report.linkId}:${report.planId}:${report.date}`;
    const previous = byDay.get(key);
    // A day is filed once. If two offline devices submitted it independently,
    // retain the earliest filing rather than creating competing reports.
    if (!previous || report.createdAt < previous.createdAt) byDay.set(key, report);
  }
  return [...byDay.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, DAY_REPORTS_KEPT);
}

export interface WeekLessonDraft {
  id: string;
  name: string;
  /** Start, as typed — HH:MM once it is valid. */
  time: string;
  /** End, as typed. Kept only when it comes after the start; optional, as most lessons have no end to give. */
  end?: string;
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
  // An end that does not come after the start is read on send (see
  // `readLessonTimePair`) rather than refused here: one careless time pair must
  // not hold back a week the guardian has just built.
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
export function missingReportReminders(panels: Panels, today = todayISO(), now = new Date()): Reminder[] {
  if (!panels.student.enabled) return [];
  const reports = panels.student.reports ?? [];
  const missing = missingReportDays(panels.student.inbox.plans, reports, today);
  // A gentle evening reminder before the local day rolls over. Once the date
  // passes, the same reminder continues until the student files the oldest gap.
  const eveningDue = now.getFullYear() === Number(today.slice(0, 4)) &&
    now.getMonth() + 1 === Number(today.slice(5, 7)) &&
    now.getDate() === Number(today.slice(8, 10)) &&
    now.getHours() >= 21 &&
    panels.student.inbox.plans.some((plan) =>
      plan.cadence === 'week' && !isRestDay(plan, today) && itemsForDay(plan, today).length > 0 && !reportFor(reports, plan.id, today),
    );
  if (missing.length === 0 && !eveningDue) return [];
  return [
    {
      key: `${today}|report-missing`,
      title: t('Daily report missing'),
      body: missing.length > 0
        ? t('Send the oldest missing daily report first. The next day stays locked until you catch up.')
        : t('Tonight’s report is still open. File it before the day ends.'),
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

/** Daily approval seals the filing; a weekly period also waits for those seals. */
export function reportIsApproved(report: DayReport, acks: ReportAck[]): boolean {
  return !!ackFor(acks, report.id)?.approvedAt;
}

/** A period may close only after its last calendar day has passed. */
export function canApprovePlanPeriod(
  plan: GuardianPlan,
  reports: DayReport[],
  acks: ReportAck[],
  today = todayISO(),
): boolean {
  if (plan.approvedAt || planPeriodEnd(plan) >= today) return false;
  if (plan.cadence !== 'week') return true;
  const reportable = planWeekDays(plan).filter((date) =>
    date <= planPeriodEnd(plan) && itemsForDay(plan, date).length > 0 && !isRestDay(plan, date),
  );
  return reportable.every((date) => {
    const report = reportFor(reports, plan.id, date);
    return !!report && reportIsApproved(report, acks);
  });
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
  if (!item.date || !isValidISODate(item.date) || item.date !== today || item.done || plan.approvedAt) return null;
  if (reportFor(reports, plan.id, today)) return null;
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
  const reports = panels.student.reports ?? [];
  if (reportBlockedByEarlierDay(panels.student.inbox.plans, reports, today, today)) return panels;
  const target = plan && item ? rollTarget(plan, item, reports, today) : null;
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

/* --------------------------------------------------------- lesson times (14) */

/**
 * The end of a lesson, kept only when it is a real time that comes after the
 * start. Anything else is dropped rather than stored: a lesson that ends before
 * it begins would sort the day into nonsense and print a span nobody can read.
 * An end with no start goes too — "until eleven" says nothing on its own.
 */
export function normalizeLessonEnd(
  time: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!end || !isValidTime(end)) return null;
  if (!time || !isValidTime(time)) return null;
  return timeToMinutes(end) > timeToMinutes(time) ? end : null;
}

/** What a typed time pair had to be read as, so the composer can say so. */
export type LessonTimeFix = 'none' | 'start-from-end' | 'end-dropped';

export interface LessonTimePair {
  /** Start, HH:MM or empty for "any time that day". */
  time: string;
  /** End, HH:MM or empty when there is no span to give. */
  end: string;
  fix: LessonTimeFix;
}

/**
 * Read a typed time pair the way it was meant.
 *
 * Two boxes are an offer, not a form to be rejected. Filling only "to" says
 * when the lesson starts, and an end that comes before the start is dropped
 * rather than sent — either way the lesson survives, so a week with one
 * careless time still reaches the student instead of failing at the bottom of
 * a long form. `fix` says which reading was used and the composer shows it,
 * because a quiet correction nobody saw is the same as a mistake.
 */
export function readLessonTimePair(
  time: string | null | undefined,
  end: string | null | undefined,
): LessonTimePair {
  const start = time && isValidTime(time) ? time : '';
  const finish = end && isValidTime(end) ? end : '';
  if (!start && finish) return { time: finish, end: '', fix: 'start-from-end' };
  if (start && finish && timeToMinutes(finish) <= timeToMinutes(start))
    return { time: start, end: '', fix: 'end-dropped' };
  return { time: start, end: finish, fix: 'none' };
}

/** The one line a time pair reads back as, with the fix spelled out when there was one. */
export function lessonTimePairHint(pair: LessonTimePair): string | null {
  if (pair.fix === 'start-from-end') return t('Read as the start time.');
  if (pair.fix === 'end-dropped') return t('The end has to come after the start, so only the start is kept.');
  return null;
}

/** How long a lesson runs, in minutes. Null when it has no span to measure. */
export function lessonSpanMinutes(item: Pick<PlanItem, 'time' | 'end'>): number | null {
  const end = normalizeLessonEnd(item.time, item.end);
  if (!item.time || !end) return null;
  return timeToMinutes(end) - timeToMinutes(item.time);
}

/**
 * When a lesson runs, as the plan says it: "9 – 11 am" for a span, "9 am" for
 * a start alone, and nothing at all for a lesson that fits anywhere in the day.
 */
export function lessonTimeLabel(item: Pick<PlanItem, 'time' | 'end'>): string | null {
  if (!item.time || !isValidTime(item.time)) return null;
  const start = displayTime(item.time);
  const end = normalizeLessonEnd(item.time, item.end);
  if (!end) return start;
  return t('{0} – {1}', { 0: start, 1: displayTime(end) });
}

/** "2 h" beside the span — the length of the lesson, for the day's arithmetic. */
export function lessonDurationLabel(item: Pick<PlanItem, 'time' | 'end'>): string | null {
  if (!item.time) return null;
  return formatDuration(item.time, normalizeLessonEnd(item.time, item.end));
}

/* ----------------------------------------------- changing a running plan (15) */

/** A new lesson's id, in the shape `newId('item')` makes on the way out. */
function lessonId(): string {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Every day a plan covers, oldest first — seven for a week, a month for a month. */
export function planDays(plan: Pick<GuardianPlan, 'cadence' | 'start'>): string[] {
  if (!isValidISODate(plan.start)) return [];
  const end = planPeriodEnd(plan);
  const days: string[] = [];
  for (let cursor = plan.start; cursor <= end && days.length < 31; cursor = addDays(cursor, 1)) days.push(cursor);
  return days;
}

/**
 * Whether one day of a plan may still be changed.
 *
 * Days that have gone by are a record: what was asked, what was ticked, what
 * was reported and answered. Rewriting them would quietly undo a filing, so
 * the week stays editable only from today onwards — and not at all once the
 * guardian has closed the period.
 */
export function canEditPlanDay(plan: GuardianPlan, date: string, today = todayISO()): boolean {
  if (plan.approvedAt || !isValidISODate(date)) return false;
  if (date < today) return false;
  return planDays(plan).includes(date);
}

/** The days of a plan a guardian may still change, oldest first. */
export function editablePlanDays(plan: GuardianPlan, today = todayISO()): string[] {
  return planDays(plan).filter((date) => canEditPlanDay(plan, date, today));
}

/** A lesson as the editor holds it: an id when it already exists, a title always. */
export interface PlanLessonInput {
  id?: string | null;
  title: string;
  time?: string | null;
  end?: string | null;
  minutes?: number | null;
  subject?: string | null;
  url?: string | null;
  done?: boolean;
}

function cleanLessonInput(input: PlanLessonInput): PlanItem | null {
  const title = input.title.trim().slice(0, PLAN_CHANGE_TITLE_MAX);
  if (!title) return null;
  const time = input.time && isValidTime(input.time) ? input.time : null;
  return {
    id: input.id?.slice(0, 80) || lessonId(),
    title,
    date: null,
    time,
    end: normalizeLessonEnd(time, input.end),
    minutes:
      typeof input.minutes === 'number' && Number.isFinite(input.minutes)
        ? Math.max(0, Math.round(input.minutes))
        : null,
    subject: input.subject?.trim() ? input.subject.trim().slice(0, 60) : null,
    url: input.url ? normalizeLessonUrl(input.url) : null,
    done: input.done === true,
  };
}

export interface PlanDayChange {
  added: string[];
  removed: string[];
  retimed: string[];
}

/**
 * What one day's rewrite did, in the three things worth telling a student
 * about: lessons that appeared, lessons that went, and lessons that moved.
 */
export function diffPlanDay(before: PlanItem[], after: PlanItem[]): PlanDayChange {
  const titleOf = (items: PlanItem[]) => items.map((item) => item.title.trim().toLowerCase());
  const beforeTitles = titleOf(before);
  const afterTitles = titleOf(after);
  const byTitle = new Map(after.map((item) => [item.title.trim().toLowerCase(), item]));
  return {
    added: after.filter((item) => !beforeTitles.includes(item.title.trim().toLowerCase())).map((item) => item.title),
    removed: before.filter((item) => !afterTitles.includes(item.title.trim().toLowerCase())).map((item) => item.title),
    retimed: before
      .filter((item) => {
        const next = byTitle.get(item.title.trim().toLowerCase());
        return !!next && (next.time ?? null) !== (item.time ?? null) && !!next.time;
      })
      .map((item) => item.title),
  };
}

/**
 * Guardian: rewrite one day of a plan that is still running.
 *
 * Only a day that has not gone by may be rewritten (`canEditPlanDay`), and only
 * that day moves: every other day comes through exactly as it was, ids and
 * ticks intact, so a report already filed still answers the lessons it was
 * about. Null when the day is locked or the week would overflow.
 */
export function withPlanDayRewritten(
  plan: GuardianPlan,
  date: string,
  lessons: PlanLessonInput[],
  today = todayISO(),
  now = new Date(),
): GuardianPlan | null {
  if (!canEditPlanDay(plan, date, today)) return null;
  const day = lessons.flatMap((input) => {
    const clean = cleanLessonInput(input);
    return clean ? [{ ...clean, date }] : [];
  });
  const kept = plan.items.filter((item) => item.date !== date);
  if (kept.length + day.length > WEEK_LESSON_LIMIT) return null;
  return {
    ...plan,
    items: sortPlanItems([...kept, ...day]),
    updatedAt: now.toISOString(),
  };
}

/**
 * What a day's rewrite did, in one line for the student's inbox. A change to a
 * plan they are living by is worth being told about in words, not only in the
 * week looking different on the next sync.
 */
export function planDayChangeSummary(date: string, change: PlanDayChange): string {
  const day = isValidISODate(date) ? formatFullDate(date) : date;
  const parts: string[] = [];
  if (change.added.length > 0) parts.push(t('added {0}', { 0: change.added.join(', ') }));
  if (change.removed.length > 0) parts.push(t('took off {0}', { 0: change.removed.join(', ') }));
  if (change.retimed.length > 0) parts.push(t('gave {0} a new time', { 0: change.retimed.join(', ') }));
  if (parts.length === 0) return t('The plan for {0} is unchanged.', { 0: day });
  return `${t('Plan changed for {0}', { 0: day })}: ${parts.join('; ')}`;
}

/** One day's rewrite: the day, and the lessons it should hold from now on. */
export interface PlanDayEdit {
  date: string;
  lessons: PlanLessonInput[];
}

/**
 * Guardian: rewrite several days of a running plan at once, so one week's worth
 * of adjustments is one change and one line to the student rather than seven.
 * Null when any day in the batch is locked — a change is applied whole or not
 * at all, so nobody has to guess which half of it landed.
 */
export function withPlanDaysRewritten(
  plan: GuardianPlan,
  edits: PlanDayEdit[],
  today = todayISO(),
  now = new Date(),
): GuardianPlan | null {
  if (edits.length === 0) return null;
  if (edits.some((edit) => !canEditPlanDay(plan, edit.date, today))) return null;
  let next: GuardianPlan = plan;
  for (const edit of edits) {
    const changed = withPlanDayRewritten(next, edit.date, edit.lessons, today, now);
    if (!changed) return null;
    next = changed;
  }
  return next;
}

/* ------------------------------------------------------- change asks (16) */

/** A change ask as the student types it. */
export interface PlanChangeDraft {
  kind: PlanChangeKind;
  title: string;
  /** The lesson a removal points at, so an approval drops the right one. */
  itemId?: string | null;
  date: string | null;
  time?: string | null;
  end?: string | null;
  note?: string;
}

/**
 * Build one ask, ready to travel.
 *
 * Null when it cannot be made: no lesson named, a plan that has closed, or a
 * day that has gone by. Asking about yesterday would only be noise on both
 * sides, so the ask is refused here rather than answered later.
 */
export function buildChangeRequest(
  plan: GuardianPlan,
  linkId: string,
  draft: PlanChangeDraft,
  today = todayISO(),
  now = new Date(),
): PlanChangeRequest | null {
  const title = draft.title.trim().slice(0, PLAN_CHANGE_TITLE_MAX);
  if (!title) return null;
  if (!canRequestPlanChange(plan, draft.date, today)) return null;
  const time = draft.time && isValidTime(draft.time) ? draft.time : null;
  return {
    id: `change-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    linkId,
    planId: plan.id,
    date: draft.date && isValidISODate(draft.date) ? draft.date : null,
    kind: draft.kind === 'remove' ? 'remove' : 'add',
    title,
    itemId: draft.kind === 'remove' ? draft.itemId?.slice(0, 80) ?? null : null,
    time,
    end: normalizeLessonEnd(time, draft.end),
    note: (draft.note ?? '').trim().slice(0, PLAN_CHANGE_NOTE_MAX),
    state: 'open',
    reply: '',
    answeredAt: null,
    createdAt: now.toISOString(),
  };
}

/** Student: put an ask for a change on its way to every guardian who can answer it. */
export function withStudentChangeRequest(panels: Panels, request: PlanChangeRequest): Panels {
  return {
    ...panels,
    student: {
      ...panels.student,
      changeRequests: [request, ...(panels.student.changeRequests ?? []).filter((item) => item.id !== request.id)].slice(
        0,
        PLAN_CHANGES_KEPT,
      ),
    },
  };
}

/** Student: take back an ask nobody has answered yet. */
export function withoutStudentChangeRequest(panels: Panels, requestId: string): Panels {
  const request = (panels.student.changeRequests ?? []).find((item) => item.id === requestId);
  if (!request || request.state !== 'open') return panels;
  return {
    ...panels,
    student: {
      ...panels.student,
      changeRequests: (panels.student.changeRequests ?? []).filter((item) => item.id !== requestId),
    },
  };
}

/**
 * A change request the student may still make: the plan is open, and the day is
 * today or later. Yesterday's lessons are not the student's to ask about
 * either — the day is already reported, and asking would only be noise.
 */
export function canRequestPlanChange(plan: GuardianPlan, date: string | null, today = todayISO()): boolean {
  if (plan.approvedAt || !isValidISODate(plan.start)) return false;
  if (!date) return today >= plan.start && today <= planPeriodEnd(plan);
  return canEditPlanDay(plan, date, today);
}

/** Asks still open or freshly answered, oldest first — the order they were asked in. */
export function openChangeRequests(requests: PlanChangeRequest[], today = todayISO()): PlanChangeRequest[] {
  const earliest = addDays(today, -PLAN_CHANGE_DAYS);
  return requests
    .filter((request) => request.createdAt.slice(0, 10) >= earliest)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** What a guardian has to decide, oldest first. */
export function pendingChangeRequests(requests: PlanChangeRequest[], today = todayISO()): PlanChangeRequest[] {
  return openChangeRequests(requests, today).filter((request) => request.state === 'open');
}

/** One request, worded for the panel: "Add · Thursday, 15 October · Mathematics". */
export function changeRequestLabel(request: PlanChangeRequest): string {
  const kind = request.kind === 'add' ? t('Add') : t('Remove');
  const when = request.date && isValidISODate(request.date) ? formatFullDate(request.date) : t('Any day');
  return `${kind} · ${when} · ${request.title}`;
}

/**
 * What approving an ask does to the plan — the change itself, so both sides
 * make it the same way.
 *
 * Null when the ask can no longer be honoured: the day went by while it waited,
 * the lesson it pointed at is gone, or the week is full. A guardian reading
 * that gets told the ask is too late rather than silently changing nothing.
 */
export function applyChangeRequest(
  plan: GuardianPlan,
  request: PlanChangeRequest,
  today = todayISO(),
  now = new Date(),
): GuardianPlan | null {
  if (!canRequestPlanChange(plan, request.date, today)) return null;
  if (request.kind === 'remove') {
    const target =
      plan.items.find((item) => item.id === request.itemId) ??
      plan.items.find(
        (item) =>
          item.title.trim().toLowerCase() === request.title.trim().toLowerCase() &&
          (item.date ?? null) === (request.date ?? null),
      );
    if (!target || target.done) return null;
    return { ...plan, items: plan.items.filter((item) => item.id !== target.id), updatedAt: now.toISOString() };
  }
  const clean = cleanLessonInput({
    title: request.title,
    time: request.time ?? null,
    end: request.end ?? null,
  });
  if (!clean) return null;
  if (plan.items.length + 1 > WEEK_LESSON_LIMIT) return null;
  const exists = plan.items.some(
    (item) =>
      item.title.trim().toLowerCase() === clean.title.trim().toLowerCase() &&
      (item.date ?? null) === (request.date ?? null),
  );
  if (exists) return null;
  return {
    ...plan,
    items: sortPlanItems([...plan.items, { ...clean, date: request.date ?? null }]),
    updatedAt: now.toISOString(),
  };
}

/**
 * Fold change requests from the wire into the ones already held. An answer
 * always wins over the open ask it answers, and the latest answer wins over an
 * older one, so a decline followed by an approval reads as the approval.
 */
export function mergeChangeRequests(
  current: PlanChangeRequest[],
  incoming: PlanChangeRequest[],
): PlanChangeRequest[] {
  const byId = new Map(current.map((request) => [request.id, request]));
  for (const request of incoming) {
    const previous = byId.get(request.id);
    if (!previous) {
      byId.set(request.id, request);
      continue;
    }
    if (previous.state !== 'open' && request.state === 'open') continue;
    if (
      previous.state !== 'open' &&
      request.state !== 'open' &&
      (previous.answeredAt ?? '') > (request.answeredAt ?? '')
    ) {
      continue;
    }
    byId.set(request.id, request);
  }
  return [...byId.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, PLAN_CHANGES_KEPT);
}

/** A guardian's answer, stamped onto the ask it answers. */
export function answeredChangeRequest(
  request: PlanChangeRequest,
  state: 'approved' | 'declined',
  reply: string,
  now = new Date(),
): PlanChangeRequest {
  return {
    ...request,
    state,
    reply: reply.trim().slice(0, PLAN_CHANGE_NOTE_MAX),
    answeredAt: now.toISOString(),
  };
}

/** Whether one ask can still be answered: open, and its day has not gone by. */
export function canAnswerChangeRequest(
  plan: GuardianPlan | undefined,
  request: PlanChangeRequest,
  today = todayISO(),
): boolean {
  if (request.state !== 'open') return false;
  if (!plan) return false;
  return canRequestPlanChange(plan, request.date, today);
}

/** "Nina asked to add Mathematics on Thursday" — what the guardian reads first. */
export function changeRequestNotice(
  request: PlanChangeRequest,
  studentName: string,
  studentUsername: string,
): GuardianNotice {
  const asked =
    request.kind === 'add'
      ? t('{0} asked to add {1} to the plan', { 0: studentName, 1: request.title })
      : t('{0} asked to take {1} off the plan', { 0: studentName, 1: request.title });
  const when = request.date && isValidISODate(request.date) ? ` · ${formatFullDate(request.date)}` : '';
  const summary = `${asked}${when}${request.note ? `: ${request.note}` : ''}`;
  return {
    id: `change-${request.id}`,
    student: studentUsername,
    author: studentName,
    summary: summary.slice(0, 160),
    weekOf: '',
    createdAt: request.createdAt,
    read: false,
    kind: 'request',
  };
}
