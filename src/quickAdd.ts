import { CATEGORIES, PRIORITIES, type Priority } from './constants';
import { addDays, formatMonthShort, formatWeekdayShort, isValidISODate, parseISODate, todayISO } from './dates';

export interface QuickAddParse {
  kind: 'task' | 'event';
  title: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  priority: Priority | null;
  category: string | null;
  chips: string[];
}

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const RANGE_JOINS = new Set(['to', 'till', 'until', 'through', 'thru']);

interface Token {
  text: string;
  used: boolean;
}

interface TimeParts {
  hour: number;
  minute: number;
  meridiem: 'am' | 'pm' | null;
  explicit: boolean;
}

function parseTimeToken(raw: string): TimeParts | null {
  const text = raw.toLowerCase();
  if (text === 'noon') return { hour: 12, minute: 0, meridiem: 'pm', explicit: true };
  if (text === 'midnight') return { hour: 0, minute: 0, meridiem: 'am', explicit: true };
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = (match[3] as 'am' | 'pm' | undefined) ?? null;
  if (hour === 0 && minute === 0 && !meridiem) return null; // "0" is rarely a time
  return { hour, minute, meridiem, explicit: Boolean(meridiem) || match[2] !== undefined };
}

function toClock(parts: TimeParts, inherit?: 'am' | 'pm' | null): string | null {
  let hour = parts.hour;
  const meridiem = parts.meridiem ?? inherit ?? null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || parts.minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function splitRange(raw: string): [string, string] | null {
  const text = raw.replace(/–|—/g, '-');
  const match = /^(\S+)-(\S+)$/.exec(text);
  if (!match) return null;
  return [match[1], match[2]];
}

function parsePriorityToken(raw: string): Priority | null {
  const text = raw.toLowerCase().replace(/!+$/, '');
  if (raw === '!!!') return 'high';
  if (raw === '!!') return 'medium';
  if (raw === '!') return 'low';
  if (!text.startsWith('!')) return null;
  const word = text.slice(1);
  if (['high', 'hi', 'important', 'urgent', 'must'].includes(word)) return 'high';
  if (['medium', 'med', 'normal', 'mid'].includes(word)) return 'medium';
  if (['low', 'later', 'someday', 'lowkey'].includes(word)) return 'low';
  return null;
}

function parseCategoryToken(raw: string): string | null {
  if (!raw.startsWith('#')) return null;
  const word = raw.slice(1).toLowerCase();
  if (!word) return null;
  const match = CATEGORIES.find(
    (item) => item.id === word || item.label.toLowerCase().replace(/[^a-z]/g, '') === word,
  );
  return match ? match.id : null;
}

function weekdayDate(word: string, today: string, next: boolean): string {
  const target = WEEKDAYS[word];
  const current = parseISODate(today).getDay();
  let ahead = (target - current + 7) % 7;
  if (next) ahead = ahead === 0 ? 7 : ahead + 7;
  return addDays(today, ahead);
}

function describeDate(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const diff = Math.round((parseISODate(date).getTime() - parseISODate(today).getTime()) / 86400000);
  if (diff > 1 && diff <= 6) return formatWeekdayShort(date);
  return `${formatWeekdayShort(date)} ${parseISODate(date).getDate()} ${formatMonthShort(date)}`;
}

function labelPriority(priority: Priority): string {
  return PRIORITIES.find((item) => item.id === priority)?.label ?? 'Medium';
}

function labelCategory(category: string): string {
  return CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

export function parseQuickAdd(input: string, defaultDate: string | null): QuickAddParse | null {
  const rawTokens = input.trim().split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return null;
  const tokens: Token[] = rawTokens.map((text) => ({ text, used: false }));
  const today = todayISO();

  let priority: Priority | null = null;
  let category: string | null = null;
  let date: string | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;
  let rangeFound = false;

  const use = (index: number) => {
    if (index >= 0 && index < tokens.length) tokens[index].used = true;
  };
  const isFree = (index: number) => index >= 0 && index < tokens.length && !tokens[index].used;

  // Categories and priorities first — they are unambiguous.
  for (const token of tokens) {
    if (token.used) continue;
    const cat = parseCategoryToken(token.text);
    if (cat) {
      category = cat;
      token.used = true;
      continue;
    }
    const prio = parsePriorityToken(token.text);
    if (prio) {
      priority = prio;
      token.used = true;
    }
  }

  // Date phrases.
  for (let i = 0; i < tokens.length; i += 1) {
    if (!isFree(i)) continue;
    const word = tokens[i].text.toLowerCase().replace(/[.,]$/, '');
    const previous = i > 0 ? tokens[i - 1].text.toLowerCase() : '';
    const beforePrevious = i > 1 ? tokens[i - 2].text.toLowerCase() : '';
    let parsed: string | null = null;
    let span = 1;
    if (word === 'today' || word === 'tod') parsed = today;
    else if (word === 'tomorrow' || word === 'tmr' || word === 'tmrw' || word === 'tom') parsed = addDays(today, 1);
    else if (WEEKDAYS[word] !== undefined) {
      parsed = weekdayDate(word, today, previous === 'next');
      if (previous === 'next' || previous === 'on') span = 2;
    } else if (word === 'week' && previous === 'next') {
      parsed = addDays(today, 7);
      span = 2;
    } else if (word === 'days' || word === 'day' || word === 'weeks' || word === 'week') {
      const amount = Number(previous);
      if (Number.isInteger(amount) && amount >= 1 && amount <= 366 && beforePrevious === 'in') {
        parsed = addDays(today, word.startsWith('week') ? amount * 7 : amount);
        span = 3;
      }
    } else if (isValidISODate(tokens[i].text)) {
      parsed = tokens[i].text;
      if (previous === 'on') span = 2;
    }
    if (!parsed) continue;
    date = parsed;
    for (let k = i - (span - 1); k <= i; k += 1) use(k);
  }

  // Time ranges create events. Checked before single times.
  for (let i = 0; i < tokens.length; i += 1) {
    if (!isFree(i)) continue;
    let left: TimeParts | null = null;
    let right: TimeParts | null = null;
    let span = 0;
    const dash = splitRange(tokens[i].text);
    if (dash) {
      left = parseTimeToken(dash[0]);
      right = parseTimeToken(dash[1]);
      span = 1;
    } else if (isFree(i + 2) && RANGE_JOINS.has(tokens[i + 1].text.toLowerCase().replace(/[.,]$/, ''))) {
      left = parseTimeToken(tokens[i].text);
      right = parseTimeToken(tokens[i + 2].text);
      span = 3;
    }
    if (!left || !right) continue;
    const leftClock = toClock(left, right.meridiem ?? left.meridiem);
    const rightClock = toClock(right, left.meridiem);
    if (!leftClock || !rightClock || rightClock <= leftClock) continue;
    const hasMeridiem = Boolean(left.meridiem || right.meridiem);
    const hasColon = left.explicit || right.explicit;
    if (!hasMeridiem && !hasColon) continue; // avoid turning "9-1-1" into times
    if (i > 0 && isFree(i - 1) && ['from', 'at'].includes(tokens[i - 1].text.toLowerCase())) use(i - 1);
    for (let k = i; k < i + span; k += 1) use(k);
    startTime = leftClock;
    endTime = rightClock;
    rangeFound = true;
    break;
  }

  // A single time.
  if (!rangeFound) {
    for (let i = 0; i < tokens.length; i += 1) {
      if (!isFree(i)) continue;
      const parts = parseTimeToken(tokens[i].text);
      if (!parts) continue;
      const previous = i > 0 ? tokens[i - 1].text.toLowerCase() : '';
      const afterAt = ['at', '@', 'from'].includes(previous) && isFree(i - 1);
      if (!parts.explicit && !afterAt) continue;
      const clock = toClock(parts);
      if (!clock) continue;
      if (afterAt) use(i - 1);
      use(i);
      startTime = clock;
      break;
    }
  }

  const title = tokens
    .filter((token) => !token.used)
    .map((token) => token.text)
    .join(' ')
    .replace(/\s+(at|from|on|to|-|–)$/i, '')
    .replace(/^(at|from|on|to|-|–)\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!title) return null;

  const kind: 'task' | 'event' = rangeFound ? 'event' : 'task';
  const resolvedDate = date ?? (kind === 'event' ? defaultDate ?? today : defaultDate);

  const chips: string[] = [kind === 'event' ? 'Event' : 'Task'];
  if (resolvedDate) chips.push(describeDate(resolvedDate, today));
  if (startTime) chips.push(endTime ? `${startTime} – ${endTime}` : startTime);
  if (priority) chips.push(labelPriority(priority));
  if (category) chips.push(labelCategory(category));

  return {
    kind,
    title,
    date: resolvedDate,
    startTime,
    endTime,
    priority,
    category,
    chips,
  };
}
