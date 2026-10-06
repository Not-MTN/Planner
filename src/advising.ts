/**
 * The agenda for the next advising meeting.
 *
 * An advisor sees a student for twenty minutes and gets a wall of weekly
 * numbers. This turns the snapshots the student chose to share into the page
 * someone can actually talk from: where the time went, what is working, what
 * slipped, what to ask, and one or two things to agree before the next meeting.
 *
 * It reads *only* the shared weekly results — never the student's tasks, notes
 * or journals, which the guardian side does not have in the first place. Every
 * line is derived arithmetically and stated plainly ("Chemistry got no time last
 * week"), so nothing here depends on an AI call being configured or reachable.
 * The tone is the guard rail: this is a conversation starter, not a verdict on
 * a person.
 */
import { addDays, formatFullDate } from './dates';
import { t, tn } from './i18n';
import type { WeekResults } from './types';

export interface AdvisingSubjectLine {
  name: string;
  /** Minutes per week, oldest first — same order as `agenda.weeks`. */
  minutes: number[];
  /** Minutes in the newest week. */
  latest: number;
  trend: 'up' | 'down' | 'steady';
}

export interface AdvisingAgenda {
  student: string;
  /** Week starts, oldest first. */
  weeks: string[];
  focusMinutes: number[];
  planned: number[];
  done: number[];
  subjects: AdvisingSubjectLine[];
  /** The student's own words for the newest week, when they wrote any. */
  headline: string | null;
  wentWell: string[];
  slipped: string[];
  questions: string[];
  nextSteps: string[];
  /** True when the student has shared nothing yet. */
  empty: boolean;
}

const MAX_WEEKS = 4;
/** A change smaller than this is noise, not a trend. */
const TREND_MINUTES = 20;

function trendOf(series: number[]): 'up' | 'down' | 'steady' {
  if (series.length < 2) return 'steady';
  const latest = series[series.length - 1];
  const previous = series.slice(0, -1);
  const average = previous.reduce((sum, value) => sum + value, 0) / previous.length;
  if (latest - average >= TREND_MINUTES) return 'up';
  if (average - latest >= TREND_MINUTES) return 'down';
  return 'steady';
}

