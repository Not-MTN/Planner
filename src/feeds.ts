/**
 * Read-only calendar feed subscriptions (any public .ics URL, e.g. Google
 * Calendar's secret address or Outlook's published calendar). Feeds refresh
 * through the same-origin /api/ics proxy (cross-origin fetch is blocked by CSP),
 * and imported events keep your local edits: category, completion, importance,
 * and notes survive refreshes; times and titles follow the feed.
 */
import { parseICS } from './ics';
import { addEvent } from './mutate';
import type { PlannerEvent, PlannerState } from './types';

const KEY = 'planner-feeds';
const MAX_FEEDS = 10;

export interface CalendarFeed {
  url: string;
  addedAt: string;
  lastFetchedAt: string | null;
  lastError: string | null;
  count: number;
}

export function loadFeeds(): CalendarFeed[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item): CalendarFeed[] => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      const url = typeof value.url === 'string' ? value.url.trim() : '';
      if (!/^https?:\/\//i.test(url) || url.length > 400) return [];
      return [
        {
          url,
          addedAt: typeof value.addedAt === 'string' ? value.addedAt : new Date(0).toISOString(),
          lastFetchedAt: typeof value.lastFetchedAt === 'string' ? value.lastFetchedAt : null,
          lastError: typeof value.lastError === 'string' ? value.lastError.slice(0, 200) : null,
          count: typeof value.count === 'number' && Number.isFinite(value.count) ? Math.max(0, Math.round(value.count)) : 0,
        },
      ];
    }).slice(0, MAX_FEEDS);
  } catch {
    return [];
  }
}

export function saveFeeds(feeds: CalendarFeed[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(feeds.slice(0, MAX_FEEDS)));
  } catch {
    /* ignore */
  }
}

/** Non-crypto fallback hash, stable across refreshes for a given VEVENT. */
function stableUid(parts: string): string {
  let hash = 5381;
  for (let i = 0; i < parts.length; i += 1) hash = ((hash << 5) + hash + parts.charCodeAt(i)) >>> 0;
  return `h${hash.toString(36)}`;
}

/** Fetch one feed through the proxy and parse it. Throws Error with a short message on failure. */
export async function fetchFeedEvents(url: string, fetchImpl: typeof fetch = fetch): Promise<{ uid: string; input: Parameters<typeof addEvent>[1] }[]> {
  const response = await fetchImpl(`/api/ics?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Could not fetch the calendar (${response.status}).`);
  }
  const text = await response.text();
  const parsed = parseICS(text);
  return parsed.events.map((event) => ({
    uid: event.uid ?? stableUid(`${url}|${event.title}|${event.date}|${event.startTime}|${event.endTime ?? ''}`),
    input: { ...event, source: { url, uid: event.uid ?? stableUid(`${url}|${event.title}|${event.date}|${event.startTime}|${event.endTime ?? ''}`) } },
  }));
}

/**
 * Replace a feed's events with a fresh copy, preserving per-event local
 * edits (category, importance, completion, notes). New items keep new ids;
 * items that vanished from the feed are removed.
 */
export function mergeFeedEvents(
  state: PlannerState,
  url: string,
  fresh: Array<{ uid: string; input: Parameters<typeof addEvent>[1] }>,
  now = new Date().toISOString(),
  idFactory: () => string = () => crypto.randomUUID(),
): PlannerState {
  const previousByUid = new Map<string, PlannerEvent>();
  for (const event of state.events) {
    if (event.source?.url === url) previousByUid.set(event.source.uid, event);
  }
  const kept = state.events.filter((event) => event.source?.url !== url);
  const seen = new Set<string>();
  let next: PlannerState = { ...state, events: kept };
  for (const item of fresh) {
    if (seen.has(item.uid)) continue;
    seen.add(item.uid);
    const previous = previousByUid.get(item.uid);
    if (previous) {
      // Follow the feed for schedule facts; keep the user's own annotations.
      next = {
        ...next,
        events: [
          ...next.events,
          {
            ...previous,
            title: item.input.title,
            date: item.input.date,
            startTime: item.input.startTime,
            endTime: item.input.endTime,
            repeat: item.input.repeat ?? null,
            updatedAt: now,
          },
        ],
      };
    } else {
      next = addEvent(next, { ...item.input, source: { url, uid: item.uid } }, idFactory(), now);
    }
  }
  return next;
}
