import { describe, expect, it } from 'vitest';
import {
  PLAN_KEEP_DAYS,
  buildPlanReview,
  isPlanComplete,
  isPlanFinished,
  isPlanRollable,
  planDaysOld,
  planEndsOn,
  planKeepUntil,
  planReviewSummary,
  rollUpPlans,
} from './planRetention';
import { createEmptyState } from './types';
import type { GuardianPlan, PlanItem } from './types';

const TODAY = '2026-05-20';

const item = (id: string, over: Partial<PlanItem> = {}): PlanItem => ({
  id,
  title: `Lesson ${id}`,
  date: '2026-04-06',
  time: '16:00',
  end: '18:00',
  minutes: 120,
  subject: 'Chemistry',
  url: null,
  done: true,
  ...over,
});

const plan = (over: Partial<GuardianPlan> = {}): GuardianPlan => ({
  id: 'plan-1',
  author: 'Mum',
  linkId: 'link-1',
  cadence: 'week',
  start: '2026-04-06',
  title: 'The week before exams',
  note: 'Two chemistry sessions and a rest day.',
  items: [item('a'), item('b', { subject: 'Physics', minutes: 60, date: '2026-04-08' })],
  createdAt: '2026-04-01T08:00:00.000Z',
  updatedAt: '2026-04-06T08:00:00.000Z',
  ...over,
});

describe('what counts as finished', () => {
  it('is finished when every lesson was ticked', () => {
    expect(isPlanComplete(plan())).toBe(true);
    expect(isPlanComplete(plan({ items: [item('a'), item('b', { done: false })] }))).toBe(false);
  });

  it('is not finished when there was nothing to tick', () => {
    expect(isPlanComplete(plan({ items: [] }))).toBe(false);
  });

  it('counts a guardian’s sign-off as finished, ticks or not', () => {
    const open = plan({ items: [item('a', { done: false })], approvedAt: '2026-04-12T09:00:00.000Z' });
    expect(isPlanComplete(open)).toBe(false);
    expect(isPlanFinished(open)).toBe(true);
  });
});

describe('how old a plan is', () => {
  it('is measured from the end of the week it covered, not the day it was sent', () => {
    // Sent on the 1st, covering a week that ends on the 8th.
    expect(planEndsOn(plan())).toBe('2026-04-08');
    expect(planDaysOld(plan(), '2026-04-08')).toBe(0);
    expect(planDaysOld(plan(), '2026-04-18')).toBe(10);
  });

  it('falls back to the last edit when nothing carries a date', () => {
    expect(planEndsOn(plan({ items: [item('a', { date: null })] }))).toBe('2026-04-06');
  });

  it('gives the day the lessons may be let go', () => {
    expect(planKeepUntil(plan())).toBe('2026-05-08');
    expect(PLAN_KEEP_DAYS).toBe(30);
  });
});

describe('when a plan is rolled up', () => {
  it('stays whole for its month', () => {
    expect(isPlanRollable(plan(), '2026-05-07')).toBe(false);
    expect(isPlanRollable(plan(), '2026-05-08')).toBe(true);
  });

  it('is never rolled up while a lesson is still open', () => {
    const open = plan({ items: [item('a'), item('b', { done: false })] });
    expect(isPlanRollable(open, '2027-01-01')).toBe(false);
  });

  it('is rolled up on age once the guardian has signed it off', () => {
    const approved = plan({ items: [item('a', { done: false })], approvedAt: '2026-04-12T09:00:00.000Z' });
    expect(isPlanRollable(approved, '2026-05-08')).toBe(true);
  });
});

