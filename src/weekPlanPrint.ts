/**
 * A week plan as one page of paper.
 *
 * Both sides print the same page: the guardian pins it to the fridge, the
 * student checks days off by hand when the screen is elsewhere. Open days
 * print as empty circles on purpose — the page is a checklist, not a verdict.
 *
 * One page, whatever the week holds. A page is a fixed amount of paper, so the
 * document is measured before it is written (`planPrintFit`): the lesson rows
 * it has, the days it has to show, and the orientation chosen. From that comes
 * a density — how large the type is — a column count, and, only when even the
 * smallest honest type would overflow, a per-day row cap that says "+3 more"
 * rather than spilling onto a second sheet. The header is a slim band for the
 * same reason: the plan is what the page is for, and a thirty-pixel title is
 * not.
 *
 * Orientation is a setting on the page, not a hope about the dialogue: `@page`
 * carries the size, and the layout re-reads it, so portrait and landscape each
 * get the columns that suit them.
 *
 * Both pages are previewed inside the app before they are printed, so what is
 * on the screen is what comes out.
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

/* ------------------------------------------------------------- fitting (0) */

/** What the reader asked for. 'auto' follows the shape of the screen it is on. */
export type PrintOrientation = 'auto' | 'portrait' | 'landscape';

/** How large the type is. Every step down buys another block of lessons. */
export type PrintDensity = 'roomy' | 'compact' | 'dense' | 'micro';

export interface PrintFit {
  orientation: 'portrait' | 'landscape';
  density: PrintDensity;
  /** How many columns the day cards flow into. */
  columns: number;
  /**
   * Rows a day shows before folding the rest into a "+N more" line. Null when
   * the week fits whole — the cap is a last resort, not a default.
   */
  maxRows: number | null;
}

/** Printable area in millimetres, after the margins. */
const PAGE = {
  portrait: { width: 210 - 16, height: 297 - 16 },
  landscape: { width: 297 - 16, height: 210 - 16 },
} as const;

/** The most columns a page can take before a day card is too narrow to read. */
const MAX_COLUMNS = { portrait: 3, landscape: 4 } as const;

/**
 * How tall the things on the page are, in millimetres.
 *
 * Deliberately generous: a line of type at 1.35 line-height, plus the padding
 * and the border it sits in. Pricing the page too cheaply is how a plan gets
 * two sheets, and nobody reads the second one.
 */
interface DensitySpec {
  id: PrintDensity;
  /** Body type in millimetres — print measures in mm, so the page does too. */
  font: number;
  /** One lesson row, padded. */
  row: number;
  /** A day card's header line. */
  head: number;
  /** A day card's padding, borders and the space after it. */
  card: number;
  /** Header band, plan note, footer and the gaps between them. */
  chrome: number;
  /** Columns this density still reads in: tiny type wants a narrower measure. */
  columns: { portrait: number; landscape: number };
}

const DENSITIES: DensitySpec[] = [
  { id: 'roomy', font: 3.4, row: 6.4, head: 7.6, card: 6.0, chrome: 42, columns: { portrait: 2, landscape: 3 } },
  { id: 'compact', font: 3.0, row: 5.5, head: 6.7, card: 5.2, chrome: 36, columns: { portrait: 2, landscape: 3 } },
  { id: 'dense', font: 2.6, row: 4.7, head: 5.9, card: 4.4, chrome: 32, columns: { portrait: 3, landscape: 4 } },
  { id: 'micro', font: 2.2, row: 3.9, head: 5.1, card: 3.6, chrome: 28, columns: { portrait: 3, landscape: 4 } },
];

/** A subject or minutes line under a lesson is most of a row of its own. */
const DETAIL_OF_ROW = 0.75;
/** A filed report under the day's table, with its box around it. */
const REPORT_OF_ROW = 1.2;

/** The content a week page has to hold, in the units `planPrintFit` prices. */
export interface PrintVolume {
  /** Lesson rows, counting the "any day" block as one more day. */
  lessons: number;
  /** Day cards, counting the "any day" block when it has lessons. */
  days: number;
  /** Lessons carrying a second line: a subject, an estimate, or a prep link. */
  details?: number;
  /** Days that carry a report, and so a line of words under the table. */
  reports?: number;
}

/** How tall a week page comes out, in millimetres, at one density and width. */
function pageHeight(volume: PrintVolume, spec: DensitySpec, columns: number): number {
  const detail = (volume.details ?? 0) * spec.row * DETAIL_OF_ROW;
  const reports = (volume.reports ?? 0) * spec.row * REPORT_OF_ROW;
  const total = volume.lessons * spec.row + detail + reports + volume.days * (spec.head + spec.card);
  return spec.chrome + total / columns;
}

