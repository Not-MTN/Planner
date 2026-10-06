/**
 * A pasted syllabus becomes a term plan.
 *
 * Course outlines arrive as text — a PDF, a web page, an email — and almost
 * always with the same skeleton: a line per teaching week, a handful of dated
 * assessments, and a start date somewhere near the top. What is *not* the same
 * is the spelling. "Week 3", "Wk 3 — Thermodynamics", "3. Thermodynamics",
 * "Week 3:", "Reading week"… so this reads the shapes it can and says how many
 * lines it did not understand instead of guessing at them.
 *
 * Two deliberate limits:
 *
 * - Week numbers must be *labelled*. A bare "3. Thermodynamics" is only a week
 *   because the line above it was a week, and paying a wrong term plan into a
 *   real planner is worse than paying none. The count of leftover dated lines
 *   comes back as `unread` so the screen can say so.
 * - Ambiguous numeric dates are read day-first (`05/03` is 5 March). Half the
 *   world writes them the other way; a note in the UI says which reading to
 *   expect rather than silently flipping for one user and not the next.
 *
 * Nothing here touches the planner: `syllabusToTasks` returns ordinary
 * `TaskInput`s and the caller decides whether to add them — same contract as
 * the CSV importer.
 */
import { addDays, isValidISODate } from './dates';
import { t } from './i18n';
import type { TaskInput } from './types';

export interface SyllabusWeek {
  /** 1-based week number as written on the line. */
  week: number;
  /** The week's topic, without its number, or `Week {n}` when the line was bare. */
  title: string;
  /** The week's Monday when a start date is known (or the line carried a date). */
  start: string | null;
  /** Everything after the title, kept for the note. */
  topics: string;
}

export interface SyllabusAssessment {
  title: string;
  date: string | null;
  /** Percentage of the final grade, when the line says so. */
  weight: number | null;
}

export interface SyllabusParse {
  weeks: SyllabusWeek[];
  assessments: SyllabusAssessment[];
  /** First day of teaching, when the syllabus states one. */
  termStart: string | null;
  /** Lines that carried a date but were not a week or an assessment. */
  unread: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function iso(year: number, month: number, day: number, fallbackYear: number): string | null {
  const y = year || fallbackYear;
  const padded = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidISODate(padded) ? padded : null;
}

/**
 * A date anywhere in a line, or null. Numeric dates are day-first.
 *
 * Order matters: the ISO form is tried first so `2026-03-05` is never read as
 * `26/03/2005`, and every numeric group is bounded with `(?!\d)` so the `20` of
 * a year is never mistaken for a day.
 */
export function readDate(raw: string, fallbackYear: number): string | null {
  if (!raw) return null;
  const text = raw.trim();

  const isoSolid = /(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(text);
  if (isoSolid) {
    const found = iso(Number(isoSolid[1]), Number(isoSolid[2]), Number(isoSolid[3]), fallbackYear);
    if (found) return found;
  }

  const dayMonth = /(\d{1,2})(?!\d)(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4})(?!\d))?/.exec(text);
  if (dayMonth) {
    const month = MONTHS[dayMonth[2].toLowerCase()];
    if (month) {
      const found = iso(dayMonth[3] ? Number(dayMonth[3]) : 0, month, Number(dayMonth[1]), fallbackYear);
      if (found) return found;
    }
  }

  const monthDay = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s*(\d{4})(?!\d))?/.exec(text);
  if (monthDay) {
    const month = MONTHS[monthDay[1].toLowerCase()];
    if (month) {
      const found = iso(monthDay[3] ? Number(monthDay[3]) : 0, month, Number(monthDay[2]), fallbackYear);
      if (found) return found;
    }
  }

  const numeric = /(\d{1,2})(?!\d)[./-](\d{1,2})(?!\d)(?:[./-](\d{2,4})(?!\d))?/.exec(text);
  if (numeric) {
    const year = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : 0;
    const found = iso(year, Number(numeric[2]), Number(numeric[1]), fallbackYear);
    if (found) return found;
  }

  return null;
}

