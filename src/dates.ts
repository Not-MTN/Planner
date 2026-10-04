import { MOTIVATION } from './constants';
import { faDigits, faNum, t } from './i18n';

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

export function isValidISODate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toISODate(parseISODate(iso)) === iso;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function addDays(iso: string, amount: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + amount);
  return toISODate(date);
}

/** 0 = Sunday, 1 = Monday (default), 6 = Saturday. */
export type WeekStart = 0 | 1 | 6;
const WEEK_START_KEY = 'planner-week-start';
let weekStart: WeekStart = 1;

export function loadWeekStart(): WeekStart {
  try {
    const raw = Number(localStorage.getItem(WEEK_START_KEY));
    weekStart = raw === 0 || raw === 6 ? raw : 1;
  } catch {
    weekStart = 1;
  }
  return weekStart;
}

export function setWeekStart(value: WeekStart): void {
  weekStart = value;
  try {
    localStorage.setItem(WEEK_START_KEY, String(value));
  } catch {
    /* ignore */
  }
}
/** Weekday headers in the user's chosen order and language. */
export function weekdayHeaders(): string[] {
  // 2026-09-27 is a Sunday.
  return Array.from({ length: 7 }, (_, index) => formatWeekdayShort(addDays('2026-09-27', (weekStart + index) % 7)));
}

export function startOfWeek(iso: string): string {
  const date = parseISODate(iso);
  const diff = -((date.getDay() - weekStart + 7) % 7);
  date.setDate(date.getDate() + diff);
  return toISODate(date);
}

export function weekDates(iso: string): string[] {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function monthDates(year: number, month: number): string[] {
  const count = daysInMonth(year, month);
  return Array.from({ length: count }, (_, index) => toISODate(new Date(year, month - 1, index + 1)));
}

export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(year, month - 1, 1 - offset);
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return toISODate(date);
  });
  const lastRowOutside = cells.slice(35).every((iso) => parseISODate(iso).getMonth() !== month - 1);
  return lastRowOutside ? cells.slice(0, 35) : cells;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

/** HH:MM plus a number of minutes, clamped inside the day. */
export function addMinutes(time: string, amount: number): string {
  const mins = Math.max(0, timeToMinutes(time) + amount);
  const capped = Math.min(mins, 24 * 60 - 1);
  return `${String(Math.floor(capped / 60)).padStart(2, '0')}:${String(capped % 60).padStart(2, '0')}`;
}