/**
 * The layout that fits a week on one sheet.
 *
 * Largest type first: the fit walks the densities from roomy down and, at each,
 * takes the fewest columns that fit. Only when the smallest type still will not
 * fit does a day start folding its rows away — and then it says so on the page.
 */
export function planPrintFit(
  volume: PrintVolume,
  options: { orientation?: PrintOrientation; wide?: boolean } = {},
): PrintFit {
  const orientation: 'portrait' | 'landscape' =
    options.orientation === 'portrait' || options.orientation === 'landscape'
      ? options.orientation
      : // 'auto': a wide screen is a desk, and a desk prints landscape.
        options.wide
        ? 'landscape'
        : 'portrait';
  const height = PAGE[orientation].height;
  const days = Math.max(1, volume.days);

  for (const spec of DENSITIES) {
    for (let columns = 1; columns <= spec.columns[orientation]; columns += 1) {
      if (columns > MAX_COLUMNS[orientation]) break;
      if (pageHeight(volume, spec, columns) <= height) {
        return { orientation, density: spec.id, columns, maxRows: null };
      }
    }
  }

  // Nothing fits whole: keep the smallest type and fold each day's rows so the
  // page still ends where the paper does. The cap is spread over the days that
  // have lessons, and never goes below one row — a day that vanishes is worse
  // than a day that says "+4 more". A folded lesson is priced with its detail
  // line, because that is what a row costs on the page.
  const spec = DENSITIES[DENSITIES.length - 1]!;
  const columns = spec.columns[orientation];
  const perRow = spec.row * (1 + (volume.details ? Math.min(1, volume.details / Math.max(1, volume.lessons)) : 0) * DETAIL_OF_ROW);
  const used = (volume.reports ?? 0) * spec.row * REPORT_OF_ROW + days * (spec.head + spec.card);
  const available = (height - spec.chrome) * columns - used;
  const rows = Math.max(days, Math.floor(available / perRow));
  return { orientation, density: spec.id, columns, maxRows: Math.max(1, Math.floor(rows / days)) };
}

/**
 * The volume a week plan prints as, so the fit and the page agree.
 *
 * Everything that costs paper is counted here and nowhere else: the rows, the
 * lessons that print a second line, and the days that carry a report.
 */
export function weekPrintVolume(plan: GuardianPlan, reports: DayReport[] = []): PrintVolume {
  const days = planWeekDays(plan);
  const floating = datelessItems(plan);
  const dated = days.flatMap((date) => itemsForDay(plan, date));
  const lessons = [...dated, ...floating];
  const withDetail = (item: PlanItem) =>
    (!!item.subject && item.subject !== item.title) || !!item.minutes || !!item.url;
  return {
    lessons: lessons.length,
    days: days.length + (floating.length > 0 ? 1 : 0),
    details: lessons.filter(withDetail).length,
    reports: days.filter((date) => !!reportFor(reports, plan.id, date) && itemsForDay(plan, date).length > 0).length,
  };
}

/** The CSS custom properties a fit turns into. */
function fitVars(fit: PrintFit): string {
  const spec = DENSITIES.find((entry) => entry.id === fit.density) ?? DENSITIES[0]!;
  return `--fit-font: ${spec.font}mm; --fit-row: ${spec.row}mm; --fit-columns: ${fit.columns};`;
}

/* ---------------------------------------------------------------- the page */

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

function lessonTable(items: PlanItem[], maxRows: number | null): string {
  const shown = maxRows === null ? items : items.slice(0, maxRows);
  const hidden = items.length - shown.length;
  const showTime = items.some((item) => item.time);
  return `<table>
    <tbody>${lessonRows(shown, showTime)}</tbody>
  </table>${
    hidden > 0
      ? `<p class="folded">${escapeHtml(t('+{0} more', { 0: hidden }))}</p>`
      : ''
  }`;
}

/** The week at a glance: four numbers in the header band, one line of them. */
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

/**
 * Styles both pages share.
 *
 * No web fonts on purpose. A printed page is opened as a file of its own, and
 * an `@import` from a font host would delay the print, fail offline, and send
 * the reader's address somewhere neither side asked for. The stack below is the
 * device's own, Vazirmatn first where it is installed.
 */
