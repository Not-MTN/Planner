import { isValidISODate, isValidTime, toISODate } from './dates';
import { rruleFor } from './recurrence';
import { downloadBlob } from './download';
import type { EventInput, PlannerState, TaskInput } from './types';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_IMPORT = 1000;

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** Lines longer than 75 octets must be folded (RFC 5545 §3.1). */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73));
  return parts.join('\r\n');
}

function stamp(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

function utcStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
}

/** Upcoming weekday date (today or later) for a protected weekly slot. */
function nextWeekday(weekday: number, from: Date): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
  return toISODate(date);
}

export function toICS(state: PlannerState, now = new Date()): string {
  const dtstamp = utcStamp(now.toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planner//Local-first planner//EN', 'CALSCALE:GREGORIAN'];
  for (const event of state.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@planner`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(event.date, event.startTime)}`,
      `DTEND:${stamp(event.date, event.endTime ?? addHour(event.startTime))}`,
      `SUMMARY:${escapeText(event.title)}`,
    );
    if (event.note) lines.push(`DESCRIPTION:${escapeText(event.note)}`);
    if (event.repeat) lines.push(`RRULE:${rruleFor(event.repeat)}`);
    lines.push(`CATEGORIES:${escapeText(event.category)}`, 'END:VEVENT');
  }
  for (const block of state.fixedCommitments) {
    const first = nextWeekday(block.weekday, now);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${block.id}@planner-weekly`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(first, block.startTime)}`,
      `DTEND:${stamp(first, block.endTime)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[block.weekday]}`,
      `SUMMARY:${escapeText(block.title)}`,
      'END:VEVENT',
    );
  }
  for (const task of state.tasks) {
    if (!task.dueDate) continue;
    lines.push('BEGIN:VTODO', `UID:${task.id}@planner-task`, `DTSTAMP:${dtstamp}`);
    lines.push(task.dueTime ? `DUE:${stamp(task.dueDate, task.dueTime)}` : `DUE;VALUE=DATE:${task.dueDate.replace(/-/g, '')}`);
    lines.push(`SUMMARY:${escapeText(task.title)}`, `STATUS:${task.completed ? 'COMPLETED' : 'NEEDS-ACTION'}`);
    if (task.note) lines.push(`DESCRIPTION:${escapeText(task.note)}`);
    lines.push('END:VTODO');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function addHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface Parsed {
  date: string;
  time: string | null;
}

function parseDateValue(value: string, params: string): Parsed | null {
  const allDay = /VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(value);
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, , z] = match;
  if (allDay || h === undefined) {
    const date = `${y}-${mo}-${d}`;
    return isValidISODate(date) ? { date, time: null } : null;
  }
  if (z) {
    // UTC — convert to the user's local time.
    const local = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
    return { date: toISODate(local), time: `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}` };
  }
  // Floating or TZID time: treat as local wall time.
  const date = `${y}-${mo}-${d}`;
  const time = `${h}:${mi}`;
  return isValidISODate(date) && isValidTime(time) ? { date, time } : null;
}

export interface ICSEventInput extends EventInput {
  /** ORIGINAL VEVENT UID — lets feed subscriptions refresh without duplicating. */
  uid?: string;
}

export interface ICSImport {
  events: ICSEventInput[];
  tasks: TaskInput[];
  skipped: number;
}

/** Reads VEVENTs from an .ics file. Timed events become events; all-day events become dated tasks. */
export function parseICS(text: string): ICSImport {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: ICSEventInput[] = [];
  const tasks: TaskInput[] = [];
  let skipped = 0;
  let current: Record<string, { value: string; params: string }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const summary = unescapeText(current.SUMMARY?.value ?? '').trim().slice(0, 140);
        const start = current.DTSTART ? parseDateValue(current.DTSTART.value, current.DTSTART.params) : null;
        const end = current.DTEND ? parseDateValue(current.DTEND.value, current.DTEND.params) : null;
        const note = unescapeText(current.DESCRIPTION?.value ?? '').slice(0, 4000);
        const uid = (current.UID?.value ?? '').trim().slice(0, 200) || undefined;
        if (!summary || !start || events.length + tasks.length >= MAX_IMPORT) {
          skipped += 1;
        } else if (!start.time) {
          tasks.push({ title: summary, priority: 'medium', dueDate: start.date, dueTime: null, category: 'personal', note, goalId: null });
        } else {
          const endTime = end && end.date === start.date && end.time && end.time > start.time ? end.time : null;
          events.push({ title: summary, date: start.date, startTime: start.time, endTime, category: 'personal', note, important: false, uid });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const [name, ...params] = head.split(';');
    current[name.toUpperCase()] = { value: line.slice(colon + 1), params: params.join(';') };
  }
  return { events, tasks, skipped };
}

export function toBusyICS(state: PlannerState, now = new Date()): string {
  const dtstamp = utcStamp(now.toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planner//Busy times//EN', 'CALSCALE:GREGORIAN'];
  for (const event of state.events) {
    if (event.completed) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@planner-busy`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(event.date, event.startTime)}`,
      `DTEND:${stamp(event.date, event.endTime ?? addHour(event.startTime))}`,
      'SUMMARY:Busy',
      'TRANSP:OPAQUE',
    );
    if (event.repeat) lines.push(`RRULE:${rruleFor(event.repeat)}`);
    lines.push('END:VEVENT');
  }
  for (const block of state.fixedCommitments) {
    const first = nextWeekday(block.weekday, now);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${block.id}@planner-busy-weekly`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(first, block.startTime)}`,
      `DTEND:${stamp(first, block.endTime)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[block.weekday]}`,
      'SUMMARY:Busy',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function triggerDownload(body: string, name: string): void {
  downloadBlob(new Blob([body], { type: 'text/calendar' }), name);
}

export function downloadICS(state: PlannerState, date: string): void {
  triggerDownload(toICS(state), `planner-${date}.ics`);
}

export function downloadBusyICS(state: PlannerState, date: string): void {
  triggerDownload(toBusyICS(state), `planner-busy-${date}.ics`);
}
