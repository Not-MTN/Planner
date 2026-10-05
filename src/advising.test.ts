/**
 * The advising one-pager.
 *
 * The guard rails are what this file is really about: the agenda is built from
 * shared weekly *results* alone, the numbers it states are the numbers that
 * were shared, and a quiet subject is named rather than turned into a verdict
 * on the student. The HTML is checked for escaping because a subject name is
 * something a person typed.
 */
import { describe, expect, it } from 'vitest';
import { advisingHtml, advisingRange, buildAdvisingAgenda } from './advising';
import type { WeekResults } from './types';

function week(weekOf: string, over: Partial<WeekResults> = {}): WeekResults {
  return {
    weekOf,
    planned: 10,
    done: 8,
    focusMinutes: 300,
    subjects: [
      { name: 'Physics', minutes: 120 },
      { name: 'Chemistry', minutes: 90 },
    ],
    headline: null,
    updatedAt: `${weekOf}T18:00:00.000Z`,
    ...over,
  };
}

describe('building the agenda', () => {
  it('reads the weeks oldest first and keeps four at most', () => {
    const agenda = buildAdvisingAgenda({
      student: 'Amir',
      history: [week('2026-03-02'), week('2026-03-09'), week('2026-03-16'), week('2026-02-23'), week('2026-03-23')],
    });
    expect(agenda.weeks).toEqual(['2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'].slice(-4));
  });

  it('names a subject that went quiet instead of scoring the student', () => {
    const agenda = buildAdvisingAgenda({
      student: 'Amir',
      history: [
        week('2026-03-09', { subjects: [{ name: 'Physics', minutes: 120 }, { name: 'Chemistry', minutes: 90 }] }),
        week('2026-03-16', { subjects: [{ name: 'Physics', minutes: 140 }] }),
      ],
    });
    expect(agenda.slipped.join(' ')).toMatch(/Chemistry/);
    expect(agenda.questions.join(' ')).toMatch(/Chemistry/);
    expect(agenda.nextSteps.join(' ')).toMatch(/Chemistry/);
  });

  it('praises a plan that was finished at a size that worked', () => {
    const agenda = buildAdvisingAgenda({
      student: 'Amir',
      history: [week('2026-03-16', { planned: 6, done: 6 })],
    });
    expect(agenda.wentWell.join(' ')).toMatch(/6 of 6/);
  });

  it('says the plan was larger than the week when most of it stayed open', () => {
    const agenda = buildAdvisingAgenda({
      student: 'Amir',
      history: [week('2026-03-16', { planned: 10, done: 3 })],
    });
    expect(agenda.slipped.join(' ')).toMatch(/unfinished/);
    expect(agenda.nextSteps.join(' ')).toMatch(/three things/);
  });

  it('quotes the student in the questions rather than paraphrasing them', () => {
    const agenda = buildAdvisingAgenda({
      student: 'Amir',
      history: [week('2026-03-16', { headline: 'Maths is fine, chemistry is scary' })],
    });
    expect(agenda.headline).toBe('Maths is fine, chemistry is scary');
    expect(agenda.questions.join(' ')).toContain('Maths is fine, chemistry is scary');
  });

  it('uses the latest snapshot even when the history has not caught up', () => {
    const agenda = buildAdvisingAgenda({
      student: 'Amir',
      history: [],
      results: week('2026-03-16'),
    });
    expect(agenda.empty).toBe(false);
    expect(agenda.weeks).toEqual(['2026-03-16']);
  });

  it('still produces an agenda when nothing has been shared', () => {
    const agenda = buildAdvisingAgenda({ student: 'Amir', history: [] });
    expect(agenda.empty).toBe(true);
    expect(agenda.questions.length).toBeGreaterThan(0);
    expect(agenda.nextSteps.length).toBeGreaterThan(0);
  });

  it('survives a week with no subjects at all', () => {
    const agenda = buildAdvisingAgenda({
      student: 'Amir',
      history: [week('2026-03-16', { subjects: [] })],
    });
    expect(agenda.subjects).toEqual([]);
    expect(agenda.weeks).toHaveLength(1);
  });
});

describe('the printed page', () => {
  const agenda = buildAdvisingAgenda({
    student: 'Amir <b>',
    history: [week('2026-03-09'), week('2026-03-16', { headline: '<script>alert(1)</script>' })],
  });

  it('covers the whole span of shared weeks', () => {
    // The first shared week to the Sunday after the last one, in the user's
    // own date language — which is why the years are not asserted here.
    const range = advisingRange(agenda);
    expect(range.split('—')).toHaveLength(2);
    expect(range).toMatch(/9 March/);
    expect(range).toMatch(/22 March/);
  });

  it('escapes what a person typed', () => {
    const html = advisingHtml(agenda, { madeOn: '2026-03-17' });
    // Same numeric-entity escaping as the weekly report's printed page.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&#60;script&#62;');
    expect(html).toContain('Amir &#60;b&#62;');
  });

  it('carries the privacy line and no task or note detail', () => {
    const html = advisingHtml(agenda, { madeOn: '2026-03-17' });
    expect(html).toMatch(/never tasks or notes/);
    expect(html).toMatch(/Where the time went/);
  });
});