export function buildAdvisingAgenda(input: {
  student: string;
  history: WeekResults[];
  /** The latest snapshot. Usually already the first entry of `history`, but a
   *  freshly linked student can have results before the history catches up. */
  results?: WeekResults | null;
}): AdvisingAgenda {
  const byWeek = new Map<string, WeekResults>();
  for (const entry of input.history) {
    if (entry && typeof entry.weekOf === 'string') byWeek.set(entry.weekOf, entry);
  }
  if (input.results?.weekOf) byWeek.set(input.results.weekOf, input.results);
  const weeks = [...byWeek.values()].sort((a, b) => a.weekOf.localeCompare(b.weekOf)).slice(-MAX_WEEKS);

  const base: AdvisingAgenda = {
    student: input.student,
    weeks: weeks.map((entry) => entry.weekOf),
    focusMinutes: weeks.map((entry) => Math.max(0, Math.round(entry.focusMinutes) || 0)),
    planned: weeks.map((entry) => Math.max(0, Math.round(entry.planned) || 0)),
    done: weeks.map((entry) => Math.max(0, Math.round(entry.done) || 0)),
    subjects: [],
    headline: weeks.length ? weeks[weeks.length - 1].headline ?? null : null,
    wentWell: [],
    slipped: [],
    questions: [],
    nextSteps: [],
    empty: weeks.length === 0,
  };

  if (weeks.length === 0) {
    base.questions = [t('Has anything made study harder to start this month?')];
    base.nextSteps = [t('Agree how results get shared next week, then look at the numbers together.')];
    return base;
  }

  const names = new Set<string>();
  for (const entry of weeks) for (const subject of entry.subjects ?? []) if (subject?.name) names.add(subject.name);
  base.subjects = [...names]
    .map((name) => {
      const minutes = weeks.map((entry) => {
        const found = (entry.subjects ?? []).find((item) => item.name === name);
        return Math.max(0, Math.round(found?.minutes ?? 0) || 0);
      });
      return { name, minutes, latest: minutes[minutes.length - 1], trend: trendOf(minutes) };
    })
    .sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name));

  const latestIndex = weeks.length - 1;
  const latestWeek = weeks[latestIndex];

  // What is working: a subject gaining time, a week that finished what it
  // planned, or a subject that kept a steady rhythm across every shared week.
  for (const subject of base.subjects) {
    if (subject.trend === 'up' && subject.latest > 0) {
      base.wentWell.push(t('{0} gained time — {1} minutes last week.', { 0: subject.name, 1: subject.latest }));
    } else if (subject.minutes.length >= 2 && subject.minutes.every((value) => value >= TREND_MINUTES)) {
      base.wentWell.push(t('{0} has had steady time every week.', { 0: subject.name }));
    }
  }
  const latestPlanned = latestWeek.planned;
  const latestDone = latestWeek.done;
  if (latestPlanned >= 3 && latestDone / latestPlanned >= 0.8) {
    base.wentWell.push(
      t('{0} of {1} planned items were finished — the week was planned at a size that worked.', {
        0: latestDone,
        1: latestPlanned,
      }),
    );
  }

  // What slipped: a subject that lost time, and a plan that was bigger than the
  // week. Both are stated as facts with the numbers behind them.
  for (const subject of base.subjects) {
    if (subject.trend === 'down') {
      base.slipped.push(t('{0} fell to {1} minutes last week.', { 0: subject.name, 1: subject.latest }));
    } else if (subject.latest === 0 && subject.minutes.some((value) => value > TREND_MINUTES)) {
      base.slipped.push(t('{0} got no time last week, after {1} minutes the week before.', {
        0: subject.name,
        1: subject.minutes[subject.minutes.length - 2] ?? 0,
      }));
    }
  }
  if (latestPlanned >= 3 && latestDone / latestPlanned < 0.6) {
    base.slipped.push(
      t('{0} of {1} planned items stayed unfinished — the plan was larger than the week.', {
        0: latestPlanned - latestDone,
        1: latestPlanned,
      }),
    );
  }
  if (weeks.length >= 2 && base.focusMinutes[latestIndex] < base.focusMinutes[0] - TREND_MINUTES) {
    base.slipped.push(
      t('Focused time fell from {0} to {1} minutes across the weeks you can see.', {
        0: base.focusMinutes[0],
        1: base.focusMinutes[latestIndex],
      }),
    );
  }

  // Questions: the slips first, in the student's own subjects, then a small
  // fixed set that is about the routine rather than the score.
  for (const subject of base.subjects.filter((item) => item.trend !== 'up').slice(0, 2)) {
    base.questions.push(t('{0} slipped — was that on purpose, or did something get in the way?', { 0: subject.name }));
  }
  if (base.slipped.length === 0) {
    base.questions.push(t('What part of the routine is helping most right now?'));
  }
  base.questions.push(t('Which subject is hardest to start at the moment?'));
  base.questions.push(t('Do the weekly targets still match the exams that are coming up?'));
  if (base.headline) {
    base.questions.push(t('They wrote “{0}” — what would help with that in the next two weeks?', { 0: base.headline }));
  }

  // Two or three concrete things to leave the meeting with.
  const slippedSubjects = base.subjects.filter((item) => item.trend === 'down' || item.latest === 0).slice(0, 2);
  for (const subject of slippedSubjects) {
    base.nextSteps.push(t('Agree one small block for {0} before the next meeting.', { 0: subject.name }));
  }
  if (latestPlanned >= 3 && latestDone / latestPlanned < 0.8) {
    base.nextSteps.push(t('Cut next week to the three things that matter most.'));
  }
  if (weeks.length >= 2 && base.focusMinutes[latestIndex] >= base.focusMinutes[0]) {
    base.nextSteps.push(t('Keep the current plan and check the exam dates at the next meeting.'));
  }
  if (base.nextSteps.length === 0) {
    base.nextSteps.push(t('Keep the current plan and check the exam dates at the next meeting.'));
  }

  return base;
}

