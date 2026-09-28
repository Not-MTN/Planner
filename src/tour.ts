/**
 * First-run tour: a short spotlight walkthrough that plays once, and can be
 * replayed from the sidebar (?) or Settings. Storage-only logic lives here so
 * it stays unit-testable; the visual layer is TourSheet.
 *
 * The very first step is a language choice. Switching language reloads the
 * page (the Settings pattern), so the tour persists its resume point across
 * that reload.
 */

const DONE_KEY = 'planner-tour-done';
const RESUME_KEY = 'planner-tour-resume';

/** Tour stop ids, in order. Step 'lang' is the bilingual language chooser. */
export const TOUR_STOPS = ['lang', 'quick', 'plan', 'timeline', 'habits', 'mood', 'journal', 'done'] as const;
export type TourStopId = (typeof TOUR_STOPS)[number];

/** CSS anchor for each stop (null = centred card, no spotlight). */
export const TOUR_SELECTORS: Record<TourStopId, string | null> = {
  lang: null,
  quick: '.quick-add',
  plan: '.plan-row',
  timeline: '.timeline-card',
  habits: '.wash-lav',
  mood: '[data-mood-card]',
  journal: '.journal-card',
  done: null,
};

export const TOUR_LENGTH = TOUR_STOPS.length;

export function tourDone(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(DONE_KEY) === '1';
  } catch {
    return true;
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
 * Returns null when the tour should stay closed.
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
