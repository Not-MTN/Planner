// @vitest-environment node
/**
 * A report is read away from the app, often by someone else, and it is made out
 * of text a person typed. So what is checked here is that the numbers are the
 * week's, that the shapes agree with each other, and that nothing typed into a
 * task title can turn into markup on the printed page.
 */
import { describe, expect, it } from 'vitest';
import { addHabit, addTask, logFocus, toggleHabit, toggleTask } from './mutate';
import { setWeekStart } from './dates';
import { createEmptyState, type PlannerState, type TaskInput } from './types';
import { buildWeeklyReport, weeklyReportHtml, weeklyReportMarkdown } from './weeklyReport';

const baseTask: TaskInput = {
  title: 'Water plants',
  priority: 'medium',
  dueDate: null,
  dueTime: null,
  category: 'home',
  note: '',
  goalId: null,
};

const DAY = 86_400_000;

/** A week with three finished tasks, one left open, and a habit kept twice. */
function week(): PlannerState {
  let state = addHabit(createEmptyState(), { name: 'Run', icon: 'walk', accent: 'sage', frequency: { type: 'daily' } }, 'habit', 'now', '2026-09-01');
  for (let offset = 0; offset < 3; offset += 1) {
    const date = new Date(Date.UTC(2026, 8, 21) + offset * DAY).toISOString().slice(0, 10);
    state = addTask(state, { ...baseTask, title: `Done ${offset}`, dueDate: date }, `done-${offset}`);
    state = toggleTask(state, `done-${offset}`, `${date}T12:00:00.000Z`, date);
  }
  state = addTask(state, { ...baseTask, title: 'Left over', dueDate: '2026-09-20' }, 'open');
  state = toggleHabit(state, 'habit', '2026-09-21');
  state = toggleHabit(state, 'habit', '2026-09-22');
  state = logFocus(state, { taskId: null, title: 'Write', minutes: 90 }, 'focus', '2026-09-22T09:00:00.000Z', '2026-09-22');
  return state;
}

describe('the numbers a report is made of', () => {
  it('counts the week, not everything ever planned', () => {
    const report = buildWeeklyReport(week(), '2026-09-23');
    // Three tasks and two days of the habit: a habit kept is an item planned
    // and done, the same as a task.
    expect(report.done).toBe(5);
    expect(report.planned).toBe(6);
    expect(report.finished).toEqual(['Done 0', 'Done 1', 'Done 2']);
    expect(report.open.map((item) => item.title)).toEqual(['Left over']);
    expect(report.focusMinutes).toBe(90);
  });

  it('only looks at the days that have happened', () => {
    // Wednesday: the rest of the week has not happened, so it cannot be counted.
    const report = buildWeeklyReport(week(), '2026-09-23');
    expect(report.days.at(-1)).toBe('2026-09-23');
    expect(report.days.length).toBeLessThan(7);
  });

  it('says so honestly when the week is empty', () => {
    const report = buildWeeklyReport(createEmptyState(), '2026-09-23');
    expect(report).toMatchObject({ done: 0, planned: 0, focusMinutes: 0, sessions: 0 });
    expect(report.finished).toEqual([]);
    expect(weeklyReportMarkdown(report)).toContain('**Completed:** 0 of 0');
  });

  it('follows the week start the person chose', () => {
    setWeekStart(0);
    const sunday = buildWeeklyReport(week(), '2026-09-23').range;
    setWeekStart(1);
    const monday = buildWeeklyReport(week(), '2026-09-23').range;
    expect(sunday).not.toBe(monday);
  });
});

describe('the same week in both shapes', () => {
  it('keeps the markdown it has always had', () => {
    const text = weeklyReportMarkdown(buildWeeklyReport(week(), '2026-09-23'));
    expect(text).toContain('**Focus:** 1.5 h across 1 session');
    expect(text.startsWith('# Week of ')).toBe(true);
    expect(text).toContain('## Finished');
    expect(text).toContain('- [x] Done 0');
    expect(text).toContain('## Still open');
    expect(text).toContain('- [ ] Left over (due 2026-09-20)');
    expect(text).toContain('## Habits');
    expect(text).toContain('- Run: 2/3 days');
  });

  it('carries the same figures onto the printed page', () => {
    const report = buildWeeklyReport(week(), '2026-09-23');
    const html = weeklyReportHtml(report, { madeOn: '2026-09-23' });
    expect(html).toContain('Done 0');
    expect(html).toContain('Left over');
    expect(html).toContain('Run');
    expect(html).toContain(report.range);
  });
});

describe('the printed page', () => {
  it('is a document of its own, not a fragment', () => {
    const html = weeklyReportHtml(buildWeeklyReport(week(), '2026-09-23'), { madeOn: '2026-09-23' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>');
    expect(html).toContain('@page');
  });

  it('cannot be changed by what someone typed', () => {
    // A task title is text a person wrote. It must appear as text and nothing else.
    const hostile = '<script>alert(1)</script> & "quoted"';
    let state = addTask(createEmptyState(), { ...baseTask, title: hostile, dueDate: '2026-09-21' }, 'bad');
    state = toggleTask(state, 'bad', '2026-09-21T12:00:00.000Z', '2026-09-21');
    const html = weeklyReportHtml(buildWeeklyReport(state, '2026-09-23'), { madeOn: '2026-09-23' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#60;script&#62;');
  });

  it('writes a reflection onto the page, and leaves it out when there is none', () => {
    const report = buildWeeklyReport(week(), '2026-09-23');
    expect(weeklyReportHtml(report, { madeOn: '2026-09-23', note: 'A good week.' })).toContain('A good week.');
    expect(weeklyReportHtml(report, { madeOn: '2026-09-23', note: '   ' })).not.toContain('Reflection');
    expect(weeklyReportHtml(report, { madeOn: '2026-09-23' })).not.toContain('Reflection');
  });

  it('follows the direction of the language it is written in', () => {
    const report = buildWeeklyReport(week(), '2026-09-23');
    expect(weeklyReportHtml(report, { madeOn: '2026-09-23', dir: 'rtl', lang: 'fa' })).toContain('dir="rtl"');
    expect(weeklyReportHtml(report, { madeOn: '2026-09-23' })).toContain('dir="ltr"');
  });
});
