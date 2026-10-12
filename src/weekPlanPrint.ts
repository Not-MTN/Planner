/**
 * A week plan as a page of its own, sized for paper.
 *
 * Both sides print the same page: the guardian pins it to the fridge, the
 * student checks days off by hand when the screen is elsewhere. Open days
 * print as empty circles on purpose — the page is a checklist, not a verdict.
 * Mirrors `advisingHtml`: one self-contained document, inline styles, nothing
 * that needs the app to read it.
 */
import { displayTime, formatFullDate, formatMonthShort, formatWeekdayShort } from './dates';
import { faNum, t } from './i18n';
import type { DayReport, GuardianPlan, PlanItem, ReportAck } from './types';
import { ackFor, datelessItems, isRestDay, itemsForDay, planWeekDays, reportFor, timetableModel } from './weekPlans';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function lessonRows(items: PlanItem[], showTime: boolean): string {
  return items
    .map(
      (item) =>
        `<tr><td class="tick">${item.done ? '✓' : '○'}</td>` +
        (showTime ? `<td class="time">${item.time ? escapeHtml(item.time) : ''}</td>` : '') +
        `<td>${escapeHtml(item.title)}</td></tr>`,
    )
    .join('');
}

function lessonTable(items: PlanItem[]): string {
  const showTime = items.some((item) => item.time);
  return `<table>
    <thead><tr><th scope="col" class="tick">✓</th>${
      showTime ? `<th scope="col">${escapeHtml(t('Time'))}</th>` : ''
    }<th scope="col">${escapeHtml(t('Lesson name'))}</th></tr></thead>
    <tbody>${lessonRows(items, showTime)}</tbody>
  </table>`;
}

/**
 * The week as paper. `madeOn` is also the line between days that can already
 * be missing a report and days that cannot — the caller passes today. The
 * header names the other side of the link: the student for a guardian's copy,
 * the guardian for a student's.
 */
