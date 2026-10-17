/**
 * A week plan as a page of its own, sized for paper.
 *
 * Both sides print the same page: the guardian pins it to the fridge, the
 * student checks days off by hand when the screen is elsewhere. Open days
 * print as empty circles on purpose — the page is a checklist, not a verdict.
 * Mirrors `advisingHtml`: one self-contained document, inline styles, nothing
 * that needs the app to read it.
 *
 * Two pages come out of here. The week page reads top to bottom, day by day,
 * with the times, the reports and the answers where they belong; the timetable
 * is the same week as a grid, for a wall. Both are previewed inside the app
 * before they are printed, so what is on the screen is what comes out.
 */
import { displayTime, formatFullDate, formatJalaliLong, formatJalaliShort, formatMonthShort, formatWeekdayShort, isValidTime } from './dates';
import { faNum, t } from './i18n';
import type { DayReport, GuardianPlan, PlanItem, ReportAck } from './types';
import {
  ackFor,
  datelessItems,
  isRestDay,
  itemsForDay,
  lessonDurationLabel,
  lessonSpanMinutes,
  planWeekDays,
  reportFor,
  timetableModel,
  weekReview,
} from './weekPlans';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * When a lesson runs, as one cell of the page: the span when there is one, the
 * start alone when there is not, and nothing for a lesson that fits anywhere.
 */
function timeCell(item: PlanItem): string {
  if (!item.time || !isValidTime(item.time)) return '';
  const start = displayTime(item.time);
  const end = item.end && isValidTime(item.end) && item.end > item.time ? displayTime(item.end) : '';
  const span = end ? `${escapeHtml(start)} – ${escapeHtml(end)}` : escapeHtml(start);
  const duration = lessonDurationLabel(item);
  return `${span}${duration ? `<span class="dur">${escapeHtml(duration)}</span>` : ''}`;
}

function lessonRows(items: PlanItem[], showTime: boolean): string {
  return items
    .map((item) => {
      const link = item.url
        ? `<span class="prep"><span class="prep-key">${escapeHtml(t('Prep'))}</span>${escapeHtml(item.url)}</span>`
        : '';
      const meta = [item.subject && item.subject !== item.title ? item.subject : '', item.minutes ? `${item.minutes}′` : '']
        .filter(Boolean)
        .join(' · ');
      return (
        `<tr${item.done ? ' class="is-done"' : ''}><td class="tick">${item.done ? '✓' : '○'}</td>` +
        (showTime ? `<td class="time">${timeCell(item)}</td>` : '') +
        `<td class="lesson"><span class="lesson-title">${escapeHtml(item.title)}</span>` +
        `${meta ? `<span class="lesson-meta">${escapeHtml(meta)}</span>` : ''}${link}</td></tr>`
      );
    })
    .join('');
}

function lessonTable(items: PlanItem[]): string {
  const showTime = items.some((item) => item.time);
  return `<table>
    <thead><tr><th scope="col" class="tick"></th>${
      showTime ? `<th scope="col" class="time">${escapeHtml(t('Time'))}</th>` : ''
    }<th scope="col">${escapeHtml(t('Lesson name'))}</th></tr></thead>
    <tbody>${lessonRows(items, showTime)}</tbody>
  </table>`;
}