export function formatClock(date: Date): string {
  return faDigits(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
}

export function suggestTime(now = new Date()): string {
  const hour = now.getHours();
  if (hour >= 23) return '23:00';
  return `${String(hour + 1).padStart(2, '0')}:00`;
}

export function formatDuration(start: string, end: string | null): string | null {
  if (!end || !isValidTime(start) || !isValidTime(end)) return null;
  const minutes = timeToMinutes(end) - timeToMinutes(start);
  if (minutes <= 0) return null;
  if (minutes < 60) return t('{0} min', { 0: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t('{0} h {1} min', { 0: hours, 1: rest }) : t('{0} h', { 0: hours });
}

export type DayPart = 'Early' | 'Morning' | 'Afternoon' | 'Evening' | 'Night';
// ── Display preferences: date language and 12/24-hour clock ──────────────
export type TimeFormat = '24h' | '12h';
const PREFS_KEY = 'planner-display';
export const DATE_LANGUAGES = [
  { id: 'en-GB', label: 'English' },
  { id: 'device', label: 'Device language' },
  { id: 'fi', label: 'Suomi' },
  { id: 'sv', label: 'Svenska' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'fa', label: 'فارسی' },
] as const;
export type DateLanguage = (typeof DATE_LANGUAGES)[number]['id'];

let dateLanguage: DateLanguage = 'en-GB';
let timeFormat: TimeFormat = '24h';
let formatters: Record<string, Intl.DateTimeFormat> = {};

function resolvedLocale(): string {
  if (dateLanguage !== 'device') return dateLanguage;
  return (typeof navigator !== 'undefined' && navigator.language) || 'en-GB';
}

function fmt(name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  formatters[name] ??= (() => {
    try {
      // Latin digits keep the planner's layout consistent across languages.
      return new Intl.DateTimeFormat(resolvedLocale(), { numberingSystem: 'latn', calendar: 'gregory', ...options });
    } catch {
      return new Intl.DateTimeFormat('en-GB', options);
    }
  })();
  return formatters[name];
}

export interface DisplayPrefs {
  dateLanguage: DateLanguage;
  timeFormat: TimeFormat;
  /** Show the Jalali (Persian calendar) date alongside Gregorian dates. */
  jalali?: boolean;
}

export function loadDisplayPrefs(): DisplayPrefs {
  let jalali = false;
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { dateLanguage?: string; timeFormat?: string; jalali?: boolean };
    dateLanguage = DATE_LANGUAGES.some((item) => item.id === raw.dateLanguage) ? (raw.dateLanguage as DateLanguage) : 'en-GB';
    timeFormat = raw.timeFormat === '12h' ? '12h' : '24h';
    jalali = raw.jalali === true;
  } catch {
    dateLanguage = 'en-GB';
    timeFormat = '24h';
  }
  formatters = {};
  return { dateLanguage, timeFormat, jalali };
}

export function setDisplayPrefs(prefs: DisplayPrefs): void {
  dateLanguage = prefs.dateLanguage;
  timeFormat = prefs.timeFormat;
  formatters = {};
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

let jalaliFormatter: Intl.DateTimeFormat | null | undefined;

/** "29 شهریور 1404" — the Jalali date for an ISO day, null when unsupported. */
export function formatJalaliLong(iso: string): string | null {
  if (jalaliFormatter === undefined) {
    try {
      jalaliFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        numberingSystem: 'latn',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      jalaliFormatter = null;
    }
  }
  if (!jalaliFormatter) return null;
  try {
    return faDigits(jalaliFormatter.format(parseISODate(iso)));
  } catch {
    return null;
  }
}
/** "14:05" → "14:05" or "2:05 pm", following the user's clock preference. */
export function displayTime(value: string | null | undefined): string {
  if (!value || !isValidTime(value)) return value ?? '';
  if (timeFormat === '24h') return faDigits(value);
  const [hours, minutes] = value.split(':').map(Number);
  const suffix = hours < 12 ? t('am') : t('pm');
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  const label = minutes === 0 ? `${hour} ${suffix}` : `${hour}:${String(minutes).padStart(2, '0')} ${suffix}`;
  return faDigits(label);
}

/* Display formatting only: faDigits swaps in Eastern Arabic numerals when the
   UI language is Persian; every other language is returned untouched. */
const weekdayLong = { format: (date: Date) => faDigits(fmt('wl', { weekday: 'long' }).format(date)) };
const weekdayShort = { format: (date: Date) => faDigits(fmt('ws', { weekday: 'short' }).format(date)) };
const monthLong = { format: (date: Date) => faDigits(fmt('ml', { month: 'long' }).format(date)) };
const monthShort = { format: (date: Date) => faDigits(fmt('ms', { month: 'short' }).format(date)) };
const fullDate = { format: (date: Date) => faDigits(fmt('fd', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)) };
const monthYear = { format: (date: Date) => faDigits(fmt('my', { month: 'long', year: 'numeric' }).format(date)) };
const editedDate = { format: (date: Date) => faDigits(fmt('ed', { day: 'numeric', month: 'short' }).format(date)) };

export function formatWeekdayLong(iso: string): string {
  return weekdayLong.format(parseISODate(iso));
}

export function dayRelation(date: string, today: string): string {
  if (date === addDays(today, 1)) return t('Tomorrow');
  return formatWeekdayLong(date);
}

export function formatWeekdayShort(iso: string): string {
  return weekdayShort.format(parseISODate(iso)).replace('.', '');
}

export function formatMonthLong(iso: string): string {
  return monthLong.format(parseISODate(iso));
}

export function formatMonthShort(iso: string): string {
  return monthShort.format(parseISODate(iso)).replace('.', '');
}

export function formatFullDate(iso: string): string {
  return fullDate.format(parseISODate(iso));
}

export function formatMonthYear(year: number, month: number): string {
  return monthYear.format(new Date(year, month - 1, 1));
}

export function formatEdited(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return editedDate.format(date);
}

/* A timestamp with a clock time — "signed in", "added", "sent". Same date
   language and the same digits as every other date in the app: toLocaleString()
   follows the browser locale instead, so a Persian reader got Latin digits and
   someone who set Suomi got English month names. */
const stamp = { format: (date: Date) => faDigits(fmt('st', { day: 'numeric', month: 'short' }).format(date)) };

export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${stamp.format(date)} · ${displayTime(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)}`;
}

/** Day of month for display: Persian digits in fa, a plain number in English. */
export function dayNumber(iso: string): number | string {
  return faNum(parseISODate(iso).getDate());
}

export function isWeekend(iso: string): boolean {
  const day = parseISODate(iso).getDay();
  return day === 0 || day === 6;
}

/** The coming Saturday, or today when today is Saturday. */
export function nextWeekend(iso: string, saturday = 6): string {
  const date = parseISODate(iso);
  const diff = (saturday - date.getDay() + 7) % 7;
  return addDays(iso, diff);
}

/** The 1st of the month after the month containing `iso`. */
export function nextMonth(iso: string): string {
  const date = parseISODate(iso);
  return toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 1));
}

export function formatWeekRange(iso: string): string {
  const start = startOfWeek(iso);
  const end = addDays(start, 6);
  const startDate = parseISODate(start);
  const endDate = parseISODate(end);
  if (startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear()) {
    return faDigits(`${startDate.getDate()}–${endDate.getDate()} ${formatMonthLong(end)} ${endDate.getFullYear()}`);
  }
  const endYear = endDate.getFullYear();
  const startLabel =
    startDate.getFullYear() === endYear
      ? `${startDate.getDate()} ${formatMonthShort(start)}`
      : `${startDate.getDate()} ${formatMonthShort(start)} ${startDate.getFullYear()}`;
  return faDigits(`${startLabel} – ${endDate.getDate()} ${formatMonthShort(end)} ${endYear}`);
}

export function motivationFor(iso: string): string {
  const date = parseISODate(iso);
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return t(MOTIVATION[Math.abs(day) % MOTIVATION.length] ?? MOTIVATION[0]);
}

export function localDateFromTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return todayISO();
  return toISODate(date);
}

export function weekdayIndex(iso: string): number {
  return parseISODate(iso).getDay();
}

export const WEEKDAY_TOGGLES = [
  { day: 1, get label() { return t('Mon'); } },
  { day: 2, get label() { return t('Tue'); } },
  { day: 3, get label() { return t('Wed'); } },
  { day: 4, get label() { return t('Thu'); } },
  { day: 5, get label() { return t('Fri'); } },
  { day: 6, get label() { return t('Sat'); } },
  { day: 0, get label() { return t('Sun'); } },
] as const;