export function weekPlanHtml(
  plan: GuardianPlan,
  reports: DayReport[],
  acks: ReportAck[],
  options: { student: string; madeOn: string; dir?: string; lang?: string; side?: 'guardian' | 'student' },
): string {
  const dir = options.dir === 'rtl' ? 'rtl' : 'ltr';
  const days = planWeekDays(plan);
  const range = days.length === 7 ? `${formatFullDate(days[0] as string)} – ${formatFullDate(days[6] as string)}` : '';

  const daySections = days
    .map((date) => {
      const lessons = itemsForDay(plan, date);
      const report = reportFor(reports, plan.id, date);
      const finished = date < options.madeOn;
      const ack = report ? ackFor(acks, report.id) : undefined;
      const reportLine =
        lessons.length === 0
          ? ''
          : report
            ? `<p class="report"><span class="yes">✓ ${escapeHtml(report.repair ? t('Streak kept') : t('Reported'))}</span>${
                report.note ? `<span class="report-note"> — ${escapeHtml(report.note)}</span>` : ''
              }</p>${
                ack
                  ? `<p class="report"><span class="yes">✓ ${escapeHtml(t('Seen'))}</span>${
                      ack.text ? `<span class="report-note"> — ${escapeHtml(ack.text)}</span>` : ''
                    }${ack.reactions.length > 0 ? ` ${ack.reactions.join('')}` : ''}</p>`
                  : ''
              }`
            : isRestDay(plan, date)
              ? `<p class="report"><span class="rest">— ${escapeHtml(t('Rest day'))}</span></p>`
              : finished
                ? `<p class="report"><span class="no">○ ${escapeHtml(t('Missing'))}</span></p>`
                : '';
      return `<section>
    <h2>${escapeHtml(formatFullDate(date))}</h2>
    ${lessons.length > 0 ? lessonTable(lessons) : `<p class="empty">${escapeHtml(t('No lessons planned.'))}</p>`}
    ${reportLine}
  </section>`;
    })
    .join('\n\n');

  const floating = datelessItems(plan);
  const floatingSection =
    floating.length > 0
      ? `<section>
    <h2>${escapeHtml(t('Any day'))}</h2>
    ${lessonTable(floating)}
  </section>`
      : '';

  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? 'en')}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(plan.title)}</title>
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
  .plan-note { margin: 14px 0 0; font-size: 13.5px; color: #3c414b; white-space: pre-wrap; }
  h2 { margin: 26px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #eceef1;
       font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #5c626c; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: start; padding: 5px 8px 5px 0; border-bottom: 1px solid #f1f2f4; vertical-align: top; }
  thead th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6d737d; }
  .tick { width: 2em; }
  td.time { white-space: nowrap; color: #5c626c; }
  .empty { margin: 0; color: #8a8f98; font-size: 13.5px; }
  .report { margin: 8px 0 0; font-size: 13.5px; }
  .report .yes { color: #1c7c3e; font-weight: 650; }
  .report .no { color: #b3541e; font-weight: 650; }
  .report .rest { color: #6d737d; font-weight: 650; }
  .report-note { color: #3c414b; }
  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #eceef1; font-size: 11px; color: #9aa0a9; }
  table, section { break-inside: avoid; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<main>
  <header>
    <p class="kicker">${escapeHtml(t('Week plan'))}</p>
    <h1>${escapeHtml(plan.title)}</h1>
    <p class="made">${escapeHtml(options.side === 'student' ? t('From {0}', { 0: options.student }) : t('Plan for {0}', { 0: options.student }))}${range ? ` · ${escapeHtml(range)}` : ''}</p>
    <p class="made">${escapeHtml(t('Made on {0}', { 0: formatFullDate(options.madeOn) }))}</p>
    ${plan.note ? `<p class="plan-note">${escapeHtml(plan.note)}</p>` : ''}
  </header>

${daySections}
${floatingSection}
</main>
</body>
</html>`;
}

/**
 * The week as a wall timetable: days across, times down. The same data as the
 * day-by-day page, rearranged for pinning — a glanceable grid where the other
 * page is a readable story.
 */
export function timetableHtml(
  plan: GuardianPlan,
  reports: DayReport[],
  options: { student: string; madeOn: string; dir?: string; lang?: string; side?: 'guardian' | 'student' },
): string {
  const dir = options.dir === 'rtl' ? 'rtl' : 'ltr';
  const grid = timetableModel(plan, reports);
  const days = planWeekDays(plan);
  const range = days.length === 7 ? `${formatFullDate(days[0] as string)} – ${formatFullDate(days[6] as string)}` : '';

  const head = grid.days
    .map((date) => {
      const mark = grid.reported(date) ? '✓' : grid.rest(date) ? t('Rest day') : '';
      return `<th scope="col"><span class="tt-day">${escapeHtml(formatWeekdayShort(date))}</span><span class="tt-date">${escapeHtml(
        `${faNum(Number(date.slice(8, 10)))} ${formatMonthShort(date)}`,
      )}</span>${mark ? `<span class="tt-mark">${escapeHtml(mark)}</span>` : ''}</th>`;
    })
    .join('');

  const cell = (lessons: PlanItem[]) =>
    lessons.map((lesson) => `${lesson.done ? '✓ ' : ''}${escapeHtml(lesson.title)}`).join('<br>');

  const rows = grid.times
    .map(
      (time) =>
        `<tr><th scope="row">${escapeHtml(displayTime(time))}</th>${grid.days
          .map((date) => `<td>${cell(grid.lessonsFor(date, time))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const untimedRow = grid.days.some((date) => grid.lessonsFor(date, null).length > 0)
    ? `<tr><th scope="row">${escapeHtml(t('Any time'))}</th>${grid.days
        .map((date) => `<td>${cell(grid.lessonsFor(date, null))}</td>`)
        .join('')}</tr>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? 'en')}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(plan.title)}</title>
<style>
  @page { margin: 14mm; }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #fff; color: #14161a;
         font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 860px; margin: 0 auto; }
  .kicker { margin: 0 0 6px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #8a8f98; }
  h1 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -0.01em; }
  .made { margin: 6px 0 0; font-size: 12.5px; color: #7c828c; }
  .plan-note { margin: 14px 0 0; font-size: 13.5px; color: #3c414b; white-space: pre-wrap; }
  table.tt { width: 100%; margin-top: 18px; border-collapse: collapse; table-layout: fixed; font-size: 12.5px; }
  .tt th, .tt td { border: 1px solid #e3e6ea; padding: 6px 7px; vertical-align: top; text-align: start; overflow-wrap: anywhere; }
  .tt thead th { background: #f6f7f9; font-size: 11px; }
  .tt tbody th { background: #fafbfc; white-space: nowrap; font-variant-numeric: tabular-nums; color: #5c626c; }
  .tt-day { display: block; font-size: 12px; color: #14161a; }
  .tt-date { display: block; font-weight: 400; color: #6d737d; font-variant-numeric: tabular-nums; }
  .tt-mark { display: block; font-weight: 650; color: #1c7c3e; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<main>
  <header>
    <p class="kicker">${escapeHtml(t('Timetable'))}</p>
    <h1>${escapeHtml(plan.title)}</h1>
    <p class="made">${escapeHtml(options.side === 'student' ? t('From {0}', { 0: options.student }) : t('Plan for {0}', { 0: options.student }))}${range ? ` · ${escapeHtml(range)}` : ''}</p>
    <p class="made">${escapeHtml(t('Made on {0}', { 0: formatFullDate(options.madeOn) }))}</p>
    ${plan.note ? `<p class="plan-note">${escapeHtml(plan.note)}</p>` : ''}
  </header>

  <table class="tt">
    <thead><tr><th scope="col"></th>${head}</tr></thead>
    <tbody>${rows}${untimedRow}</tbody>
  </table>
</main>
</body>
</html>`;
}
