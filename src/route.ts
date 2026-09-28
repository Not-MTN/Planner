import { formatFullDate, isValidISODate, todayISO } from './dates';

export type CalendarTab = 'week' | 'month' | 'agenda';

export type Route =
  | { name: 'today' }
  | { name: 'day'; date: string }
  | { name: 'calendar'; tab: CalendarTab; date: string }
  | { name: 'tasks' }
  | { name: 'habits' }
  | { name: 'goals' }
  | { name: 'notes' }
  | { name: 'insights' }
  | { name: 'quickadd' }
  | { name: 'ai'; tab?: 'plan' | 'review' };

const PLAIN_NAMES = new Set(['today', 'tasks', 'habits', 'goals', 'notes', 'insights']);
const CALENDAR_TABS = new Set(['week', 'month', 'agenda']);

export function calendarDateFor(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function parseHash(hash: string, now = new Date()): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = clean.split('?');
  const parts = (pathPart ?? '').split('/').filter(Boolean);
  const [head, a, b] = parts;
  const today = todayISO(now);
  if (head === 'today' && /(^|&)qa=1(&|$)/.test(queryPart ?? '')) return { name: 'quickadd' };
  if (!head || head === 'today') return { name: 'today' };
  if (head === 'ai') return { name: 'ai', tab: a === 'review' ? 'review' : 'plan' };
  if (head === 'day' && a && isValidISODate(a)) return { name: 'day', date: a };
  if (head === 'calendar' && !a) return { name: 'calendar', tab: 'week', date: today };
  if (head === 'calendar' && a && CALENDAR_TABS.has(a)) {
    return { name: 'calendar', tab: a as CalendarTab, date: b && isValidISODate(b) ? b : today };
  }
  // Legacy routes from earlier versions keep working.
  if (head === 'daily' && a && isValidISODate(a)) return { name: 'day', date: a };
  if (head === 'weekly' && a && isValidISODate(a)) return { name: 'calendar', tab: 'week', date: a };
  if (head === 'month' || head === 'monthly') {
    const year = Number(a);
    const month = Number(b);
    if (Number.isInteger(year) && year >= 1970 && year <= 2100 && Number.isInteger(month) && month >= 1 && month <= 12) {
      return { name: 'calendar', tab: 'month', date: calendarDateFor(year, month) };
    }
    return { name: 'calendar', tab: 'month', date: today };
  }
  if (head === 'future') return { name: 'calendar', tab: 'agenda', date: today };
  if (head === 'progress') return { name: 'insights' };
  if (head === 'quickadd') return { name: 'quickadd' };
  if (PLAIN_NAMES.has(head)) return { name: head as 'today' };
  return { name: 'today' };
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'quickadd':
      // Deep link (PWA shortcut): today with the quick-add bar focused.
      return '#/today?qa=1';
    case 'today':
      return '#/today';
    case 'day':
      return `#/day/${route.date}`;
    case 'calendar':
      return `#/calendar/${route.tab}/${route.date}`;
    case 'ai':
      return route.tab === 'review' ? '#/ai/review' : '#/ai';
    default:
      return `#/${route.name}`;
  }
}

export function routeKey(route: Route): string {
  return toHash(route);
}

export function routeTitle(route: Route): string {
  switch (route.name) {
    case 'today':
      return 'Today';
    case 'day':
      return formatFullDate(route.date);
    case 'calendar':
      return 'Calendar';
    case 'tasks':
      return 'Tasks';
    case 'habits':
      return 'Habits';
    case 'goals':
      return 'Goals';
    case 'notes':
      return 'Notes';
    case 'insights':
      return 'Insights';
    case 'quickadd':
      return 'Quick add';
    case 'ai':
      return route.tab === 'review' ? 'AI review' : 'AI planner';
  }
}
