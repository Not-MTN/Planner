/**
 * A week plan as a page of its own, sized for paper.
 *
 * Both sides print the same page: the guardian pins it to the fridge, the
 * student checks days off by hand when the screen is elsewhere. Open days
 * print as empty circles on purpose — the page is a checklist, not a verdict.
 * Mirrors `advisingHtml`: one self-contained document, inline styles, nothing
 * that needs the app to read it.
 */
import { displayTime, formatFullDate, formatJalaliLong, formatJalaliShort, formatMonthShort, formatWeekdayShort } from './dates';
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

const PRINT_FONTS = `@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600;700&display=swap');`;

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
  const jalaliRange = days.length === 7 ? (() => {
    const start = formatJalaliLong(days[0] as string);
    const end = formatJalaliLong(days[6] as string);
    return start && end ? `${start} – ${end}` : start ?? end ?? '';
  })() : '';

  const daySections = days
    .map((date) => {
      const lessons = itemsForDay(plan, date);
      const report = reportFor(reports, plan.id, date);
      const finished = date < options.madeOn;
      const ack = report ? ackFor(acks, report.id) : undefined;
      const jalali = formatJalaliLong(date);
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
    <div class="day-head">
      <h2>${escapeHtml(formatFullDate(date))}${jalali ? `<span class="jalali" dir="rtl">${escapeHtml(jalali)}</span>` : ''}</h2>
    </div>
    ${lessons.length > 0 ? lessonTable(lessons) : `<p class="empty">${escapeHtml(t('No lessons planned.'))}</p>`}
    ${reportLine}
  </section>`;
    })
    .join('\n\n');

  const floating = datelessItems(plan);
  const floatingSection =
    floating.length > 0
      ? `<section>
    <div class="day-head"><h2>${escapeHtml(t('Any day'))}</h2></div>
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
  ${PRINT_FONTS}
  @page { margin: 14mm 15mm; }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #fdfcff; color: #1e293b;
         font: 14.5px/1.65 'Inter','Vazirmatn', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main { max-width: 740px; margin: 0 auto; padding: 28px 22px; background: #fff; border-radius: 18px; }
  @media print { body { background: #fff; } main { padding: 0; border-radius: 0; } }
  .ornament { text-align: center; font-size: 10px; letter-spacing: .45em; color: #7c5cf0; margin: 0 0 14px; opacity: .85; }
  .ornament span { display: inline-block; width: 38px; height: 1px; background: linear-gradient(90deg, transparent, #c4b5fd, transparent); vertical-align: middle; margin: 0 8px; }
  .kicker { margin: 0; text-align: center; font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; color: #7c5cf0; font-weight: 700; }
  h1 { margin: 8px 0 0; text-align: center; font-family: 'Playfair Display','Vazirmatn', Georgia, serif; font-size: 30px; font-weight: 800; letter-spacing: -0.02em; color: #1a1040; line-height: 1.15; }
  .made { margin: 8px 0 0; text-align: center; font-size: 12.5px; color: #64748b; line-height: 1.5; }
  .made .sep { color: #c4b5fd; margin: 0 6px; }
  .made-jalali { margin: 4px 0 0; text-align: center; font-family: 'Vazirmatn','Inter', sans-serif; font-size: 12.5px; color: #7c5cf0; font-weight: 600; letter-spacing: .01em; }
  .plan-note { margin: 18px auto 0; max-width: 620px; text-align: center; font-size: 13.5px; color: #334155; background: linear-gradient(135deg, #f8f5ff 0%, #fefce8 100%); border: 1px solid #ede9ff; border-radius: 14px; padding: 14px 18px; white-space: pre-wrap; line-height: 1.6; }
  .plan-note::before { content: "✦"; display: block; text-align: center; color: #f59e0b; font-size: 10px; letter-spacing: .3em; margin-bottom: 6px; }
  section { margin: 20px 0 0; padding: 16px 18px 14px; background: #fff; border: 1px solid #ede9ff; border-left: 4px solid #7c5cf0; border-radius: 14px; box-shadow: 0 1px 6px rgba(124,92,240,.07), 0 4px 16px rgba(124,92,240,.04); break-inside: avoid; page-break-inside: avoid; }
  :dir(rtl) section { border-left: 1px solid #ede9ff; border-right: 4px solid #7c5cf0; }
  .day-head h2 { margin: 0 0 10px; padding: 0 0 8px; border-bottom: 1px dashed #e9e5ff; font-family: 'Inter','Vazirmatn', sans-serif; font-size: 13.5px; font-weight: 700; letter-spacing: -0.01em; color: #1e293b; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
  .day-head .jalali { font-family: 'Vazirmatn','Inter', sans-serif; font-size: 12.5px; font-weight: 600; color: #7c5cf0; background: #f5f3ff; border: 1px solid #ede9ff; border-radius: 999px; padding: 2px 10px; letter-spacing: 0; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13.5px; overflow: hidden; border-radius: 10px; border: 1px solid #ede9ff; }
  thead th { background: #f8f5ff; font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: #6d28d9; font-weight: 700; padding: 8px 10px 8px 0; border-bottom: 1px solid #ede9ff; }
  thead th:first-child { padding-left: 10px; }
  th, td { text-align: start; padding: 7px 10px 7px 0; border-bottom: 1px solid #f3f0ff; vertical-align: top; }
  td:first-child, th:first-child { padding-left: 10px; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:nth-child(even) td { background: #fcfbff; }
  .tick { width: 2.2em; text-align: center; font-weight: 700; color: #7c5cf0; }
  td.time { white-space: nowrap; color: #64748b; font-variant-numeric: tabular-nums; font-weight: 600; background: #f8fafc; border-radius: 6px; }
  .empty { margin: 0; color: #94a3b8; font-size: 13.5px; font-style: italic; text-align: center; padding: 8px; background: #f8fafc; border-radius: 10px; border: 1px dashed #e2e8f0; }
  .report { margin: 10px 0 0; font-size: 13.5px; padding: 8px 12px; border-radius: 10px; }
  .report .yes { color: #15803d; font-weight: 700; }
  .report .no { color: #c2410c; font-weight: 700; }
  .report .rest { color: #7c5cf0; font-weight: 700; }
  .report-note { color: #334155; }
  p.report:has(.yes) { background: #f0fdf4; border: 1px solid #dcfce7; }
  p.report:has(.no) { background: #fff7ed; border: 1px solid #ffedd5; }
  p.report:has(.rest) { background: #f5f3ff; border: 1px solid #ede9ff; }
  footer { margin-top: 28px; text-align: center; font-size: 10.5px; color: #94a3b8; letter-spacing: .04em; }
  footer::before { content: "─ ✦ ─"; display: block; color: #c4b5fd; letter-spacing: .4em; margin-bottom: 10px; font-size: 9px; }
  @media print { section { box-shadow: none; } }
</style>
</head>
<body>
<main>
  <header>
    <p class="ornament"><span></span>✦<span></span></p>
    <p class="kicker">${escapeHtml(t('Week plan'))}</p>
    <h1>${escapeHtml(plan.title)}</h1>
    <p class="made">${escapeHtml(options.side === 'student' ? t('From {0}', { 0: options.student }) : t('Plan for {0}', { 0: options.student }))}${range ? `<span class="sep">·</span>${escapeHtml(range)}` : ''}</p>
    ${jalaliRange ? `<p class="made-jalali" dir="rtl">${escapeHtml(jalaliRange)}</p>` : ''}
    <p class="made">${escapeHtml(t('Made on {0}', { 0: formatFullDate(options.madeOn) }))}${(() => { const j = formatJalaliLong(options.madeOn); return j ? ` <span dir="rtl">· ${escapeHtml(j)}</span>` : ''; })()}</p>
    ${plan.note ? `<p class="plan-note">${escapeHtml(plan.note)}</p>` : ''}
  </header>

${daySections}
${floatingSection}
  <footer>${escapeHtml(t('Week plan'))} · ${escapeHtml(plan.title)} · ${escapeHtml(range)}</footer>
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
  const jalaliRange = days.length === 7 ? (() => {
    const start = formatJalaliLong(days[0] as string);
    const end = formatJalaliLong(days[6] as string);
    return start && end ? `${start} – ${end}` : start ?? end ?? '';
  })() : '';

  const head = grid.days
    .map((date) => {
      const mark = grid.reported(date) ? '✓' : grid.rest(date) ? t('Rest day') : '';
      const jalali = formatJalaliShort(date);
      return `<th scope="col"><span class="tt-day">${escapeHtml(formatWeekdayShort(date))}</span><span class="tt-date">${escapeHtml(
        `${faNum(Number(date.slice(8, 10)))} ${formatMonthShort(date)}`,
      )}</span>${jalali ? `<span class="tt-jalali" dir="rtl">${escapeHtml(jalali)}</span>` : ''}${mark ? `<span class="tt-mark">${escapeHtml(mark)}</span>` : ''}</th>`;
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
  ${PRINT_FONTS}
  @page { margin: 12mm 14mm; }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #fdfcff; color: #1e293b;
         font: 14px/1.6 'Inter','Vazirmatn', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main { max-width: 900px; margin: 0 auto; padding: 28px 20px; background: #fff; border-radius: 18px; }
  @media print { body { background: #fff; } main { padding: 0; border-radius: 0; } }
  .ornament { text-align: center; font-size: 10px; letter-spacing: .45em; color: #7c5cf0; margin: 0 0 12px; }
  .ornament span { display: inline-block; width: 36px; height: 1px; background: linear-gradient(90deg, transparent, #c4b5fd, transparent); vertical-align: middle; margin: 0 8px; }
  .kicker { margin: 0; text-align: center; font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; color: #7c5cf0; font-weight: 700; }
  h1 { margin: 8px 0 0; text-align: center; font-family: 'Playfair Display','Vazirmatn', Georgia, serif; font-size: 28px; font-weight: 800; letter-spacing: -0.02em; color: #1a1040; line-height: 1.15; }
  .made { margin: 8px 0 0; text-align: center; font-size: 12.5px; color: #64748b; }
  .made .sep { color: #c4b5fd; margin: 0 6px; }
  .made-jalali { margin: 4px 0 0; text-align: center; font-family: 'Vazirmatn','Inter', sans-serif; font-size: 12.5px; color: #7c5cf0; font-weight: 600; }
  .plan-note { margin: 18px auto 0; max-width: 620px; text-align: center; font-size: 13.5px; color: #334155; background: linear-gradient(135deg, #f8f5ff 0%, #fefce8 100%); border: 1px solid #ede9ff; border-radius: 14px; padding: 12px 16px; white-space: pre-wrap; }
  table.tt { width: 100%; margin-top: 20px; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 12.5px; border: 1px solid #ede9ff; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 6px rgba(124,92,240,.07); }
  .tt th, .tt td { border: 1px solid #ede9ff; padding: 7px 8px; vertical-align: top; text-align: start; overflow-wrap: anywhere; }
  .tt thead th { background: linear-gradient(180deg, #f8f5ff 0%, #f5f3ff 100%); font-size: 11px; color: #4c1d95; }
  .tt tbody th { background: #f8fafc; white-space: nowrap; font-variant-numeric: tabular-nums; color: #475569; font-weight: 600; }
  .tt-day { display: block; font-size: 12px; font-weight: 700; color: #1e293b; }
  .tt-date { display: block; font-weight: 500; color: #64748b; font-variant-numeric: tabular-nums; font-size: 11.5px; }
  .tt-jalali { display: block; font-family: 'Vazirmatn','Inter', sans-serif; font-size: 10.5px; color: #7c5cf0; font-weight: 600; margin-top: 2px; background: #f5f3ff; border-radius: 999px; padding: 1px 6px; text-align: center; }
  .tt-mark { display: block; font-weight: 700; color: #15803d; font-size: 10px; margin-top: 4px; background: #f0fdf4; border-radius: 999px; padding: 1px 6px; text-align: center; }
  @media print { table.tt { box-shadow: none; } }
  footer { margin-top: 22px; text-align: center; font-size: 10.5px; color: #94a3b8; }
  footer::before { content: "─ ✦ ─"; display: block; color: #c4b5fd; letter-spacing: .4em; margin-bottom: 8px; font-size: 9px; }
</style>
</head>
<body>
<main>
  <header>
    <p class="ornament"><span></span>✦<span></span></p>
    <p class="kicker">${escapeHtml(t('Timetable'))}</p>
    <h1>${escapeHtml(plan.title)}</h1>
    <p class="made">${escapeHtml(options.side === 'student' ? t('From {0}', { 0: options.student }) : t('Plan for {0}', { 0: options.student }))}${range ? `<span class="sep">·</span>${escapeHtml(range)}` : ''}</p>
    ${jalaliRange ? `<p class="made-jalali" dir="rtl">${escapeHtml(jalaliRange)}</p>` : ''}
    <p class="made">${escapeHtml(t('Made on {0}', { 0: formatFullDate(options.madeOn) }))}${(() => { const j = formatJalaliLong(options.madeOn); return j ? ` <span dir="rtl">· ${escapeHtml(j)}</span>` : ''; })()}</p>
    ${plan.note ? `<p class="plan-note">${escapeHtml(plan.note)}</p>` : ''}
  </header>

  <table class="tt">
    <thead><tr><th scope="col"></th>${head}</tr></thead>
    <tbody>${rows}${untimedRow}</tbody>
  </table>
  <footer>${escapeHtml(t('Timetable'))} · ${escapeHtml(plan.title)} · ${escapeHtml(range)}</footer>
</main>
</body>
</html>`;
}