const PRINT_SHELL = `
  @page { size: A4 var(--page-orientation, portrait); margin: 8mm; }
  :root { color-scheme: light; --violet: #6d28d9; --violet-deep: #4c1d95; --ink: #1a1040; --body: #1e293b;
          --muted: #64748b; --line: #ddd6fe; --wash: #f8f5ff;
          --fit-font: 3.4mm; --fit-row: 6mm; --fit-columns: 2; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: #f6f4fb; color: var(--body);
         font: var(--fit-font)/1.35 'Vazirmatn', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main { max-width: 760px; margin: 0 auto; padding: 7mm 7mm 5mm; background: #fff;
         border-radius: 4mm; box-shadow: 0 6mm 18mm rgba(76,29,149,.10); }
  /* ---- the header band: one line of names, one line of numbers, no more ---- */
  header { border-bottom: .5mm solid var(--line); padding-bottom: 2mm; }
  .head-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 1mm 3mm; }
  .kicker { margin: 0; font-size: calc(var(--fit-font) * .82); letter-spacing: .12em; text-transform: uppercase;
            color: var(--violet); font-weight: 700; white-space: nowrap; }
  h1 { margin: 0; font-size: calc(var(--fit-font) * 1.5); font-weight: 800; letter-spacing: -.01em;
       color: var(--ink); line-height: 1.2; overflow-wrap: anywhere; }
  .made { margin: 1mm 0 0; font-size: calc(var(--fit-font) * .9); color: var(--muted); line-height: 1.4; }
  .made .sep { color: #c4b5fd; margin: 0 1.6mm; }
  .made-jalali { font-size: calc(var(--fit-font) * .9); color: var(--violet); font-weight: 600; }
  .stats { display: flex; flex-wrap: wrap; gap: 1.5mm; margin: 2mm 0 0; }
  .stat { flex: 1 1 0; min-width: 0; padding: 1mm 1.5mm; border: .25mm solid var(--line); border-radius: 2mm;
          background: linear-gradient(160deg, #fff 0%, var(--wash) 130%); text-align: center; }
  .stat strong { display: block; font-size: calc(var(--fit-font) * 1.15); font-weight: 700; color: var(--violet-deep);
                 font-variant-numeric: tabular-nums; line-height: 1.2; }
  .stat span { display: block; font-size: calc(var(--fit-font) * .72); letter-spacing: .06em; text-transform: uppercase;
               color: var(--muted); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .plan-note { margin: 2mm 0 0; font-size: calc(var(--fit-font) * .95); color: #334155; line-height: 1.4;
               background: linear-gradient(135deg, var(--wash) 0%, #fefce8 100%); border: .25mm solid var(--line);
               border-radius: 2mm; padding: 1.5mm 2.5mm; white-space: pre-wrap; }
  /* ---- the days, in as many columns as the fit chose ---- */
  .days { column-count: var(--fit-columns); column-gap: 3mm; margin-top: 2.5mm; }
  section { margin: 0 0 2.5mm; padding: 1.5mm 2mm 1.2mm; background: #fff; border: .25mm solid var(--line);
            border-radius: 2mm; break-inside: avoid; page-break-inside: avoid; }
  section.is-today { border-color: #a78bfa; box-shadow: 0 0 0 .4mm #f5f3ff; }
  section.is-past { background: #fdfcff; }
  .day-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 1mm 2mm; margin: 0 0 1.2mm;
              padding: 0 0 1mm; border-bottom: .25mm dashed #e9e5ff; }
  .day-head h2 { margin: 0; font-size: calc(var(--fit-font) * 1.02); font-weight: 700; color: var(--body); }
  .day-head .jalali { font-size: calc(var(--fit-font) * .85); font-weight: 600; color: var(--violet);
                      background: #f5f3ff; border: .25mm solid var(--line); border-radius: 999px; padding: 0 1.6mm; }
  .day-head .flag { margin-inline-start: auto; font-size: calc(var(--fit-font) * .75); letter-spacing: .04em;
                    text-transform: uppercase; font-weight: 700; border-radius: 999px; padding: 0 1.6mm; }
  .flag.today { color: var(--violet-deep); background: #ede9fe; }
  .flag.reported { color: #166534; background: #dcfce7; }
  .flag.missing { color: #9a3412; background: #ffedd5; }
  .flag.rest { color: var(--violet); background: #f5f3ff; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: .4mm 1mm; text-align: start; vertical-align: top; }
  tbody tr { border-bottom: .25mm solid #f3f0ff; }
  tbody tr:last-child { border-bottom: 0; }
  tbody tr.is-done td { color: #64748b; }
  tbody tr.is-done .lesson-title { text-decoration: line-through; text-decoration-color: #c4b5fd; }
  .tick { width: 1.6em; text-align: center; font-weight: 700; color: var(--violet); }
  td.time { white-space: nowrap; color: #475569; font-variant-numeric: tabular-nums; font-weight: 600;
            font-size: calc(var(--fit-font) * .92); }
  td.time .dur { display: block; font-size: calc(var(--fit-font) * .75); font-weight: 600; color: var(--violet); }
  .lesson-title { display: block; font-weight: 600; color: var(--body); overflow-wrap: anywhere; }
  .lesson-meta { display: block; font-size: calc(var(--fit-font) * .82); color: var(--muted); }
  .prep { display: block; font-size: calc(var(--fit-font) * .78); color: #6d28d9; overflow-wrap: anywhere; }
  .prep-key { display: inline-block; margin-inline-end: 1mm; padding: 0 1mm; border: .25mm solid var(--line);
              border-radius: 999px; background: var(--wash); font-size: calc(var(--fit-font) * .7);
              letter-spacing: .04em; text-transform: uppercase; }
  .folded { margin: .8mm 0 0; font-size: calc(var(--fit-font) * .82); font-weight: 700; color: var(--violet); }
  .empty { margin: 0; padding: 1mm; color: #94a3b8; font-size: calc(var(--fit-font) * .9); font-style: italic;
           text-align: center; background: #f8fafc; border: .25mm dashed #e2e8f0; border-radius: 2mm; }
  .report { margin: 1mm 0 0; padding: .8mm 1.5mm; font-size: calc(var(--fit-font) * .9); border-radius: 2mm; }
  .report .yes { color: #15803d; font-weight: 700; }
  .report .no { color: #c2410c; font-weight: 700; }
  .report .rest { color: var(--violet); font-weight: 700; }
  .report .reacts { margin-inline-start: 1.5mm; letter-spacing: .06em; }
  .report-note { color: #334155; }
  p.report:has(.yes) { background: #f0fdf4; border: .25mm solid #dcfce7; }
  p.report:has(.no) { background: #fff7ed; border: .25mm solid #ffedd5; }
  p.report:has(.rest) { background: #f5f3ff; border: .25mm solid var(--line); }
  footer { margin-top: 2mm; padding-top: 1.5mm; border-top: .25mm solid var(--line); text-align: center;
           font-size: calc(var(--fit-font) * .78); color: #94a3b8; letter-spacing: .04em; }
  @media print {
    body { background: #fff; }
    main { max-width: none; margin: 0; padding: 0; border-radius: 0; box-shadow: none; }
    section { box-shadow: none; }
    a { color: inherit; text-decoration: none; }
  }
`;