const WEEK_LINE = /^\s*(?:week|wk|w)\s*[.:#-]?\s*(\d{1,2})\b[\s:.\-–—]*([\s\S]*)$/i;
const ASSESSMENT_WORDS = /(exam|midterm|final|quiz|test|assignment|essay|project|presentation|coursework|paper|portfolio|lab report|report)/i;
const TERM_START_LINE = /(term|semester|classes|course|teaching|lectures?)\s*(?:starts?|begins?|begin|start)|start\s*(?:of|date)/i;

/** Where a week starts, when the syllabus says when teaching does. */
function weekStartOf(termStart: string | null, week: number): string | null {
  return termStart ? addDays(termStart, 7 * (week - 1)) : null;
}

/**
 * Read a syllabus in one pass. `today` only supplies a year for dates written
 * without one, and is also the fallback when the syllabus is undated entirely.
 */
export function parseSyllabus(text: string, today = ''): SyllabusParse {
  const fallbackYear = Number(today.slice(0, 4)) || new Date().getFullYear();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '');

  let termStart: string | null = null;
  const weeks: SyllabusWeek[] = [];
  const assessments: SyllabusAssessment[] = [];
  let unread = 0;
  let lastWeek: SyllabusWeek | null = null;
  let detailLines = 0;

  for (const line of lines) {
    const weekMatch = WEEK_LINE.exec(line);
    if (weekMatch) {
      const number = Number(weekMatch[1]);
      const rest = weekMatch[2].trim();
      const date = readDate(rest, fallbackYear);
      if (!termStart && number === 1 && date) termStart = date;
      const title = rest.replace(/^[-–—:.\s]+/, '');
      const week: SyllabusWeek = {
        week: number,
        title,
        start: date ?? weekStartOf(termStart, number),
        topics: '',
      };
      weeks.push(week);
      lastWeek = week;
      detailLines = 0;
      continue;
    }

    // A line with no week label but "term starts 15 September" is the one
    // structure worth looking for outside the week loop.
    if (!termStart && TERM_START_LINE.test(line)) {
      const date = readDate(line, fallbackYear);
      if (date) {
        termStart = date;
        for (const week of weeks) week.start = week.start ?? weekStartOf(termStart, week.week);
        continue;
      }
    }

    const date = readDate(line, fallbackYear);
    if (ASSESSMENT_WORDS.test(line)) {
      const percent = /(\d{1,3})\s*(?:%|percent)/i.exec(line) ?? /worth\s+(\d{1,3})/i.exec(line);
      const weight = percent ? Math.min(100, Number(percent[1])) : null;
      // The title is the useful part of the line, minus the marking detail.
      const title = line
        .replace(/\s*[-–—·|]?\s*\d{1,3}\s*(?:%|percent)\b/gi, '')
        .replace(/\s*[-–—·|]?\s*worth\s+\d{1,3}\b/gi, '')
        .replace(/^\s*[-–—*•\d.)\s]+/, '')
        .trim()
        .slice(0, 140);
      if (title) assessments.push({ title, date, weight });
      continue;
    }

    // An unlabelled line straight under a week line is that week's detail.
    if (lastWeek && detailLines < 6 && !date && line.trim().length <= 400 && !/^\s*[-–—·]\s*$/.test(line)) {
      const detail = line.trim().replace(/^\s*[-–—*•]\s*/, '');
      lastWeek.topics = lastWeek.topics ? `${lastWeek.topics}\n${detail}` : detail;
      detailLines += 1;
      continue;
    }

    if (date) unread += 1;
  }

  return {
    weeks: weeks.sort((a, b) => a.week - b.week),
    assessments,
    termStart,
    unread,
  };
}

export interface SyllabusTaskOptions {
  /** Prepended to every title so a term plan reads as one subject. */
  subject?: string;
  category?: string;
  /** Study time to plan for each teaching week. */
  weeklyMinutes?: number;
  /** Default effort for an assessment. */
  assessmentMinutes?: number;
}

/**
 * The parsed term as ordinary tasks: one per teaching week, one per assessment.
 * Weeks due on their Monday so the work sits in the right week the moment it
 * lands in the planner; assessments on the day the syllabus gave.
 */
export function syllabusToTasks(parse: SyllabusParse, options: SyllabusTaskOptions = {}): TaskInput[] {
  const subject = options.subject?.trim().slice(0, 40) ?? '';
  const category = options.category ?? 'learning';
  const prefix = subject ? `${subject} · ` : '';
  const out: TaskInput[] = [];

  for (const week of parse.weeks) {
    const title = week.title ? `${prefix}Week ${week.week}: ${week.title}` : `${prefix}Week ${week.week}`;
    const noteParts: string[] = [];
    if (week.start) noteParts.push(t('Week of {0}', { 0: week.start }));
    if (week.topics) noteParts.push(week.topics);
    out.push({
      title: title.slice(0, 140),
      priority: 'medium',
      dueDate: week.start,
      dueTime: null,
      category,
      note: noteParts.join('\n').slice(0, 4000),
      goalId: null,
      estimatedMinutes: options.weeklyMinutes ?? null,
    });
  }

  for (const assessment of parse.assessments) {
    const title = `${prefix}${assessment.title}`.slice(0, 140);
    const heavy = (assessment.weight ?? 0) >= 25;
    out.push({
      title,
      priority: heavy ? 'high' : 'medium',
      dueDate: assessment.date,
      dueTime: null,
      category,
      note: assessment.weight !== null ? t('Worth {0}% of the grade', { 0: assessment.weight }) : '',
      goalId: null,
      estimatedMinutes: options.assessmentMinutes ?? null,
    });
  }

  return out;
}
