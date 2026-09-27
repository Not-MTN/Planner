import { isValidISODate, todayISO } from './dates';

export type Route =
  | { name: 'today' }
  | { name: 'daily'; date: string }
  | { name: 'weekly'; date: string }
  | { name: 'monthly'; year: number; month: number }
  | { name: 'tasks' }
  | { name: 'habits' }
  | { name: 'goals' }
  | { name: 'notes' }
  | { name: 'progress' }
  | { name: 'future' };

const NAMES = new Set(['today', 'tasks', 'habits', 'goals', 'notes', 'progress', 'future']);

export function parseHash(hash: string, now = new Date()): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [name, a, b] = parts;
  if (name === 'daily' && a && isValidISODate(a)) return { name: 'daily', date: a };
  if (name === 'weekly' && a && isValidISODate(a)) return { name: 'weekly', date: a };
  if (name === 'month' || name === 'monthly') {
    const year = Number(a);
    const month = Number(b);
    if (Number.isInteger(year) && year >= 1970 && year <= 2100 && Number.isInteger(month) && month >= 1 && month <= 12) {
      return { name: 'monthly', year, month };
    }
    return {
      name: 'monthly',
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };
  }
  if (name && NAMES.has(name)) return { name: name as 'today' };
  return { name: 'today' };
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'today':
      return '#/today';
    case 'daily':
      return `#/daily/${route.date}`;
    case 'weekly':
      return `#/weekly/${route.date}`;
    case 'monthly':
      return `#/month/${route.year}/${route.month}`;
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
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Week';
    case 'monthly':
      return 'Month';
    case 'tasks':
      return 'Tasks';
    case 'habits':
      return 'Habits';
    case 'goals':
      return 'Goals';
    case 'notes':
      return 'Notes';
    case 'progress':
      return 'Progress';
    case 'future':
      return 'Future';
  }
}

export function todayRouteDate(now = new Date()): string {
  return todayISO(now);
}
