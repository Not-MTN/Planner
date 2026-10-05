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
  | { name: 'plans' }
  | { name: 'matrix' }
  | { name: 'review' }
  /** Optional panels: off until the user adds them, and never replace the planner. */
  /** `invite` comes from scanning a guardian's QR code: a code to fill in, not a command. */
  | { name: 'panels'; invite?: string }
  | { name: 'student' }
  | { name: 'guardian' }
  | { name: 'quickadd' }
  | { name: 'ai'; tab?: 'plan' | 'review' };

const PLAIN_NAMES = new Set(['today', 'tasks', 'habits', 'goals', 'notes', 'insights', 'plans', 'matrix', 'review', 'student', 'guardian']);
/**
 * Every head `parseHash` knows, including the legacy aliases. This is what
 * tells an address that belongs to the app from one that does not: a link
 * handed to the browser, or delivered to the installed app, is only followed
 * when its hash names a real destination. Keep it in step with `parseHash`.
 */
const APP_HEADS = new Set([
  ...PLAIN_NAMES,
  'ai',
  'day',
  'calendar',
  'quickadd',
  'panels',
  'daily',
  'weekly',
  'month',
  'monthly',
  'future',
  'progress',
]);
const CALENDAR_TABS = new Set(['week', 'month', 'agenda']);

export function calendarDateFor(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** The address a student lands on when they scan a guardian's QR code. */
export function inviteHash(code: string): string {
  return `#/panels?invite=${encodeURIComponent(code)}`;
}

/** The whole link, for a QR code or a message. Relative to wherever it is shown. */
export function inviteLink(code: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/${inviteHash(code)}`;
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
  // A scanned invite arrives as a link, not as something typed. The code rides
  // along in the address and is taken out of it as soon as it is read.
  if (head === 'panels') {
    const invite = /(?:^|&)invite=([^&]*)/.exec(queryPart ?? '')?.[1];
    const code = invite ? decodeURIComponent(invite).trim() : '';
    return code ? { name: 'panels', invite: code } : { name: 'panels' };
  }
  if (PLAIN_NAMES.has(head)) return { name: head as 'today' };
  return { name: 'today' };
}

/**
 * The route a hash names, or null when the hash is not ours.
 *
 * `parseHash` answers every address with something — an unknown hash is simply
 * `today`, which is right for a planner someone already has open and wrong for
 * a link arriving from outside. Anything deciding "should this address open
 * the app?" has to be able to hear "no", and this is that answer.
 */
export function appRouteFromHash(hash: string): Route | null {
  const clean = hash.replace(/^#\/?/, '');
  const head = (clean.split('?')[0] ?? '').split('/').filter(Boolean)[0];
  if (!head || !APP_HEADS.has(head)) return null;
  return parseHash(hash);
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
    case 'panels':
      return route.invite ? inviteHash(route.invite) : '#/panels';
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
    case 'plans':
      return 'Plans';
    case 'matrix':
      return 'Matrix';
    case 'review':
      return 'Weekly Review';
    case 'panels':
      return 'Panels';
    case 'student':
      return 'Student panel';
    case 'guardian':
      return 'Guardian panel';
    case 'quickadd':
      return 'Quick add';
    case 'ai':
      return route.tab === 'review' ? 'AI review' : 'AI planner';
  }
}
