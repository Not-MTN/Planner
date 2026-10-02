export const NAVIGATION_PAGES = ['today', 'calendar', 'tasks', 'matrix', 'habits', 'goals', 'notes', 'plans', 'insights', 'ai'] as const;
export type NavigationPage = (typeof NAVIGATION_PAGES)[number];

export const MAX_MOBILE_FAVORITES = 4;

const KEY = 'planner-sidebar-pages';
const MOBILE_FAVORITES_KEY = 'planner-mobile-favorites';
const CHANGE_EVENT = 'planner-sidebar-pages-change';
export const DEFAULT_NAVIGATION_PAGES: NavigationPage[] = [...NAVIGATION_PAGES];

function validPages(values: unknown[]): NavigationPage[] {
  const allowed = new Set<string>(NAVIGATION_PAGES);
  return [...new Set(values.filter((value): value is NavigationPage => typeof value === 'string' && allowed.has(value)))];
}

export function loadNavigationPages(): NavigationPage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (!Array.isArray(raw)) return [...DEFAULT_NAVIGATION_PAGES];
    const selected = validPages(raw);
    // Today is the reliable home destination and can never be hidden.
    return ['today', ...selected.filter((page) => page !== 'today')];
  } catch {
    return [...DEFAULT_NAVIGATION_PAGES];
  }
}

export function saveNavigationPages(pages: NavigationPage[]): void {
  const value: NavigationPage[] = ['today', ...validPages(pages).filter((page) => page !== 'today')];
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* optional preference */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Pages the user wants at the top of the mobile More sheet, in chosen order. */
export function loadMobileFavorites(): NavigationPage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MOBILE_FAVORITES_KEY) ?? 'null') as unknown;
    return Array.isArray(raw) ? validPages(raw).slice(0, MAX_MOBILE_FAVORITES) : [];
  } catch {
    return [];
  }
}

export function moveMobileFavorite(pages: NavigationPage[], page: NavigationPage, direction: 'up' | 'down'): NavigationPage[] {
  const next = validPages(pages).slice(0, MAX_MOBILE_FAVORITES);
  const from = next.indexOf(page);
  const to = from + (direction === 'up' ? -1 : 1);
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function saveMobileFavorites(pages: NavigationPage[]): void {
  const value = validPages(pages).slice(0, MAX_MOBILE_FAVORITES);
  try { localStorage.setItem(MOBILE_FAVORITES_KEY, JSON.stringify(value)); } catch { /* optional preference */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeNavigationPages(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
