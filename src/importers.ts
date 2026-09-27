/**
 * Import tasks from other apps as CSV.
 *
 * Supported shapes:
 * - Todoist:  TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE
 * - TickTick: Folder Name,List Name,Title,Kind,Tags,Content,...,Due Date,...,Priority,Status,...
 * - Generic:  any header with a title-like column plus optional date/priority columns.
 */
import type { Priority } from './constants';
import type { TaskInput } from './types';
import { isValidISODate, isValidTime } from './dates';

export interface TaskListImport {
  tasks: TaskInput[];
  skipped: number;
  /** Rows already completed in the source app (not imported). */
  done: number;
  format: 'todoist' | 'ticktick' | 'generic';
}

const MAX_IMPORT = 2000;

/** RFC-4180-ish CSV: quoted fields, escaped quotes, embedded newlines. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"' && field.trim() === '') quoted = true;
    else if (char === ',') pushField();
    else if (char === '\n') pushRow();
    else if (char === '\r') {
      /* dropped; \n handles the break */
    } else field += char;
    i += 1;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows.slice(0, MAX_IMPORT + 1);
}

function findColumn(header: string[], ...names: string[]): number {
  const lower = header.map((cell) => cell.trim().toLowerCase());
  for (const name of names) {
    const index = lower.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function parseDateCell(raw: string): { date: string; time: string | null } | null {
  const text = raw.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text);
  if (iso && isValidISODate(iso[1])) {
    const time = iso[2] !== undefined ? `${iso[2]}:${iso[3]}` : null;
    return { date: iso[1], time: time && isValidTime(time) ? time : null };
  }
  const euro = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{2}):(\d{2}))?/.exec(text);
  if (euro) {
    const date = `${euro[3]}-${euro[2].padStart(2, '0')}-${euro[1].padStart(2, '0')}`;
    if (isValidISODate(date)) {
      const time = euro[4] !== undefined ? `${euro[4]}:${euro[5]}` : null;
      return { date, time: time && isValidTime(time) ? time : null };
    }
  }
  return null;
}

function todoistPriority(raw: string): Priority {
  // Todoist CSV: 4 = p1 (highest) … 1 = p4 (lowest)
  if (raw.trim() === '4') return 'high';
  if (raw.trim() === '3') return 'medium';
  return 'low';
}

function ticktickPriority(raw: string): Priority {
  // TickTick CSV: 5 = High, 3 = Medium, 1 = Low, 0 = none
  const value = raw.trim();
  if (value === '5') return 'high';
  if (value === '3') return 'medium';
  if (value === '1') return 'low';
  return 'medium';
}

export function parseTaskCSV(text: string): TaskListImport {
  const rows = parseCsvRows(text);
  const empty: TaskListImport = { tasks: [], skipped: 0, done: 0, format: 'generic' };
  if (rows.length < 2) return empty;
  const header = rows[0];
  const contentCol = findColumn(header, 'content');
  const dateCol = findColumn(header, 'date', 'due date', 'due', 'deadline', 'due_date');
  // TickTick first: its export also has Content/Priority/Due-Date columns and would masquerade as Todoist.
  const isTickTick = findColumn(header, 'folder name', 'list name') >= 0 && findColumn(header, 'priority', 'status') >= 0;
  const isTodoist = !isTickTick && contentCol >= 0 && findColumn(header, 'priority') >= 0 && dateCol >= 0;
  const titleCandidate = findColumn(header, 'title', 'task', 'todo', 'item', 'name');
  const titleCol = isTodoist ? contentCol : titleCandidate >= 0 ? titleCandidate : contentCol >= 0 ? contentCol : 0;
  const priorityCol = findColumn(header, 'priority', 'prio');
  const statusCol = findColumn(header, 'status');
  const descCol = findColumn(header, 'description', 'content', 'notes', 'note');
  const listCol = findColumn(header, 'list name', 'project name', 'project');
  const completedCol = findColumn(header, 'completed time');

  const format: TaskListImport['format'] = isTodoist ? 'todoist' : isTickTick ? 'ticktick' : 'generic';
  const out: TaskInput[] = [];
  let skipped = 0;
  let done = 0;
  for (const row of rows.slice(1)) {
    if (out.length >= MAX_IMPORT) {
      skipped += 1;
      continue;
    }
    // Already-finished items are left behind rather than recreated as open work.
    const status = statusCol >= 0 ? row[statusCol]?.trim() : '';
    if ((isTickTick && (status === '2' || (completedCol >= 0 && Boolean(row[completedCol]?.trim()))))) {
      done += 1;
      continue;
    }
    const title = (row[titleCol] ?? '').trim().slice(0, 140);
    if (!title) {
      skipped += 1;
      continue;
    }
    // Todoist uses INDENT for sub-items; flattening them keeps titles instead of losing them.
    const due = dateCol >= 0 ? parseDateCell(row[dateCol] ?? '') : null;
    const noteParts: string[] = [];
    if (!isTodoist && descCol >= 0 && descCol !== titleCol) noteParts.push(row[descCol] ?? '');
    if (listCol >= 0 && row[listCol]?.trim()) noteParts.push(`(${row[listCol].trim()})`);
    out.push({
      title,
      priority: priorityCol >= 0 ? (isTodoist ? todoistPriority(row[priorityCol] ?? '') : isTickTick ? ticktickPriority(row[priorityCol] ?? '') : 'medium') : 'medium',
      dueDate: due?.date ?? null,
      dueTime: due?.time ?? null,
      category: isTickTick || listCol >= 0 ? 'personal' : 'personal',
      note: noteParts.join('\n').trim().slice(0, 4000),
      goalId: null,
    });
  }
  return { tasks: out, skipped, done, format };
}