/** The week at a glance: four numbers that fit in the header of either page. */
function summaryStrip(plan: GuardianPlan, reports: DayReport[], madeOn: string): string {
  const days = planWeekDays(plan);
  const lessonDays = days.filter((date) => itemsForDay(plan, date).length > 0 && !isRestDay(plan, date));
  const review = weekReview(plan, reports, madeOn);
  // How long the week is planned for: a lesson that says "9 to 11" is two hours
  // whether or not anyone typed an estimate, and the estimate is what is left
  // for a lesson with no time of its own. Worded the way the planner words time
  // everywhere else, so the page reads in the reader's language.
  const minutes = plan.items.reduce((sum, item) => sum + (lessonSpanMinutes(item) ?? item.minutes ?? 0), 0);
  const hours = Math.floor(minutes / 60);
  const planned =
    minutes <= 0
      ? '—'
      : hours === 0
        ? t('{0} min', { 0: minutes })
        : minutes % 60 === 0
          ? t('{0} h', { 0: hours })
          : t('{0} h {1} min', { 0: hours, 1: minutes % 60 });
  const tile = (value: string | number, label: string) =>
    `<div class="stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
  return `<div class="stats">
    ${tile(faNum(plan.items.length), t('Lessons'))}
    ${tile(faNum(lessonDays.length), t('Planned days'))}
    ${tile(planned, t('Planned time'))}
    ${tile(`${faNum(review.reported)}/${faNum(review.lessonDays)}`, t('Days reported'))}
  </div>`;
}

const PRINT_FONTS = `@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600;700&display=swap');`;

/** Styles both pages share: the paper, the colours, the fonts. */
const PRINT_SHELL = `
  @page { margin: 13mm 14mm; }
  :root { color-scheme: light; --violet: #7c5cf0; --violet-deep: #4c1d95; --ink: #1a1040; --body: #1e293b;
          --muted: #64748b; --line: #ede9ff; --wash: #f8f5ff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: #f6f4fb; color: var(--body);
         font: 14.5px/1.65 'Inter','Vazirmatn', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main { max-width: 760px; margin: 0 auto; padding: 34px 30px 26px; background: #fff;
         border-radius: 20px; box-shadow: 0 18px 50px rgba(76,29,149,.10); }
  header { text-align: center; }
  .ornament { margin: 0 0 14px; font-size: 10px; letter-spacing: .45em; color: var(--violet); opacity: .9; }
  .ornament span { display: inline-block; width: 42px; height: 1px; vertical-align: middle; margin: 0 10px;
                   background: linear-gradient(90deg, transparent, #c4b5fd, transparent); }
  .kicker { margin: 0; font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: var(--violet); font-weight: 700; }
  h1 { margin: 8px 0 0; font-family: 'Playfair Display','Vazirmatn', Georgia, serif; font-size: 31px; font-weight: 800;
       letter-spacing: -.02em; color: var(--ink); line-height: 1.14; }
  .made { margin: 9px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.55; }
  .made .sep { color: #c4b5fd; margin: 0 7px; }
  .made-jalali { margin: 5px 0 0; font-family: 'Vazirmatn','Inter', sans-serif; font-size: 12.5px; color: var(--violet); font-weight: 600; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 18px 0 0; }
  .stat { flex: 1 1 120px; min-width: 108px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 13px;
          background: linear-gradient(160deg, #fff 0%, var(--wash) 130%); text-align: center; }
  .stat strong { display: block; font-size: 17px; font-weight: 700; color: var(--violet-deep); letter-spacing: -.01em;
                 font-variant-numeric: tabular-nums; }
  .stat span { display: block; margin-top: 2px; font-size: 9.5px; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .plan-note { margin: 18px auto 0; max-width: 640px; font-size: 13.5px; color: #334155; line-height: 1.6;
               background: linear-gradient(135deg, var(--wash) 0%, #fefce8 100%); border: 1px solid var(--line);
               border-radius: 15px; padding: 14px 18px; white-space: pre-wrap; text-align: center; }
  .plan-note::before { content: "✦"; display: block; color: #f59e0b; font-size: 10px; letter-spacing: .3em; margin-bottom: 6px; }
  section { margin: 16px 0 0; padding: 15px 17px 13px; background: #fff; border: 1px solid var(--line);
            border-radius: 15px; box-shadow: 0 1px 4px rgba(124,92,240,.06); break-inside: avoid; page-break-inside: avoid; }
  section.is-today { border-color: #ddd6fe; box-shadow: 0 0 0 3px #f5f3ff, 0 1px 4px rgba(124,92,240,.08); }
  section.is-past { background: #fdfcff; }
  .day-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin: 0 0 10px; padding: 0 0 9px;
              border-bottom: 1px dashed #e9e5ff; }
  .day-head h2 { margin: 0; font-family: 'Inter','Vazirmatn', sans-serif; font-size: 14px; font-weight: 700;
                 letter-spacing: -.01em; color: var(--body); }
  .day-head .jalali { font-family: 'Vazirmatn','Inter', sans-serif; font-size: 12px; font-weight: 600; color: var(--violet);
                      background: #f5f3ff; border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; }
  .day-head .flag { margin-inline-start: auto; font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
                    font-weight: 700; border-radius: 999px; padding: 3px 10px; }
  .flag.today { color: var(--violet-deep); background: #ede9fe; }
  .flag.reported { color: #166534; background: #dcfce7; }
  .flag.missing { color: #9a3412; background: #ffedd5; }
  .flag.rest { color: var(--violet); background: #f5f3ff; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13.5px; border: 1px solid var(--line);
          border-radius: 11px; overflow: hidden; }
  thead th { background: var(--wash); font-size: 9.5px; text-transform: uppercase; letter-spacing: .09em; color: #6d28d9;
             font-weight: 700; padding: 7px 10px; text-align: start; border-bottom: 1px solid var(--line); }
  th, td { padding: 8px 10px; text-align: start; vertical-align: top; border-bottom: 1px solid #f3f0ff; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:nth-child(even) td { background: #fcfbff; }
  tbody tr.is-done td { color: #64748b; }
  tbody tr.is-done .lesson-title { text-decoration: line-through; text-decoration-color: #c4b5fd; }
  .tick { width: 2.1em; text-align: center; font-weight: 700; color: var(--violet); }
  td.time { white-space: nowrap; color: #475569; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 12.5px; }
  td.time .dur { display: block; font-size: 10px; font-weight: 600; color: var(--violet); letter-spacing: .04em; }
  .lesson-title { display: block; font-weight: 600; color: var(--body); }
  .lesson-meta { display: block; font-size: 11.5px; color: var(--muted); }
  .prep { display: block; margin-top: 3px; font-size: 10.5px; color: #6d28d9; overflow-wrap: anywhere; }
  .prep-key { display: inline-block; margin-inline-end: 6px; padding: 0 6px; border: 1px solid var(--line);
              border-radius: 999px; background: var(--wash); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
  .empty { margin: 0; padding: 9px; color: #94a3b8; font-size: 13px; font-style: italic; text-align: center;
           background: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 11px; }
  .report { margin: 9px 0 0; padding: 8px 12px; font-size: 13px; border-radius: 11px; }
  .report .yes { color: #15803d; font-weight: 700; }
  .report .no { color: #c2410c; font-weight: 700; }
  .report .rest { color: var(--violet); font-weight: 700; }
  .report .reacts { margin-inline-start: 7px; font-size: 13px; letter-spacing: .1em; }
  .report-note { color: #334155; }
  p.report:has(.yes) { background: #f0fdf4; border: 1px solid #dcfce7; }
  p.report:has(.no) { background: #fff7ed; border: 1px solid #ffedd5; }
  p.report:has(.rest) { background: #f5f3ff; border: 1px solid var(--line); }
  footer { margin-top: 24px; text-align: center; font-size: 10px; color: #94a3b8; letter-spacing: .05em; }
  footer::before { content: "─ ✦ ─"; display: block; margin-bottom: 9px; color: #c4b5fd; font-size: 9px; letter-spacing: .4em; }
  @media print {
    body { background: #fff; }
    main { max-width: none; margin: 0; padding: 0; border-radius: 0; box-shadow: none; }
    section { box-shadow: none; }
    a { color: inherit; text-decoration: none; }
  }
`;

function headerBlock(
  plan: GuardianPlan,
  reports: DayReport[],
  options: { student: string; madeOn: string; side?: 'guardian' | 'student'; kicker: string },
): string {
  const days = planWeekDays(plan);
  const range = days.length === 7 ? `${formatFullDate(days[0] as string)} – ${formatFullDate(days[6] as string)}` : '';
  const jalaliRange = days.length === 7 ? (() => {
    const start = formatJalaliLong(days[0] as string);
    const end = formatJalaliLong(days[6] as string);
    return start && end ? `${start} – ${end}` : start ?? end ?? '';
  })() : '';
  const madeJalali = formatJalaliLong(options.madeOn);
  return `<header>
    <p class="ornament"><span></span>✦<span></span></p>
    <p class="kicker">${escapeHtml(options.kicker)}</p>
    <h1>${escapeHtml(plan.title)}</h1>
    <p class="made">${escapeHtml(options.side === 'student' ? t('From {0}', { 0: options.student }) : t('Plan for {0}', { 0: options.student }))}${range ? `<span class="sep">·</span>${escapeHtml(range)}` : ''}</p>
    ${jalaliRange ? `<p class="made-jalali" dir="rtl">${escapeHtml(jalaliRange)}</p>` : ''}
    <p class="made">${escapeHtml(t('Made on {0}', { 0: formatFullDate(options.madeOn) }))}${madeJalali ? ` <span dir="rtl">· ${escapeHtml(madeJalali)}</span>` : ''}</p>
    ${summaryStrip(plan, reports, options.madeOn)}
    ${plan.note ? `<p class="plan-note">${escapeHtml(plan.note)}</p>` : ''}
  </header>`;
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
      const rest = isRestDay(plan, date);
      const ack = report ? ackFor(acks, report.id) : undefined;
      const jalali = formatJalaliLong(date);
      // One verdict per day, and it has to agree with the line under the table:
      // a report that was filed outranks the rest mark, a rest day is never
      // "missing", and today says so when neither of those is true.
      const flag = report
        ? `<span class="flag reported">${escapeHtml(report.repair ? t('Streak kept') : t('Reported'))}</span>`
        : rest
          ? `<span class="flag rest">${escapeHtml(t('Rest day'))}</span>`
          : date === options.madeOn
            ? `<span class="flag today">${escapeHtml(t('Today'))}</span>`
            : finished && lessons.length > 0
              ? `<span class="flag missing">${escapeHtml(t('Missing'))}</span>`
              : '';
      // A day nobody reported says so in its header flag; repeating it under
      // the table would read as two different verdicts on the same day.
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
                    }${ack.reactions.length > 0 ? `<span class="reacts">${ack.reactions.join(' ')}</span>` : ''}${
                      ack.approvedAt ? ` · ${escapeHtml(t('Day approved'))}` : ''
                    }</p>`
                  : ''
              }`
            : rest
              ? `<p class="report"><span class="rest">— ${escapeHtml(t('Rest day'))}</span></p>`
              : '';
      const classes = ['is-day', date === options.madeOn ? 'is-today' : '', finished ? 'is-past' : '']
        .filter(Boolean)
        .join(' ');
      return `<section class="${classes}">
    <div class="day-head">
      <h2>${escapeHtml(formatFullDate(date))}</h2>
      ${jalali ? `<span class="jalali" dir="rtl">${escapeHtml(jalali)}</span>` : ''}
      ${flag}
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
<style>${PRINT_FONTS}${PRINT_SHELL}</style>
</head>
<body>
<main>
  ${headerBlock(plan, reports, { ...options, kicker: t('Week plan') })}

${daySections}
${floatingSection}
  <footer>${escapeHtml(t('Week plan'))} · ${escapeHtml(plan.title)}${range ? ` · ${escapeHtml(range)}` : ''}</footer>
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
      const jalali = formatJalaliShort(date);
      // The same wording the week page uses: a day filed as kept is not
      // reported, and the two pages are read side by side.
      const filed = reportFor(reports, plan.id, date);
      const mark = grid.reported(date)
        ? `<span class="tt-mark">${escapeHtml(filed?.repair ? t('Streak kept') : t('Reported'))}</span>`
        : grid.rest(date)
          ? `<span class="tt-mark rest">${escapeHtml(t('Rest day'))}</span>`
          : date === options.madeOn
            ? `<span class="tt-mark today">${escapeHtml(t('Today'))}</span>`
            : '';
      return `<th scope="col"${date === options.madeOn ? ' class="is-today"' : ''}><span class="tt-day">${escapeHtml(formatWeekdayShort(date))}</span><span class="tt-date">${escapeHtml(
        `${faNum(Number(date.slice(8, 10)))} ${formatMonthShort(date)}`,
      )}</span>${jalali ? `<span class="tt-jalali" dir="rtl">${escapeHtml(jalali)}</span>` : ''}${mark}</th>`;
    })
    .join('');

  const cell = (lessons: PlanItem[]) =>
    lessons
      .map((lesson) => {
        const duration = lessonDurationLabel(lesson);
        const end = lesson.end && isValidTime(lesson.end) && lesson.time && lesson.end > lesson.time ? displayTime(lesson.end) : '';
        return `<span class="tt-lesson${lesson.done ? ' is-done' : ''}">` +
          `${lesson.done ? '<span class="tt-tick">✓</span>' : ''}` +
          `<span class="tt-title">${escapeHtml(lesson.title)}</span>` +
          `${end ? `<span class="tt-span">– ${escapeHtml(end)}${duration ? ` · ${escapeHtml(duration)}` : ''}</span>` : ''}` +
          `</span>`;
      })
      .join('');

  const rows = grid.times
    .map(
      (time) =>
        `<tr><th scope="row">${escapeHtml(displayTime(time))}</th>${grid.days
          .map((date) => `<td${date === options.madeOn ? ' class="is-today"' : ''}>${cell(grid.lessonsFor(date, time))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const untimedRow = grid.days.some((date) => grid.lessonsFor(date, null).length > 0)
    ? `<tr><th scope="row">${escapeHtml(t('Any time'))}</th>${grid.days
        .map((date) => `<td${date === options.madeOn ? ' class="is-today"' : ''}>${cell(grid.lessonsFor(date, null))}</td>`)
        .join('')}</tr>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? 'en')}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(plan.title)}</title>