function pageStyle(orientation: 'portrait' | 'landscape'): string {
  return `:root { --page-orientation: ${orientation}; }`;
}

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
    <div class="head-line">
      <p class="kicker">${escapeHtml(options.kicker)}</p>
      <h1>${escapeHtml(plan.title)}</h1>
    </div>
    <p class="made">${escapeHtml(options.side === 'student' ? t('From {0}', { 0: options.student }) : t('Plan for {0}', { 0: options.student }))}${range ? `<span class="sep">·</span>${escapeHtml(range)}` : ''}<span class="sep">·</span>${escapeHtml(t('Made on {0}', { 0: formatFullDate(options.madeOn) }))}</p>
    ${jalaliRange || madeJalali ? `<p class="made made-jalali" dir="rtl">${escapeHtml([jalaliRange, madeJalali].filter(Boolean).join(' · '))}</p>` : ''}
    ${summaryStrip(plan, reports, options.madeOn)}
    ${plan.note ? `<p class="plan-note">${escapeHtml(plan.note)}</p>` : ''}
  </header>`;
}

export interface PrintOptions {
  student: string;
  madeOn: string;
  dir?: string;
  lang?: string;
  side?: 'guardian' | 'student';
  /** Portrait, landscape, or the shape of the screen the page is being read on. */
  orientation?: PrintOrientation;
  /** Whether the reader's screen is wide — what 'auto' follows. */
  wide?: boolean;
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
  options: PrintOptions,
): string {
  const dir = options.dir === 'rtl' ? 'rtl' : 'ltr';
  const fit = planPrintFit(weekPrintVolume(plan, reports), options);
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
    ${lessons.length > 0 ? lessonTable(lessons, fit.maxRows) : `<p class="empty">${escapeHtml(t('No lessons planned.'))}</p>`}
    ${reportLine}
  </section>`;
    })
    .join('\n');

  const floating = datelessItems(plan);
  const floatingSection =
    floating.length > 0
      ? `<section>
    <div class="day-head"><h2>${escapeHtml(t('Any day'))}</h2></div>
    ${lessonTable(floating, fit.maxRows)}
  </section>`
      : '';

  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? 'en')}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(plan.title)}</title>
