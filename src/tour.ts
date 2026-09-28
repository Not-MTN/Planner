/**
 * First-run tour: a showcase that plays ONCE, on the very first visit, and
 * can be replayed from the sidebar (?) / More sheet / Settings. It walks the
 * actual pages — one stop per tab, teaching only the most useful thing on
 * each — instead of listing every button on one screen. Storage-only logic
 * lives here so it stays unit-testable; the visual layer is TourSheet.
 *
 * The very first step is a language choice. Switching language reloads the
 * page (the Settings pattern), so the tour persists its resume point across
 * that reload.
 */

import type { Route } from './route';

const DONE_KEY = 'planner-tour-done';
const RESUME_KEY = 'planner-tour-resume';

/** Tour stop ids, in order. Step 'lang' is the bilingual language chooser. */
export const TOUR_STOPS = [
  'lang',
  'today',
  'ai',
  'plans',
  'tasks',
  'habits',
  'goals',
  'notes',
  'insights',
  'calendar',
  'search',
  'settings',
  'done',
] as const;
export type TourStopId = (typeof TOUR_STOPS)[number];

export const TOUR_LENGTH = TOUR_STOPS.length;

/** Number of teaching stops (everything except the language chooser). */
export const TOUR_CONTENT_STEPS = TOUR_LENGTH - 1;

/**
 * Which layout element to spotlight for each stop (null = centred bubble).
 * Every selector is a data-tour attribute (or a stable card class) so
 * theme/class renames can't break the tour; TourSheet resolves the FIRST
 * VISIBLE match (sidebar vs tabbar duplicates).
 */
export const TOUR_SELECTORS: Record<TourStopId, string | null> = {
  lang: null,
  today: '.hero-panel',
  ai: '.voice-card',
  plans: '[data-tour="plans-page"]',
  tasks: '[data-tour="tasks-page"]',
  habits: '[data-tour="habits-page"]',
  goals: '[data-tour="goals-page"]',
  notes: '[data-tour="notes-page"]',
  insights: '[data-tour="insights-page"]',
  calendar: '[data-tour="calendar-page"]',
  search: '[data-tour="search"]',
  settings: '[data-tour="settings"]',
  done: null,
};

/**
 * The page each stop teaches — the shell navigates there before the bubble
 * appears, so the tour actually walks the app instead of pointing at the
 * sidebar. Stops without a route stay on the current page.
 */
export function tourRouteFor(stop: TourStopId, today: string): Route | null {
  switch (stop) {
    case 'ai': return { name: 'ai', tab: 'plan' };
    case 'plans': return { name: 'plans' };
    case 'tasks': return { name: 'tasks' };
    case 'habits': return { name: 'habits' };
    case 'goals': return { name: 'goals' };
    case 'notes': return { name: 'notes' };
    case 'insights': return { name: 'insights' };
    case 'calendar': return { name: 'calendar', tab: 'week', date: today };
    default: return null;
  }
}

export function tourDone(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(DONE_KEY) === '1';
  } catch {
    return true; // storage blocked → never trap the user in a tour
  }
}

export function markTourDone(storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  try {
    storage.setItem(DONE_KEY, '1');
    storage.removeItem(RESUME_KEY);
  } catch {
    /* ignore */
  }
}

/** Step index saved right before a language-switch reload. */
export function readTourResume(storage: Pick<Storage, 'getItem'> = localStorage): number | null {
  try {
    const raw = storage.getItem(RESUME_KEY);
    if (raw === null) return null;
    const index = Math.round(Number(raw));
    return index >= 1 && index < TOUR_LENGTH ? index : null;
  } catch {
    return null;
  }
}

export function writeTourResume(index: number, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(RESUME_KEY, String(Math.max(1, Math.min(TOUR_LENGTH - 1, index))));
  } catch {
    /* ignore */
  }
}

/**
 * Decide where the tour should open on this boot:
 * - a saved resume point (after a language switch) always wins;
 * - otherwise the tour starts from the language step on the very first run.
 * Returns null when the tour should stay closed (any later visit).
 */
export function tourStartIndex(storage: Pick<Storage, 'getItem'> = localStorage): number | null {
  const resume = readTourResume(storage);
  if (resume !== null) return resume;
  return tourDone(storage) ? null : 0;
}

/** Next step; past the end means "tour finished". */
export function advanceTour(index: number): number | null {
  const next = index + 1;
  return next >= TOUR_LENGTH ? null : next;
}

/** Back, but never behind the first content step (the language step is one-way). */
export function backTour(index: number): number {
  return Math.max(1, index - 1);
}

// ── AI coach first-visit nudge ─────────────────────────────────────────
// The AI coach is easy to miss, so the nav shows a one-time attention dot
// until the AI page has actually been opened.

const AI_VISITED_KEY = 'planner-ai-visited';

export function isAIVisited(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(AI_VISITED_KEY) === '1';
  } catch {
    return true; // storage blocked → never nag
  }
}

export function markAIVisited(storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(AI_VISITED_KEY, '1');
  } catch {
    /* ignore */
  }
}

// ── Replay requests (same pattern as pwa.ts listeners) ─────────────────

const listeners = new Set<() => void>();

/** Ask the shell to open the tour from the first step. */
export function requestTour(): void {
  listeners.forEach((listener) => listener());
}

export function onTourRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