<style>${PRINT_FONTS}${PRINT_SHELL}
  main { max-width: 940px; }
  table.tt { width: 100%; margin-top: 18px; border-collapse: separate; border-spacing: 0; table-layout: fixed;
             font-size: 12px; border: 1px solid var(--line); border-radius: 15px; overflow: hidden; }
  .tt th, .tt td { border: 1px solid var(--line); padding: 7px 8px; vertical-align: top; text-align: start; overflow-wrap: anywhere; }
  .tt thead th { background: linear-gradient(180deg, #faf8ff 0%, #f4f1ff 100%); font-size: 11px; color: var(--violet-deep); }
  .tt thead th.is-today, .tt td.is-today { background: #fbfaff; box-shadow: inset 0 0 0 2px #ede9fe; }
  .tt tbody th { background: #f8fafc; white-space: nowrap; font-variant-numeric: tabular-nums; color: #475569; font-weight: 700; font-size: 12px; }
  .tt-day { display: block; font-size: 12px; font-weight: 700; color: var(--body); }
  .tt-date { display: block; font-size: 11px; font-weight: 500; color: var(--muted); font-variant-numeric: tabular-nums; }
  .tt-jalali { display: block; margin-top: 3px; padding: 1px 6px; font-family: 'Vazirmatn','Inter', sans-serif; font-size: 10px;
               font-weight: 600; color: var(--violet); background: #f5f3ff; border-radius: 999px; text-align: center; }
  .tt-mark { display: block; margin-top: 4px; padding: 1px 6px; font-size: 9px; letter-spacing: .06em; text-transform: uppercase;
             font-weight: 700; color: #166534; background: #dcfce7; border-radius: 999px; text-align: center; }
  .tt-mark.rest { color: var(--violet); background: #f5f3ff; }
  .tt-mark.today { color: var(--violet-deep); background: #ede9fe; }
  .tt-lesson { display: block; margin: 0 0 5px; padding: 5px 7px; background: #fff; border: 1px solid var(--line);
               border-inline-start: 3px solid var(--violet); border-radius: 9px; }
  .tt-lesson:last-child { margin-bottom: 0; }
  .tt-lesson.is-done { border-inline-start-color: #22c55e; background: #f7fef9; }
  .tt-lesson.is-done .tt-title { text-decoration: line-through; color: var(--muted); }
  .tt-tick { color: #16a34a; font-weight: 700; margin-inline-end: 4px; }
  .tt-title { display: block; font-weight: 600; color: var(--body); }
  .tt-span { display: block; font-size: 10.5px; color: var(--violet); font-variant-numeric: tabular-nums; }
  @media print { table.tt { box-shadow: none; } .tt-lesson { break-inside: avoid; } }
</style>
</head>
<body>
<main>
  ${headerBlock(plan, reports, { ...options, kicker: t('Timetable') })}

  <table class="tt">
    <thead><tr><th scope="col" class="tt-corner">${escapeHtml(t('Time'))}</th>${head}</tr></thead>
    <tbody>${rows}${untimedRow}</tbody>
  </table>
  <footer>${escapeHtml(t('Timetable'))} · ${escapeHtml(plan.title)}${range ? ` · ${escapeHtml(range)}` : ''}</footer>
</main>
</body>
</html>`;
}
