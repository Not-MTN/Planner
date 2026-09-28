import { describe, expect, it } from 'vitest';
import { advanceTour, backTour, isAIVisited, markAIVisited, markTourDone, readTourResume, tourDone, TOUR_LENGTH, tourRouteFor, TOUR_SELECTORS, TOUR_STOPS, tourStartIndex, writeTourResume } from './tour';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => { map.delete(key); },
    setItem: (key, value) => { map.set(key, value); },
  };
}

describe('tour', () => {
  it('starts on the language step for a brand-new visitor', () => {
    expect(tourStartIndex(fakeStorage())).toBe(0);
    expect(TOUR_STOPS[0]).toBe('lang');
  });

  it('stays closed once done, and reopens on request', () => {
    const storage = fakeStorage({ 'planner-tour-done': '1' });
    expect(tourDone(storage)).toBe(true);
    expect(tourStartIndex(storage)).toBe(null);
  });

  it('marks done and clears any resume point', () => {
    const storage = fakeStorage({});
    writeTourResume(3, storage);
    markTourDone(storage);
    expect(tourDone(storage)).toBe(true);
    expect(readTourResume(storage)).toBe(null);
  });

  it('resumes after the language-switch reload, skipping the chooser', () => {
    const storage = fakeStorage({});
    writeTourResume(2, storage);
    expect(readTourResume(storage)).toBe(2);
    expect(tourStartIndex(storage)).toBe(2);
  });

  it('rejects junk resume values', () => {
    expect(readTourResume(fakeStorage({ 'planner-tour-resume': '99' }))).toBe(null);
    expect(readTourResume(fakeStorage({ 'planner-tour-resume': 'abc' }))).toBe(null);
    expect(readTourResume(fakeStorage({ 'planner-tour-resume': '0' }))).toBe(null);
  });

  it('walks forward to the end and back without leaving the bounds', () => {
    let index: number | null = 0;
    const seen: number[] = [];
    while (index !== null) {
      seen.push(index);
      index = advanceTour(index);
    }
    expect(seen).toEqual([...Array(TOUR_LENGTH).keys()]);
    expect(seen).toHaveLength(TOUR_LENGTH);
    expect(backTour(1)).toBe(1);
    expect(backTour(2)).toBe(1);
    expect(backTour(0)).toBe(1); // never behind the first content step
  });

  it('anchors every content stop at a real element', () => {
    for (const stop of TOUR_STOPS) {
      if (stop === 'lang' || stop === 'done') {
        expect(TOUR_SELECTORS[stop]).toBe(null);
      } else {
        expect(TOUR_SELECTORS[stop], stop).toMatch(/^[.[]/);
      }
    }
  });

  it('walks one page at a time: page stops navigate, chrome stops do not', () => {
    // Every tab the app has gets exactly one teaching stop.
    for (const name of ['ai', 'plans', 'tasks', 'habits', 'goals', 'notes', 'insights', 'calendar'] as const) {
      const stop = TOUR_STOPS.find((id) => tourRouteFor(id, '2026-01-05')?.name === name);
      expect(stop, name).toBeTruthy();
    }
    // Chrome stops stay where the user is.
    for (const stop of ['lang', 'today', 'search', 'settings', 'done'] as const) {
      expect(tourRouteFor(stop, '2026-01-05')).toBe(null);
    }
    expect(tourRouteFor('calendar', '2026-01-05')).toMatchObject({ name: 'calendar', tab: 'week', date: '2026-01-05' });
  });

  it('nudges about the AI coach only until it has been visited', () => {
    const storage = fakeStorage();
    expect(isAIVisited(storage)).toBe(false);
    markAIVisited(storage);
    expect(isAIVisited(storage)).toBe(true);
  });
});
