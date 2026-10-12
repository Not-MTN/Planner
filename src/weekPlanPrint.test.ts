// @vitest-environment node
/**
 * The printed week: seven dated sections, the reports where they belong, a
 * page that stays readable when a plan came from the older step composer.
 */
import { describe, expect, it } from 'vitest';
import type { GuardianPlan } from './types';
import { timetableHtml, weekPlanHtml } from './weekPlanPrint';

const TODAY = '2026-10-12';

function plan(partial: Partial<GuardianPlan> = {}): GuardianPlan {
  return {
    id: 'plan-1',
    author: 'Parent',
    linkId: 'link-1',
    cadence: 'week',
    start: '2026-10-12',
    title: 'A week of lessons',
    note: '',
    items: [],
    createdAt: `${TODAY}T08:00:00.000Z`,
    updatedAt: `${TODAY}T08:00:00.000Z`,
    ...partial,
  };
}

describe('the printed week', () => {
  it('names the plan, the student, and the seven days', () => {
    const html = weekPlanHtml(
      plan({ items: [{ id: 'm', title: 'Maths', date: TODAY, time: '08:00', minutes: null, subject: null, done: true }] }),
      [],
      [],
      { student: 'Sara', madeOn: TODAY },
    );
    expect(html).toContain('A week of lessons');
    expect(html).toContain('Plan for Sara');
    expect(html).toContain('08:00');
    expect(html).toContain('Maths');
    expect(html).toContain('✓');
    expect(html.match(/<section>/g)).toHaveLength(7);
  });

  it('shows reported days with the student’s words, and finished days without as missing', () => {
    const week = plan({
      start: '2026-10-05',
      items: [
        { id: 'a', title: 'Maths', date: '2026-10-06', time: null, minutes: null, subject: null, done: true },
        { id: 'b', title: 'Physics', date: '2026-10-07', time: null, minutes: null, subject: null, done: false },
      ],
    });
    const html = weekPlanHtml(
      week,
      [
        {
          id: 'report-1',
          planId: 'plan-1',
          linkId: 'link-1',
          date: '2026-10-06',
          doneIds: ['a'],
          note: 'Finished early.',
          createdAt: '2026-10-06T20:00:00.000Z',
          updatedAt: '2026-10-06T20:00:00.000Z',
        },
      ],
      [],
      { student: 'Sara', madeOn: TODAY },
    );
    expect(html).toContain('Reported');
    expect(html).toContain('Finished early.');
    expect(html).toContain('Missing');
    // The future is neither reported nor missing.
    expect(html.match(/Missing/g)).toHaveLength(1);
  });

  it('gathers dateless steps under any day, without an empty time column', () => {
    const html = weekPlanHtml(
      plan({ items: [{ id: 'f', title: 'Read anything', date: null, time: null, minutes: null, subject: null, done: false }] }),
      [],
      [],
      { student: 'Sara', madeOn: TODAY },
    );
    expect(html).toContain('Any day');
    expect(html).toContain('Read anything');
    expect(html).not.toContain('<th scope="col">Time</th>');
  });

  it('escapes everything either side typed', () => {
    const html = weekPlanHtml(
      plan({ title: '<b>Week</b>', note: 'A & B', items: [{ id: 'x', title: '"Quoted"', date: TODAY, time: null, minutes: null, subject: null, done: false }] }),
      [],
      [],
      { student: '<img>', madeOn: TODAY },
    );
    expect(html).not.toContain('<b>Week</b>');
    expect(html).not.toContain('<img>');
    expect(html).toContain('&#60;b&#62;Week&#60;/b&#62;');
  });

  it('honours rtl and empty days', () => {
    const html = weekPlanHtml(plan(), [], [], { student: 'Sara', madeOn: TODAY, dir: 'rtl', lang: 'fa' });
    expect(html).toContain('<html lang="fa" dir="rtl">');
    expect(html.match(/No lessons planned\./g)).toHaveLength(7);
  });
});

describe('rest days, answers, and the wall grid', () => {
  const friday = '2026-10-09';

  it('marks rest days as rest, never as missing', () => {
    const html = weekPlanHtml(
      plan({
        start: '2026-10-05',
        restDays: [5],
        items: [{ id: 'f', title: 'Maths', date: friday, time: '08:00', minutes: null, subject: null, done: false }],
      }),
      [],
      [],
      { student: 'Sara', madeOn: TODAY },
    );
    expect(html).toContain('Rest day');
    expect(html).not.toContain('Missing');
  });

  it('prints the guardian’s answer under the report', () => {
    const html = weekPlanHtml(
      plan({
        start: '2026-10-05',
        items: [{ id: 'a', title: 'Maths', date: friday, time: null, minutes: null, subject: null, done: true }],
      }),
      [
        {
          id: 'report-1',
          planId: 'plan-1',
          linkId: 'link-1',
          date: friday,
          doneIds: ['a'],
          note: '',
          createdAt: `${friday}T20:00:00.000Z`,
          updatedAt: `${friday}T20:00:00.000Z`,
        },
      ],
      [
        {
          id: 'ack-1',
          reportId: 'report-1',
          planId: 'plan-1',
          linkId: 'link-1',
          date: friday,
          text: 'Well done.',
          reactions: ['🎉'],
          createdAt: `${friday}T21:00:00.000Z`,
        },
      ],
      { student: 'Sara', madeOn: TODAY },
    );
    expect(html).toContain('Seen');
    expect(html).toContain('Well done.');
  });

  it('lays the week out as days across and times down', () => {
    const html = timetableHtml(
      plan({
        items: [
          { id: 'a', title: 'Maths', date: TODAY, time: '08:00', minutes: null, subject: null, done: true },
          { id: 'b', title: 'Reading', date: TODAY, time: null, minutes: null, subject: null, done: false },
        ],
      }),
      [],
      { student: 'Sara', madeOn: TODAY },
    );
    expect(html).toContain('Timetable');
    expect(html).toContain('08:00');
    expect(html).toContain('Maths');
    expect(html).toContain('Any time');
    expect(html).toContain('Reading');
    expect(html).toContain('✓ Maths');
  });
});

describe('a repaired day on paper', () => {
  it('reads as kept, not reported', () => {
    const week = plan({
      start: '2026-10-05',
      items: [
        { id: 'a', title: 'Maths', date: '2026-10-06', time: null, minutes: null, subject: null, done: false },
      ],
    });
    const html = weekPlanHtml(
      week,
      [
        {
          id: 'report-kept',
          planId: 'plan-1',
          linkId: 'link-1',
          date: '2026-10-06',
          doneIds: [],
          note: 'Fever all day.',
          repair: true,
          createdAt: '2026-10-06T20:00:00.000Z',
          updatedAt: '2026-10-06T20:00:00.000Z',
        },
      ],
      [],
      { student: 'Sara', madeOn: '2026-10-12' },
    );
    expect(html).toContain('Streak kept');
    expect(html).toContain('Fever all day.');
    expect(html).not.toContain('>Reported<');
  });
});
