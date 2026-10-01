import { formatFullDate, formatWeekRange, startOfWeek, weekDates } from './dates';
import { dayScore, formatPercent, habitStreaks } from './logic';
import { completionDate, focusSummary } from './insights';
import type { PlannerState } from './types';
import { t, tn } from './i18n';

/**
 * The week, written down.
 *
 * The point of a report is that it leaves the app: it gets printed, emailed,
 * pinned to a wall, handed to someone. So the week is first put into a plain
 * shape — numbers and names, nothing about how it will look — and then drawn
 * either as markdown or as a page, from the same numbers. One week, one set of
 * figures, whichever way it is asked for.
 */

export interface WeeklyReport {
  /** The week it covers, already written out for a reader. */
  range: string;
  /** The days of the week that have actually happened, so today is never compared to a future. */
  days: string[];
  done: number;
  planned: number;
  focusMinutes: number;
  sessions: number;
  finished: string[];
  open: Array<{ title: string; due: string }>;
  habits: Array<{ name: string; count: number; of: number; streak: number }>;
}

export function buildWeeklyReport(state: PlannerState, today: string): WeeklyReport {
  const days = weekDates(today).filter((date) => date <= today);
  let done = 0;
  let planned = 0;
  for (const date of days) {
    const score = dayScore(state, date, false);
    done += score.done;
    planned += score.total;
  }
  const focus = focusSummary(state, today, days.length || 1);
  const finished = state.tasks
    .filter((task) => {
      const date = completionDate(task);
      return date !== null && days.includes(date);
    })
    .slice(0, 30)
    .map((task) => task.title);
  const open = state.tasks
    .filter((task) => !task.completed && task.dueDate !== null && task.dueDate <= today)
    .slice(0, 30)
    .map((task) => ({ title: task.title, due: task.dueDate as string }));
  const habits = state.habits
    .filter((habit) => !habit.archived)
    .map((habit) => ({
      name: habit.name,
      count: state.completions.filter((item) => item.habitId === habit.id && days.includes(item.date)).length,
      of: days.length,
      streak: habitStreaks(state, habit, today).current,
    }));

  return {
    range: formatWeekRange(startOfWeek(today)),
    days,
    done,
    planned,
    focusMinutes: focus.totalMinutes,
    sessions: focus.sessions,
    finished,
    open,
    habits,
  };
}

/** Hours and minutes as one number of hours, for a report that is read once. */
function hours(minutes: number): string {
  return String(Math.round(minutes / 6) / 10);
}

/** The same time as words, for the printed page. */
function focusLabel(minutes: number): string {
  if (minutes < 60) return t('{0} min', { 0: minutes });
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t('{0} h {1} min', { 0: whole, 1: rest }) : t('{0} h', { 0: whole });
}