describe('the review a finished plan becomes', () => {
  const review = buildPlanReview(plan(), TODAY);

  it('keeps the shape of the week in numbers', () => {
    expect(review).toMatchObject({
      id: 'plan-1',
      linkId: 'link-1',
      weekOf: '2026-04-06',
      title: 'The week before exams',
      lessons: 2,
      done: 2,
      minutes: 180,
      reviewedAt: TODAY,
    });
  });

  it('names the subjects, heaviest first', () => {
    expect(review.subjects.map((entry) => entry.name)).toEqual(['Chemistry', 'Physics']);
    expect(review.subjects[0]).toMatchObject({ lessons: 1, minutes: 120, done: 1 });
  });

  it('counts an unticked lesson as one that did not happen', () => {
    const partial = buildPlanReview(plan({ items: [item('a'), item('b', { done: false })] }), TODAY);
    expect(partial.done).toBe(1);
    expect(partial.lessons).toBe(2);
  });

  it('keeps a lesson with no subject rather than dropping it', () => {
    const loose = buildPlanReview(plan({ items: [item('a', { subject: null, minutes: 30 })] }), TODAY);
    expect(loose.lessons).toBe(1);
    expect(loose.minutes).toBe(30);
  });

  it('carries the sign-off, and says so when there was none', () => {
    expect(buildPlanReview(plan(), TODAY).approvedAt).toBeNull();
    expect(
      buildPlanReview(plan({ approvedAt: '2026-04-12T09:00:00.000Z' }), TODAY).approvedAt,
    ).toBe('2026-04-12T09:00:00.000Z');
  });

  it('is the same review on any device', () => {
    expect(buildPlanReview(plan(), TODAY)).toEqual(buildPlanReview(plan(), TODAY));
  });

  it('sums up in one line', () => {
    expect(planReviewSummary(review)).toBe('2/2 · 180m · Chemistry');
  });
});

describe('rolling a list of plans up', () => {
  const old = plan();
  const recent = plan({ id: 'plan-2', start: '2026-05-11', items: [item('c', { date: '2026-05-12' })] });
  const stillOpen = plan({ id: 'plan-3', items: [item('d', { done: false })] });

  it('lets go of the old finished ones and keeps the rest', () => {
    const result = rollUpPlans([old, recent, stillOpen], [], TODAY);
    expect(result.plans.map((entry) => entry.id)).toEqual(['plan-2', 'plan-3']);
    expect(result.reviews.map((entry) => entry.id)).toEqual(['plan-1']);
    expect(result.rolled).toBe(1);
  });

  it('does the same thing twice: a review is written once', () => {
    const first = rollUpPlans([old, recent], [], TODAY);
    const second = rollUpPlans(first.plans, first.reviews, TODAY);
    expect(second.rolled).toBe(0);
    expect(second.reviews).toEqual(first.reviews);
  });

  it('keeps the day a review was written rather than rewriting it', () => {
    const written = rollUpPlans([old], [], '2026-05-08');
    const later = rollUpPlans([], written.reviews, '2026-09-01');
    expect(later.reviews[0]?.reviewedAt).toBe('2026-05-08');
  });

  it('does nothing at all when nothing is due', () => {
    const idle = rollUpPlans([recent, stillOpen], [], TODAY);
    expect(idle.rolled).toBe(0);
    expect(idle.reviews).toEqual([]);
    expect(idle.plans).toHaveLength(2);
  });

  it('lists the newest week first', () => {
    const older = plan({ id: 'plan-0', start: '2026-03-02', items: [item('e', { date: '2026-03-03' })] });
    const result = rollUpPlans([older, old], [], TODAY);
    expect(result.reviews.map((entry) => entry.weekOf)).toEqual(['2026-04-06', '2026-03-02']);
  });
});

describe('the planner’s own roll-up', () => {
  it('rolls panel plans up even when the reader asked to keep everything', async () => {
    const { rollUp } = await import('./retention');
    const state = {
      ...createEmptyState(),
      panels: {
        ...createEmptyState().panels,
        student: {
          ...createEmptyState().panels.student,
          inbox: { ...createEmptyState().panels.student.inbox, plans: [plan()] },
        },
      },
    };
    const result = rollUp(state, 0, TODAY);
    expect(result.dropped.planReviews).toBe(1);
    expect(result.state.panels.student.inbox.plans).toEqual([]);
    expect(result.state.panels.student.inbox.planReviews?.[0]?.id).toBe('plan-1');
  });

  it('leaves an open plan alone in the same run', async () => {
    const { rollUp } = await import('./retention');
    const open = plan({ items: [item('a', { done: false })] });
    const state = {
      ...createEmptyState(),
      panels: {
        ...createEmptyState().panels,
        student: {
          ...createEmptyState().panels.student,
          inbox: { ...createEmptyState().panels.student.inbox, plans: [open] },
        },
      },
    };
    expect(rollUp(state, 0, TODAY).dropped.planReviews).toBe(0);
  });
});