/** The week the agenda covers, as a printable range. */
export function advisingRange(agenda: AdvisingAgenda): string {
  if (agenda.weeks.length === 0) return '';
  const first = agenda.weeks[0];
  const last = addDays(agenda.weeks[agenda.weeks.length - 1], 6);
  return `${formatFullDate(first)} — ${formatFullDate(last)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The agenda as a page of its own, sized for paper. Mirrors `weeklyReportHtml`. */
export function advisingHtml(agenda: AdvisingAgenda, options: { madeOn: string; dir?: string; lang?: string }): string {
  const dir = options.dir === 'rtl' ? 'rtl' : 'ltr';
  const madeOn = formatFullDate(options.madeOn);
  const range = advisingRange(agenda);

  const list = (items: string[], empty: string) =>
    items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : `<p class="empty">${escapeHtml(empty)}</p>`;

  const weekRows = agenda.weeks
    .map((week, index) => {
      const planned = agenda.planned[index];
      const done = agenda.done[index];
      return `<tr>
      <td>${escapeHtml(formatFullDate(week))}</td>
      <td>${escapeHtml(`${agenda.focusMinutes[index]}`)}</td>
      <td>${escapeHtml(planned ? `${done} / ${planned}` : '—')}</td>
    </tr>`;
    })
    .join('');

  const subjectRows = agenda.subjects
    .map((subject) => {
      const cells = subject.minutes.map((value) => `<td>${escapeHtml(`${value}`)}</td>`).join('');
      return `<tr><th scope="row">${escapeHtml(subject.name)}</th>${cells}</tr>`;
    })
    .join('');

  const headline = agenda.headline
    ? `<section>
    <h2>${escapeHtml(t('In their words'))}</h2>
    <p class="note">${escapeHtml(agenda.headline)}</p>
  </section>`
    : '';

  const subjectTable = agenda.subjects.length
    ? `<table>
    <thead><tr><th scope="col">${escapeHtml(t('Subject'))}</th>${agenda.weeks
      .map((week) => `<th scope="col">${escapeHtml(formatFullDate(week))}</th>`)
      .join('')}</tr></thead>
    <tbody>${subjectRows}</tbody>
  </table>`
    : `<p class="empty">${escapeHtml(t('No subject detail was shared for these weeks.'))}</p>`;

  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? 'en')}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t('Advising meeting · {0}', { 0: agenda.student }))}</title>
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
  h2 { margin: 26px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #eceef1;
       font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #5c626c; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: start; padding: 5px 8px 5px 0; border-bottom: 1px solid #f1f2f4; }
  thead th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6d737d; }
  ul { margin: 0; padding-inline-start: 18px; }
  li { margin: 3px 0; }
  .empty { margin: 0; color: #8a8f98; font-size: 13.5px; }
  .note { margin: 0; white-space: pre-wrap; }
  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #eceef1; font-size: 11px; color: #9aa0a9; }
  ul, li, table, section { break-inside: avoid; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<main>
  <header>
    <p class="kicker">${escapeHtml(t('Advising meeting'))}</p>
    <h1>${escapeHtml(agenda.student)}</h1>
    <p class="made">${escapeHtml(range ? t('Shared results for {0}', { 0: range }) : t('Made on {0}', { 0: madeOn }))}</p>
  </header>

${agenda.empty
      ? `<p class="empty">${escapeHtml(t('No weekly results have been shared yet, so this page holds the questions to open with.'))}</p>`
      : `<section>
    <h2>${escapeHtml(t('Where the time went'))}</h2>
    <table>
      <thead><tr><th scope="col">${escapeHtml(t('Week'))}</th><th scope="col">${escapeHtml(t('Focused minutes'))}</th><th scope="col">${escapeHtml(t('Done / planned'))}</th></tr></thead>
      <tbody>${weekRows}</tbody>
    </table>
    ${subjectTable}
  </section>`}

${headline}

  <section>
    <h2>${escapeHtml(t('What is working'))}</h2>
    ${list(agenda.wentWell, t('Nothing stands out yet — the first weeks are still settling.'))}
  </section>

  <section>
    <h2>${escapeHtml(t('What slipped'))}</h2>
    ${list(agenda.slipped, t('Nothing slipped in the weeks you can see.'))}
  </section>

  <section>
    <h2>${escapeHtml(t('Worth asking'))}</h2>
    ${list(agenda.questions, '')}
  </section>

  <section>
    <h2>${escapeHtml(t('Next steps'))}</h2>
    ${list(agenda.nextSteps, '')}
  </section>

  <footer>${escapeHtml(tn(agenda.weeks.length, 'Built from {count} shared week. Only weekly results are shown — never tasks or notes.', 'Built from {count} shared weeks. Only weekly results are shown — never tasks or notes.'))}</footer>
</main>
</body>
</html>`;
}