/** The week as markdown, for pasting into a note or a message. */
export function weeklyReportMarkdown(report: WeeklyReport): string {
  const lines = [`# ${t('Week of {0}', { 0: report.range })}`, ''];
  lines.push(
    report.planned
      ? t('**Completed:** {0} of {1} planned items ({2})', {
          0: report.done,
          1: report.planned,
          2: formatPercent(report.done / report.planned),
        })
      : t('**Completed:** {0} of {1} planned items', { 0: report.done, 1: report.planned }),
  );
  if (report.focusMinutes)
    lines.push(
      tn(report.sessions, '**Focus:** {0} h across {count} session', '**Focus:** {0} h across {count} sessions', {
        0: hours(report.focusMinutes),
      }),
    );
  if (report.finished.length) {
    lines.push('', `## ${t('Finished')}`);
    for (const title of report.finished) lines.push(t('- [x] {0}', { 0: title }));
  }
  if (report.open.length) {
    lines.push('', `## ${t('Still open')}`);
    for (const item of report.open) lines.push(t('- [ ] {0} (due {1})', { 0: item.title, 1: item.due }));
  }
  if (report.habits.length) {
    lines.push('', `## ${t('Habits')}`);
    for (const habit of report.habits) {
      lines.push(
        habit.streak >= 2
          ? t('- {0}: {1}/{2} days · {3}-day streak', { 0: habit.name, 1: habit.count, 2: habit.of, 3: habit.streak })
          : t('- {0}: {1}/{2} days', { 0: habit.name, 1: habit.count, 2: habit.of }),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The week as markdown. The shape it has always had, kept for everywhere it is already used. */
export function weeklyReport(state: PlannerState, today: string): string {
  return weeklyReportMarkdown(buildWeeklyReport(state, today));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function list(items: string[]): string {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

/**
 * The week as a page of its own, sized for paper.
 *
 * This is a whole document rather than a fragment: it is opened in a window of
 * its own so that printing it cannot drag the app's own layout, colours and
 * navigation onto the page. Everything that comes out of the planner goes
 * through `escapeHtml` — a task title is text a person typed, and it must never
 * be able to change the shape of the page.
 */
export function weeklyReportHtml(
  report: WeeklyReport,
  options: { madeOn: string; dir?: string; lang?: string; note?: string },
): string {
  const dir = options.dir === 'rtl' ? 'rtl' : 'ltr';
  const madeOn = formatFullDate(options.madeOn);

  const finished = report.finished.length
    ? `<ul>${list(report.finished)}</ul>`
    : `<p class="empty">${escapeHtml(t('Nothing was completed this week.'))}</p>`;

  const open = report.open.length
    ? `<ul>${report.open
        .map((item) => `<li>${escapeHtml(item.title)} <span class="quiet">${escapeHtml(t('due {0}', { 0: item.due }))}</span></li>`)
        .join('')}</ul>`
    : `<p class="empty">${escapeHtml(t('Nothing left open. Everything planned for this week is done.'))}</p>`;

  const habits = report.habits.length
    ? `<ul>${report.habits
        .map((habit) => {
          const counts =
            habit.streak >= 2
              ? t('{0}/{1} days · {2}-day streak', { 0: habit.count, 1: habit.of, 2: habit.streak })
              : t('{0}/{1} days', { 0: habit.count, 1: habit.of });
          return `<li>${escapeHtml(habit.name)} <span class="quiet">${escapeHtml(counts)}</span></li>`;
        })
        .join('')}</ul>`
    : `<p class="empty">${escapeHtml(t('No habits are being tracked yet.'))}</p>`;

  // A reflection is written while looking back at the week, so it belongs on
  // the page that comes out of it — otherwise what someone wrote is gone the
  // moment they close the screen.
  const note = options.note?.trim();
  const reflection = note
    ? `  <section>
    <h2>${escapeHtml(t('Reflection'))}</h2>
    <p class="note">${escapeHtml(note)}</p>
  </section>`
    : '';

  const title = escapeHtml(t('Week of {0}', { 0: report.range }));
  const checkIns = report.habits.reduce((sum, habit) => sum + habit.count, 0);

  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? 'en')}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  @page { margin: 16mm; }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #fff; color: #14161a;
         font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 680px; margin: 0 auto; }
  .kicker { margin: 0 0 6px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #8a8f98; }
  h1 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -0.01em; }
  .made { margin: 6px 0 0; font-size: 12.5px; color: #7c828c; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0 4px; }
  .stat { flex: 1 1 150px; padding: 12px 14px; border: 1px solid #e3e5e9; border-radius: 10px; break-inside: avoid; }
  .stat b { display: block; font-size: 21px; font-weight: 650; line-height: 1.2; }
  .stat span { font-size: 12px; color: #6d737d; }
  h2 { margin: 26px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #eceef1;
       font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #5c626c; }
  ul { margin: 0; padding-inline-start: 18px; }
  li { margin: 3px 0; }
  .quiet { color: #7c828c; font-size: 13px; }
  .empty { margin: 0; color: #8a8f98; font-size: 13.5px; }
  .note { margin: 0; white-space: pre-wrap; }
  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #eceef1; font-size: 11px; color: #9aa0a9; }
  ul, li, .stat, section { break-inside: avoid; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<main>
  <header>
    <p class="kicker">${escapeHtml(t('Weekly report'))}</p>
    <h1>${title}</h1>
    <p class="made">${escapeHtml(t('Made on {0}', { 0: madeOn }))}</p>
  </header>

  <section class="stats">
    <div class="stat">
      <b>${escapeHtml(report.planned ? `${report.done} / ${report.planned}` : '—')}</b>
      <span>${escapeHtml(
        report.planned
          ? t('{0} · planned items done', { 0: formatPercent(report.done / report.planned) })
          : t('planned items done'),
      )}</span>
    </div>
    <div class="stat">
      <b>${escapeHtml(report.focusMinutes ? focusLabel(report.focusMinutes) : '—')}</b>
      <span>${escapeHtml(tn(report.sessions, 'focused across {count} session', 'focused across {count} sessions'))}</span>
    </div>
    <div class="stat">
      <b>${escapeHtml(String(checkIns))}</b>
      <span>${escapeHtml(t('habit check-ins'))}</span>
    </div>
  </section>

  <section>
    <h2>${escapeHtml(t('Finished'))}</h2>
    ${finished}
  </section>

  <section>
    <h2>${escapeHtml(t('Still open'))}</h2>
    ${open}
  </section>

  <section>
    <h2>${escapeHtml(t('Habits'))}</h2>
    ${habits}
  </section>

${reflection}

  <footer>${escapeHtml(t('Kept on this device. Printed from Planner.'))}</footer>
</main>
</body>
</html>`;
}