<style>${PRINT_SHELL}${pageStyle(fit.orientation)}:root { ${fitVars(fit)} }</style>
</head>
<body>
<main>
  ${headerBlock(plan, reports, { ...options, kicker: t('Week plan') })}
  <div class="days">
${daySections}
${floatingSection}
  </div>
  <footer>${escapeHtml(t('Week plan'))} · ${escapeHtml(plan.title)}${range ? ` · ${escapeHtml(range)}` : ''}</footer>
</main>
</body>
</html>`;
}

/**
 * The week as a wall timetable: days across, times down. The same data as the
 * day-by-day page, rearranged for pinning — a glanceable grid where the other
 * page is a readable story. A grid cannot be folded into columns, so it fits
 * by shrinking its type instead, and it prefers landscape when nobody chose.
 */
export function timetableHtml(
  plan: GuardianPlan,
  reports: DayReport[],
  options: PrintOptions,
): string {
  const dir = options.dir === 'rtl' ? 'rtl' : 'ltr';
  const grid = timetableModel(plan, reports);
  const days = planWeekDays(plan);
  const range = days.length === 7 ? `${formatFullDate(days[0] as string)} – ${formatFullDate(days[6] as string)}` : '';
  // Seven day columns across, plus the time gutter: a grid is wide by nature.
  const wide = options.orientation === 'auto' || options.orientation === undefined;
  const fit = planPrintFit(
    { lessons: plan.items.length, days: 1, details: plan.items.filter((item) => !!item.end).length },
    { orientation: options.orientation, wide: options.wide ?? wide },
  );

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
<style>${PRINT_SHELL}${pageStyle(fit.orientation)}:root { ${fitVars(fit)} }
  main { max-width: 940px; }
  .days { column-count: 1; }
  table.tt { width: 100%; margin-top: 2.5mm; border-collapse: collapse; table-layout: fixed; }
  .tt th, .tt td { border: .25mm solid var(--line); padding: .8mm 1mm; vertical-align: top; text-align: start;
                   overflow-wrap: anywhere; }
  .tt thead th { background: linear-gradient(180deg, #faf8ff 0%, #f4f1ff 100%); color: var(--violet-deep); }
  .tt thead th.is-today, .tt td.is-today { background: #fbfaff; box-shadow: inset 0 0 0 .4mm #ede9fe; }
  .tt tbody th { background: #f8fafc; white-space: nowrap; font-variant-numeric: tabular-nums; color: #475569;
                 font-weight: 700; }
  .tt-day { display: block; font-weight: 700; color: var(--body); }
  .tt-date { display: block; font-size: calc(var(--fit-font) * .85); font-weight: 500; color: var(--muted);
             font-variant-numeric: tabular-nums; }
  .tt-jalali { display: block; margin-top: .5mm; padding: 0 1mm; font-size: calc(var(--fit-font) * .8); font-weight: 600;
               color: var(--violet); background: #f5f3ff; border-radius: 999px; text-align: center; }
  .tt-mark { display: block; margin-top: .6mm; padding: 0 1mm; font-size: calc(var(--fit-font) * .7);
             letter-spacing: .04em; text-transform: uppercase; font-weight: 700; color: #166534; background: #dcfce7;
             border-radius: 999px; text-align: center; }
  .tt-mark.rest { color: var(--violet); background: #f5f3ff; }
  .tt-mark.today { color: var(--violet-deep); background: #ede9fe; }
  .tt-lesson { display: block; margin: 0 0 .8mm; padding: .6mm 1mm; background: #fff; border: .25mm solid var(--line);
               border-inline-start: .8mm solid var(--violet); border-radius: 1.5mm; break-inside: avoid; }
  .tt-lesson:last-child { margin-bottom: 0; }
  .tt-lesson.is-done { border-inline-start-color: #22c55e; background: #f7fef9; }
  .tt-lesson.is-done .tt-title { text-decoration: line-through; color: var(--muted); }
  .tt-tick { color: #16a34a; font-weight: 700; margin-inline-end: .8mm; }
  .tt-title { display: block; font-weight: 600; color: var(--body); }
  .tt-span { display: block; font-size: calc(var(--fit-font) * .8); color: var(--violet); font-variant-numeric: tabular-nums; }
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
