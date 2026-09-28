/**
 * First-run tour: a spotlight showcase that plays ONCE, on the very first
 * visit, and can be replayed from the sidebar (?) / More sheet / Settings.
 * Storage-only logic lives here so it stays unit-testable; the visual layer
 * is TourSheet.
 *
 * The very first step is a language choice. Switching language reloads the
 * page (the Settings pattern), so the tour persists its resume point across
 * that reload.
 */

const DONE_KEY = 'planner-tour-done';
const RESUME_KEY = 'planner-tour-resume';

/** Tour stop ids, in order. Step 'lang' is the bilingual language chooser. */
export const TOUR_STOPS = [
  'lang',
  'today',
  'quick',
  'plan',
  'timeline',
  'habits',
  'mood',
  'journal',
  'search',
  'tabs',
  'calendar',
  'insights',
  'settings',
  'done',
] as const;
export type TourStopId = (typeof TOUR_STOPS)[number];

export const TOUR_LENGTH = TOUR_STOPS.length;

/** Number of teaching stops (everything except the language chooser). */
export const TOUR_CONTENT_STEPS = TOUR_LENGTH - 1;

/**
 * Which layout element to spotlight for each stop (null = centred bubble).
 * Every selector is a data-tour attribute so theme/class renames can't break
 * the tour; TourSheet resolves the FIRST VISIBLE match (sidebar vs tabbar).
 */
export const TOUR_SELECTORS: Record<TourStopId, string | null> = {
  lang: null,
  today: '.hero-panel',
  quick: '.quick-add',
  plan: '.plan-row',
  timeline: '.timeline-card',
  habits: '[data-tour="habits"]',
  mood: '[data-mood-card]',
  journal: '.journal-card',
  search: '[data-tour="search"]',
  tabs: '[data-tour-nav="tasks"]',
  calendar: '[data-tour-nav="calendar"]',
  insights: '[data-tour-nav="insights"]',
  settings: '[data-tour="settings"]',
  done: null,
};

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
