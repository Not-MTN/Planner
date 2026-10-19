// @vitest-environment node
/**
 * The printed week: seven dated sections, the reports where they belong, a
 * page that stays readable when a plan came from the older step composer.
 */
import { describe, expect, it } from 'vitest';
import type { GuardianPlan } from './types';
import { planPrintFit, timetableHtml, weekPlanHtml } from './weekPlanPrint';

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
    expect(html.match(/<section/g)).toHaveLength(7);
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
    // A reaction is an emoji, so it gets its own space on the line rather than
    // leaning against the words the guardian wrote.
    expect(html).toContain('<span class="reacts">🎉</span>');
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
    expect(html).toMatch(/tt-tick">✓<\/span><span class="tt-title">Maths/);
  });
});

describe('one verdict per day', () => {
  const friday = '2026-10-09';

  it('lets a filed report outrank the rest mark, and never calls a rest day missing', () => {
    const restWithReport = weekPlanHtml(
      plan({
        start: '2026-10-05',
        restDays: [5],
        items: [{ id: 'f', title: 'Maths', date: friday, time: '08:00', minutes: null, subject: null, done: true }],
      }),
      [
        {
          id: 'report-fri',
          planId: 'plan-1',
          linkId: 'link-1',
          date: friday,
          doneIds: ['f'],
          note: 'Did it anyway.',
          createdAt: `${friday}T20:00:00.000Z`,
          updatedAt: `${friday}T20:00:00.000Z`,
        },
      ],
      [],
      { student: 'Sara', madeOn: TODAY },
    );
    expect(restWithReport).toContain('flag reported">Reported');
    expect(restWithReport).not.toContain('flag rest');
    expect(restWithReport).toContain('Did it anyway.');

    // The same day with nothing filed is a rest day, not a missing one.
    const quietRest = weekPlanHtml(
      plan({
        start: '2026-10-05',
        restDays: [5],
        items: [{ id: 'f', title: 'Maths', date: friday, time: '08:00', minutes: null, subject: null, done: false }],
      }),
      [],
      [],
      { student: 'Sara', madeOn: TODAY },
    );
    expect(quietRest).toContain('flag rest">Rest day');
    expect(quietRest).not.toContain('Missing');
  });

  it('words a kept day the same on the wall grid as on the week page', () => {
    const week = plan({
      start: '2026-10-05',
      items: [{ id: 'f', title: 'Maths', date: friday, time: '08:00', minutes: null, subject: null, done: true }],
    });
    const reports = [
      {
        id: 'report-fri',
        planId: 'plan-1',
        linkId: 'link-1',
        date: friday,
        doneIds: ['f'],
        note: 'Caught up on Saturday.',
        repair: true,
        createdAt: `${friday}T20:00:00.000Z`,
        updatedAt: `${friday}T20:00:00.000Z`,
      },
    ];
    // The two pages are printed side by side, so they cannot disagree about
    // what a day was: kept is kept on both.
    expect(timetableHtml(week, reports, { student: 'Sara', madeOn: TODAY })).toContain('tt-mark">Streak kept');
    expect(weekPlanHtml(week, reports, [], { student: 'Sara', madeOn: TODAY })).toContain(
      'flag reported">Streak kept',
    );
  });
});

