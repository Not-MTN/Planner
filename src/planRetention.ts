/**
 * What a finished plan becomes.
 *
 * A week that is done and signed off is not something anyone re-opens lesson by
 * lesson. What they come back for is "how did that week go" — and until now the
 * answer to that question was either the whole plan, kept forever, or nothing,
 * because storage caps the plan list at ten and the eleventh simply fell off
 * the end. Both are wrong: the first keeps detail nobody reads, the second
 * throws away the record.
 *
 * So a plan that is finished keeps its full item list for a month — long enough
 * to re-read while it is still recent and to answer a question about one
 * specific lesson — and after that the lessons are let go and a `PlanReview`
 * stays in their place: the shape of the week in numbers.
 *
 * "Finished" means every lesson ticked **or** the guardian signed it off. A plan
 * that is still partly open is never rolled up, however old it is: an open
 * lesson from a month ago is still an open lesson, and rolling it up would be
 * losing work rather than forgetting noise.
 *
 * Everything here is pure, deterministic and idempotent — two devices looking at
 * the same plan write the same review, and running it twice changes nothing.
 */
import { parseISODate, startOfWeek, todayISO } from './dates';
import type { GuardianPlan, PlanReview, PlanReviewSubject } from './types';

/** A finished plan keeps its lessons for this long before they are let go. */
export const PLAN_KEEP_DAYS = 30;
/** How many reviews are kept per link. A year of weeks, with room to spare. */
export const PLAN_REVIEWS_KEPT = 60;
/** The note is trimmed to this: one line is all a summary can hold. */
const REVIEW_NOTE_MAX = 160;

const DAY_MS = 86_400_000;

/** Every lesson in this plan has been ticked. An empty plan is not finished. */
export function isPlanComplete(plan: GuardianPlan): boolean {
  return plan.items.length > 0 && plan.items.every((item) => item.done === true);
}

/** Done, or signed off by the guardian — either way the week is closed. */
export function isPlanFinished(plan: GuardianPlan): boolean {
  return !!plan.approvedAt || isPlanComplete(plan);
}

/**
 * The last day this plan covers.
 *
 * A plan sent a month ago for *last* week is still recent: what matters is when
 * the week ended, not when the guardian wrote it. Falls back to the last edit
 * when nothing in the plan carries a date.
 */
export function planEndsOn(plan: GuardianPlan): string {
  const dated = plan.items
    .map((item) => item.date)
    .filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const last = dated[dated.length - 1];
  if (last) return last;
  return (plan.updatedAt || plan.createdAt || '').slice(0, 10) || todayISO();
}

/** Days since the week this plan covered ended. Negative when still ahead. */
export function planDaysOld(plan: GuardianPlan, today = todayISO()): number {
  const ends = Date.parse(planEndsOn(plan));
  const now = Date.parse(today);
  if (!Number.isFinite(ends) || !Number.isFinite(now)) return 0;
  return Math.floor((now - ends) / DAY_MS);
}

/** The date the lessons may be let go — the end of the month they are kept for. */
export function planKeepUntil(plan: GuardianPlan): string {
  const ends = Date.parse(planEndsOn(plan));
  if (!Number.isFinite(ends)) return todayISO();
  return new Date(ends + PLAN_KEEP_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Whether this plan's month is up and its lessons can be let go.
 *
 * Open plans never are, whatever their age.
 */
export function isPlanRollable(plan: GuardianPlan, today = todayISO()): boolean {
  return isPlanFinished(plan) && planDaysOld(plan, today) >= PLAN_KEEP_DAYS;
}

/** How many lessons the student ticked. */
export function planDoneCount(plan: GuardianPlan): number {
  return plan.items.filter((item) => item.done === true).length;
}

/**
 * The week, in numbers.
 *
 * Subjects come heaviest first and are named the way the plan named them, so a
 * review reads as the week it came from rather than as an inventory. A lesson
 * with no subject still counts: it happened, and dropping it would understate
 * the week.
 */
export function buildPlanReview(plan: GuardianPlan, today = todayISO()): PlanReview {
  const bySubject = new Map<string, PlanReviewSubject>();
  let minutes = 0;
  for (const item of plan.items) {
    const name = (item.subject ?? '').trim() || '';
    const planned = typeof item.minutes === 'number' && Number.isFinite(item.minutes) ? item.minutes : 0;
    minutes += planned;
    const entry = bySubject.get(name) ?? { name, lessons: 0, done: 0, minutes: 0 };
    entry.lessons += 1;
    entry.minutes += planned;
    if (item.done === true) entry.done += 1;
    bySubject.set(name, entry);
  }
  // Heaviest first; ties by name, so two devices cannot disagree on the order.
  const subjects = [...bySubject.values()]
    .filter((entry) => entry.name || entry.lessons > 0)
    .sort((a, b) => b.minutes - a.minutes || b.lessons - a.lessons || a.name.localeCompare(b.name));

  return {
    id: plan.id,
    linkId: plan.linkId,
    weekOf: startOfWeek(plan.start),
    title: plan.title,
    author: plan.author,
    approvedAt: plan.approvedAt ?? null,
    reviewedAt: today,
    lessons: plan.items.length,
    done: planDoneCount(plan),
    minutes,
    subjects,
    note: (plan.note ?? '').trim().slice(0, REVIEW_NOTE_MAX),
  };
}

export interface PlanRollUp {
  /** Plans that stay as they are — recent, or still open. */
  plans: GuardianPlan[];
  /** The reviews, newest week first. */
  reviews: PlanReview[];
  /** How many plans were rolled up in this run. Zero means nothing changed. */
  rolled: number;
}

/**
 * Roll up one list of plans against the reviews already held.
 *
 * Idempotent: a plan that has already been reviewed is not counted again, and
 * its review is not rewritten, so the `reviewedAt` it carries is the day it was
 * actually let go rather than the day someone last saved.
 */
export function rollUpPlans(
  plans: GuardianPlan[],
  existing: PlanReview[] | undefined,
  today = todayISO(),
): PlanRollUp {
  const known = new Map((existing ?? []).map((review) => [review.id, review]));
  const kept: GuardianPlan[] = [];
  let rolled = 0;

  for (const plan of plans) {
    if (known.has(plan.id) || !isPlanRollable(plan, today)) {
      kept.push(plan);
      continue;
    }
    known.set(plan.id, buildPlanReview(plan, today));
    rolled += 1;
  }

  const reviews = [...known.values()]
    .sort((a, b) => b.weekOf.localeCompare(a.weekOf) || b.reviewedAt.localeCompare(a.reviewedAt))
    .slice(0, PLAN_REVIEWS_KEPT);

  return { plans: kept, reviews, rolled };
}

/**
 * One line for the panel: how a rolled-up week went.
 *
 * Written here rather than in the view so both panels phrase a past week the
 * same way, and so the numbers cannot drift apart from the review they came from.
 */
export function planReviewSummary(review: PlanReview): string {
  const parts = [
    review.done === review.lessons
      ? `${review.done}/${review.lessons}`
      : `${review.done}/${review.lessons}`,
    `${review.minutes}m`,
  ];
  const top = review.subjects[0]?.name;
  if (top) parts.push(top);
  return parts.join(' · ');
}

/** The week a review covers, as a date the calendar helpers accept. */
export function planReviewWeekStart(review: PlanReview): Date {
  const parsed = Date.parse(review.weekOf);
  return Number.isFinite(parsed) ? parseISODate(review.weekOf) : new Date(0);
}
