export const NAVIGATION_PAGES = ['today', 'calendar', 'tasks', 'matrix', 'habits', 'goals', 'notes', 'plans', 'insights', 'ai'] as const;
export type NavigationPage = (typeof NAVIGATION_PAGES)[number];

const KEY = 'planner-sidebar-pages';
const CHANGE_EVENT = 'planner-sidebar-pages-change';
export const DEFAULT_NAVIGATION_PAGES: NavigationPage[] = [...NAVIGATION_PAGES];

export function loadNavigationPages(): NavigationPage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (!Array.isArray(raw)) return DEFAULT_NAVIGATION_PAGES;
    const allowed = new Set<string>(NAVIGATION_PAGES);
    const selected = [...new Set(raw.filter((value): value is NavigationPage => typeof value === 'string' && allowed.has(value)))];
    // Today is the reliable home destination and can never be hidden.
    return ['today', ...selected.filter((page) => page !== 'today')];
  } catch {
    return DEFAULT_NAVIGATION_PAGES;
  }
}

export function saveNavigationPages(pages: NavigationPage[]): void {
  const allowed = new Set<string>(NAVIGATION_PAGES);
  const selected = [...new Set(pages.filter((page): page is NavigationPage => allowed.has(page)))];
  const value: NavigationPage[] = ['today', ...selected.filter((page) => page !== 'today')];
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* optional preference */ }
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
