import { MOTIVATION } from './constants';

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

export function startOfWeek(iso: string): string {
  const date = parseISODate(iso);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
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
  const offset = (first.getDay() + 6) % 7;
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

export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export type DayPart = 'Early' | 'Morning' | 'Afternoon' | 'Evening' | 'Night';

export const DAY_PARTS: DayPart[] = ['Early', 'Morning', 'Afternoon', 'Evening', 'Night'];

export function dayPart(time: string): DayPart {
  const minutes = timeToMinutes(time);
  if (minutes < 5 * 60) return 'Early';
  if (minutes < 12 * 60) return 'Morning';
  if (minutes < 17 * 60) return 'Afternoon';
  if (minutes < 22 * 60) return 'Evening';
  return 'Night';
}

export function dayPartLabel(part: DayPart): string {
  if (part === 'Early') return 'Early hours';
  return part;
}

const weekdayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const weekdayShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const monthLong = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const monthShort = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const fullDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const editedDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function formatWeekdayLong(iso: string): string {
  return weekdayLong.format(parseISODate(iso));
}

export function dayRelation(date: string, today: string): string {
  if (date === addDays(today, 1)) return 'Tomorrow';
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

export function dayNumber(iso: string): number {
  return parseISODate(iso).getDate();
}

export function isWeekend(iso: string): boolean {
  const day = parseISODate(iso).getDay();
  return day === 0 || day === 6;
}

export function formatWeekRange(iso: string): string {
  const start = startOfWeek(iso);
  const end = addDays(start, 6);
  const startDate = parseISODate(start);
  const endDate = parseISODate(end);
  if (startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear()) {
    return `${startDate.getDate()}–${endDate.getDate()} ${formatMonthLong(end)} ${endDate.getFullYear()}`;
  }
  const endYear = endDate.getFullYear();
  const startLabel =
    startDate.getFullYear() === endYear
      ? `${startDate.getDate()} ${formatMonthShort(start)}`
      : `${startDate.getDate()} ${formatMonthShort(start)} ${startDate.getFullYear()}`;
  return `${startLabel} – ${endDate.getDate()} ${formatMonthShort(end)} ${endYear}`;
}

export function motivationFor(iso: string): string {
  const date = parseISODate(iso);
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return MOTIVATION[Math.abs(day) % MOTIVATION.length] ?? MOTIVATION[0];
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
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
] as const;