describe('the week at a glance on paper', () => {
  it('measures planned time from the spans, and from the estimates where there is no span', () => {
    const html = weekPlanHtml(
      plan({
        items: [
          { id: 'a', title: 'Maths', date: TODAY, time: '09:00', end: '11:00', minutes: null, subject: null, done: false },
          { id: 'b', title: 'Physics', date: TODAY, time: '14:00', minutes: 45, subject: null, done: false },
        ],
      }),
      [],
      [],
      { student: 'Sara', madeOn: TODAY },
    );
    // Two hours on the clock, plus the forty-five minutes someone typed.
    expect(html).toContain('<strong>2 h 45 min</strong>');
    expect(html).toContain('Planned time');
    expect(html).toMatch(/<strong>2<\/strong><span>Lessons<\/span>/);
    // And the lesson itself reads as the span it was given, with its length.
    expect(html).toContain('09:00 – 11:00<span class="dur">2 h</span>');
    expect(html).toContain('14:00');
  });

  it('says nothing it cannot measure', () => {
    const html = weekPlanHtml(plan({ items: [{ id: 'a', title: 'Reading', date: TODAY, time: null, minutes: null, subject: null, done: false }] }), [], [], {
      student: 'Sara',
      madeOn: TODAY,
    });
    expect(html).toContain('<strong>—</strong><span>Planned time</span>');
    // A lesson with no time of its own gets no empty time column.
    expect(html).not.toContain('>Time</th>');
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

describe('one page, whichever way round', () => {
  /** A week with this many lessons on every one of its seven days. */
  function busyWeek(perDay: number): GuardianPlan {
    const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
    return plan({
      items: days.flatMap((date, day) =>
        Array.from({ length: perDay }, (_, index) => ({
          id: `${day}-${index}`,
          title: `Lesson ${day}.${index}`,
          date,
          time: `${String(8 + (index % 10)).padStart(2, '0')}:00`,
          end: `${String(9 + (index % 10)).padStart(2, '0')}:00`,
          minutes: null,
          subject: null,
          done: false,
        })),
      ),
    });
  }

  it('carries the orientation the reader chose on the page itself', () => {
    const portrait = weekPlanHtml(busyWeek(2), [], [], { student: 'Sara', madeOn: TODAY, orientation: 'portrait' });
    const landscape = weekPlanHtml(busyWeek(2), [], [], { student: 'Sara', madeOn: TODAY, orientation: 'landscape' });
    expect(portrait).toContain('--page-orientation: portrait');
    expect(portrait).toContain('@page { size: A4 var(--page-orientation, portrait); margin: 8mm; }');
    expect(landscape).toContain('--page-orientation: landscape');
    // The wall grid follows the same choice.
    expect(timetableHtml(busyWeek(2), [], { student: 'Sara', madeOn: TODAY, orientation: 'landscape' })).toContain(
      '--page-orientation: landscape',
    );
    expect(timetableHtml(busyWeek(2), [], { student: 'Sara', madeOn: TODAY, orientation: 'portrait' })).toContain(
      '--page-orientation: portrait',
    );
  });

  it('keeps a short week roomy and a full one dense, instead of running to a second sheet', () => {
    const short = planPrintFit({ lessons: 6, days: 7 }, { orientation: 'portrait' });
    const full = planPrintFit({ lessons: 60, days: 7 }, { orientation: 'portrait' });
    expect(short).toMatchObject({ density: 'roomy', columns: 1, maxRows: null });
    expect(full.columns).toBeGreaterThan(short.columns);
    expect(full).toMatchObject({ maxRows: null });

    // Even a week nobody would plan still comes out on one page — the days say
    // "+N more" rather than the plan spilling over.
    const absurd = planPrintFit({ lessons: 400, days: 7 }, { orientation: 'portrait' });
    expect(absurd.density).toBe('micro');
    expect(absurd.maxRows).toBeGreaterThanOrEqual(1);
    const html = weekPlanHtml(busyWeek(60), [], [], { student: 'Sara', madeOn: TODAY, orientation: 'portrait' });
    expect(html).toContain('more');
  });

  it('uses the width a landscape sheet has', () => {
    const landscape = planPrintFit({ lessons: 60, days: 7 }, { orientation: 'landscape' });
    const portrait = planPrintFit({ lessons: 60, days: 7 }, { orientation: 'portrait' });
    expect(landscape.columns).toBeGreaterThanOrEqual(portrait.columns);
    expect(landscape.orientation).toBe('landscape');
  });

  it('follows the screen when nobody chose', () => {
    expect(planPrintFit({ lessons: 4, days: 7 }, { wide: false }).orientation).toBe('portrait');
    expect(planPrintFit({ lessons: 4, days: 7 }, { wide: true }).orientation).toBe('landscape');
    // A choice beats the screen.
    expect(planPrintFit({ lessons: 4, days: 7 }, { orientation: 'portrait', wide: true }).orientation).toBe('portrait');
  });

  it('prints the days in as many columns as the fit chose', () => {
    const html = weekPlanHtml(busyWeek(8), [], [], { student: 'Sara', madeOn: TODAY, orientation: 'portrait' });
    const columns = html.match(/--fit-columns: (\d)/)?.[1];
    expect(Number(columns)).toBeGreaterThan(1);
    expect(html).toContain('column-count: var(--fit-columns)');
    // The header is a slim band: the title is sized off the fit, not in pixels.
    expect(html).toContain('font-size: calc(var(--fit-font) * 1.5)');
    expect(html).not.toContain('fonts.googleapis.com');
  });
});
