/**
 * Two-way calendar sync (CalDAV).
 *
 * The feed subscriptions in `feeds.ts` are one-way on purpose: they mirror
 * somebody else's calendar and never write. This is the other arrangement —
 * a calendar this app is allowed to *change* — and it is the one place where a
 * planner edit can leave the device without the user's planner account.
 *
 * The rules, in one place, because they are the whole design:
 *
 * 1. Identity is the remote address. The first time an event comes down it is
 *    stored with `source = { url, uid: href }`; an event this app created is
 *    remembered in `hrefs[id]` after its first successful upload. Matching is
 *    by that identity, never by title or time.
 * 2. When both copies changed, the newer edit wins — same rule as device sync.
 *    "Newer" is the remote `LAST-MODIFIED`/`DTSTAMP` against the local
 *    `updatedAt`. The loser is not reported as a conflict here the way a device
 *    merge reports one, because the remote copy is still readable at its own
 *    address; the pull simply follows the newer side.
 * 3. Deletions travel in both directions, and are remembered: an address the
 *    user deleted here goes into `dropped`, so the next pull does not fetch it
 *    straight back and the next push does not recreate it.
 * 4. Notes, categories and importance stay local, exactly as they do for a
 *    subscribed feed: the calendar owns the schedule, the planner owns what the
 *    user wrote about it. The exception is content pushed up: the note goes
 *    with it, because a foreign calendar that shows only a title is a worse
 *    edit than one that shows the note.
 * 5. Nothing is pushed to a calendar that is not writable, and nothing at all
 *    is pushed when the subscription's own "send my events here" setting is
 *    off.
 *
 * The planning step is pure (`planCalendarSync`) so the rules can be tested
 * without a server; the impure half is the thin `remote*` wrappers over
 * `/api/caldav` plus `applyCalendarPull`.
 */
import { eventToICS, icsStampOf, icsUids, parseICS, type ICSEventInput } from './ics';
import { addEvent, deleteEvent, updateEvent } from './mutate';
import type { PlannerEvent, PlannerState } from './types';

const KEY = 'planner-calendars';
export const MAX_CALENDARS = 5;
/** Uploads per sync run. A first sync of a full calendar continues on the next. */
export const MAX_PUSH_PER_RUN = 30;
const MAX_DROPPED = 500;
const MAX_SEEN = 4000;
/** How long a pull window reaches: a month back, half a year forward. */
export const PULL_PAST_DAYS = 30;
export const PULL_FUTURE_DAYS = 180;
export const CALENDAR_STALE_MINUTES = 15;

export interface CalendarSubscription {
  /** The calendar collection's own address. */
  url: string;
  name: string;
  username: string;
  password: string;
  /** Send events created in the planner to this calendar. */
  push: boolean;
  addedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Remote addresses present at the last successful pull. */
  seen: string[];
  /** Planner event id → the remote address it lives at. */
  hrefs: Record<string, string>;
  /** Remote address → etag, for conditional writes. */
  etags: Record<string, string>;
  /** Addresses deleted on this device: never pulled back, never re-created. */
  dropped: string[];
}

function cleanRecord(value: unknown): CalendarSubscription | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!/^https?:\/\//i.test(url) || url.length > 2000) return null;
  const strings = (input: unknown, cap = 2000): Record<string, string> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
      if (typeof entry === 'string' && key.length <= 100 && entry.length <= cap) out[key] = entry;
    }
    return out;
  };
  const list = (input: unknown, cap: number): string[] =>
    Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 2000).slice(0, cap) : [];
  return {
    url,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : '',
    username: typeof raw.username === 'string' ? raw.username.slice(0, 200) : '',
    password: typeof raw.password === 'string' ? raw.password.slice(0, 400) : '',
    push: raw.push !== false,
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date(0).toISOString(),
    lastSyncedAt: typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError.slice(0, 240) : null,
    seen: list(raw.seen, MAX_SEEN),
    hrefs: strings(raw.hrefs),
    etags: strings(raw.etags, 200),
    dropped: list(raw.dropped, MAX_DROPPED),
  };
}

export function loadCalendars(): CalendarSubscription[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      const clean = cleanRecord(entry);
      return clean ? [clean] : [];
    }).slice(0, MAX_CALENDARS);
  } catch {
    return [];
  }
}

export function saveCalendars(calendars: CalendarSubscription[]): void {
  try {
    if (calendars.length === 0) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(calendars.slice(0, MAX_CALENDARS)));
  } catch {
    /* ignore */
  }
}

// ── Server calls ──────────────────────────────────────────────────────────

interface DavError {
  error?: { message?: string; code?: string };
}

async function callDav<T>(body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl('/api/caldav', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => null)) as (T & DavError) | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error?.message ?? `The calendar server answered ${response.status}.`);
  }
  return payload;
}

export interface RemoteCalendarItem {
  href: string;
  etag: string;
  data: string;
}

export interface CalendarCredentials {
  url: string;
  username: string;
  password: string;
}

export async function remoteDiscover(credentials: CalendarCredentials, fetchImpl: typeof fetch = fetch): Promise<{ url: string; name: string }[]> {
  const body = await callDav<{ calendars?: { url: string; name: string }[] }>({ action: 'discover', ...credentials }, fetchImpl);
  return (body.calendars ?? []).filter((entry) => typeof entry.url === 'string' && /^https?:\/\//i.test(entry.url));
}

export async function remoteList(
  credentials: CalendarCredentials,
  start: string,
  end: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RemoteCalendarItem[]> {
  const body = await callDav<{ items?: RemoteCalendarItem[] }>({ action: 'list', ...credentials, start, end }, fetchImpl);
  return (body.items ?? []).filter((item) => item && typeof item.href === 'string' && typeof item.data === 'string');
}

export async function remotePush(
  credentials: CalendarCredentials,
  data: string,
  href: string | null,
  etag: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ href: string; etag: string }> {
  return callDav<{ href: string; etag: string }>({ action: 'push', ...credentials, data, href, etag }, fetchImpl);
}

export async function remoteDelete(
  credentials: CalendarCredentials,
  href: string,
  etag: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await callDav<{ ok: boolean }>({ action: 'delete', ...credentials, href, etag }, fetchImpl);
}

/** The window a sync covers, as ISO stamps the server turns into DAV times. */
export function pullWindow(now = new Date()): { start: string; end: string } {
  const start = new Date(now.getTime() - PULL_PAST_DAYS * 86_400_000);
  const end = new Date(now.getTime() + PULL_FUTURE_DAYS * 86_400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ── The plan ──────────────────────────────────────────────────────────────

export interface CalendarPull {
  href: string;
  etag: string;
  input: ICSEventInput;
  /** Existing planner event to update, or null to add a new one. */
  id: string | null;
}

export interface CalendarPush {
  id: string;
  href: string | null;
  etag: string | null;
  data: string;
}

export interface CalendarPlan {
  pull: CalendarPull[];
  push: CalendarPush[];
  /** Planner event ids whose remote copy is gone. */
  removeLocal: string[];
  /** Remote addresses whose planner copy is gone. */
  removeRemote: { href: string; etag: string | null }[];
  /** The addresses to remember as present after this run. */
  seen: string[];
}

/** The planner id an ICS UID refers to, when it is one of ours. */
export function plannerIdFromUid(uid: string | undefined): string | null {
  if (!uid || !uid.endsWith('@planner')) return null;
  const id = uid.slice(0, -'@planner'.length).trim();
  return id && id.length <= 100 ? id : null;
}

/**
 * Which copy was edited last — or neither, when both carry the same moment.
 * A missing or unreadable stamp is not evidence of an edit, so it counts as
 * "cannot tell" rather than "remote wins": pushing a local copy over a remote
 * one on a guess is how a sync eats data.
 */
export function compareCopy(item: RemoteCalendarItem, local: PlannerEvent): 'remote' | 'local' | 'same' | 'unknown' {
  const remote = icsStampOf(item.data);
  if (!remote) return 'unknown';
  const at = Date.parse(remote);
  const mine = Date.parse(local.updatedAt);
  if (!Number.isFinite(at) || !Number.isFinite(mine)) return 'unknown';
  if (at > mine) return 'remote';
  if (at < mine) return 'local';
  return 'same';
}

/** Can this event be handed to the calendar as its own item? */
export function canPushEvent(event: PlannerEvent, subscription: CalendarSubscription, windowStart: string, windowEnd: string): boolean {
  if (!subscription.push) return false;
  if (event.repeat) return false;                       // a series is many items, not one
  if (event.fixedCommitmentId || event.seriesEventId) return false;  // generated, read-only copies
  if (event.source && event.source.url !== subscription.url) return false;  // someone else's calendar
  return event.date >= windowStart && event.date <= windowEnd;
}

export function planCalendarSync(
  state: PlannerState,
  subscription: CalendarSubscription,
  remote: RemoteCalendarItem[],
  now = new Date(),
): CalendarPlan {
  const { start, end } = pullWindow(now);
  const windowStart = start.slice(0, 10);
  const windowEnd = end.slice(0, 10);
  const plan: CalendarPlan = { pull: [], push: [], removeLocal: [], removeRemote: [], seen: [] };
  const dropped = new Set(subscription.dropped);
  const eventsById = new Map(state.events.map((event) => [event.id, event]));
  const localByHref = new Map<string, PlannerEvent>();
  for (const event of state.events) {
    if (event.source?.url === subscription.url) localByHref.set(event.source.uid, event);
  }
  for (const [id, href] of Object.entries(subscription.hrefs)) {
    const event = eventsById.get(id);
    if (event) localByHref.set(href, event);
  }

  const handled = new Set<string>();
  for (const item of remote) {
    if (dropped.has(item.href)) continue;
    plan.seen.push(item.href);
    const parsed = parseICS(item.data);
    const input = parsed.events[0];
    if (!input) continue;
    const uid = icsUids(item.data)[0] ?? input.uid;
    const byUidId = plannerIdFromUid(uid);
    const local = (byUidId ? eventsById.get(byUidId) : undefined) ?? localByHref.get(item.href);
    if (!local) {
      // An item this app uploaded and that is no longer in the planner was
      // deleted here on purpose; the deletion pass below sends that out, and
      // pulling it back would undo the user's own action.
      if (byUidId && subscription.hrefs[byUidId] !== undefined) {
        handled.add(byUidId);
        continue;
      }
      plan.pull.push({ href: item.href, etag: item.etag, input: { ...input, uid }, id: null });
      continue;
    }
    handled.add(local.id);
    const newer = compareCopy(item, local);
    if (newer === 'remote') {
      plan.pull.push({ href: item.href, etag: item.etag, input: { ...input, uid }, id: local.id });
    } else if (newer === 'local' && canPushEvent(local, subscription, windowStart, windowEnd)) {
      const etag = subscription.etags[item.href] ?? item.etag ?? null;
      plan.push.push({ id: local.id, href: item.href, etag, data: eventToICS(local, now) });
    }
  }

  // Addresses that were here last time and are not any more: the other side
  // deleted them, so the planner copy goes too.
  const present = new Set(plan.seen);
  for (const href of subscription.seen) {
    if (present.has(href) || dropped.has(href)) continue;
    const local = localByHref.get(href);
    if (local) {
      plan.removeLocal.push(local.id);
      handled.add(local.id);
    }
  }
  // An event this app put at an address that no longer answers: same thing.
  for (const [id, href] of Object.entries(subscription.hrefs)) {
    if (present.has(href) || dropped.has(href) || handled.has(id)) continue;
    if (!eventsById.has(id)) continue;
    plan.removeLocal.push(id);
    handled.add(id);
  }

  // Local events with nowhere to be yet.
  if (subscription.push) {
    for (const event of state.events) {
      if (handled.has(event.id) || !canPushEvent(event, subscription, windowStart, windowEnd)) continue;
      if (event.source?.url === subscription.url) continue;   // it is already there
      if (plan.push.length >= MAX_PUSH_PER_RUN) break;
      plan.push.push({ id: event.id, href: null, etag: null, data: eventToICS(event, now) });
    }
  }
  // Deletions of things this app had put there: the local copy is gone, so the
  // remote one should not outlive it.
  for (const [id, href] of Object.entries(subscription.hrefs)) {
    if (eventsById.has(id) || dropped.has(href)) continue;
    plan.removeRemote.push({ href, etag: subscription.etags[href] ?? null });
  }
  return plan;
}

// ── Applying a pull ───────────────────────────────────────────────────────

/**
 * Fold one pulled item into the planner. Existing items keep what the user
 * wrote about them (category, importance, completion, notes for events pulled
 * from elsewhere); the calendar's version of the schedule and the title wins,
 * because it is the copy that was edited more recently.
 */
export function applyCalendarPull(
  state: PlannerState,
  subscriptionUrl: string,
  item: CalendarPull,
  now = new Date().toISOString(),
): PlannerState {
  const source = { url: subscriptionUrl, uid: item.href };
  const schedule = {
    title: item.input.title,
    date: item.input.date,
    startTime: item.input.startTime,
    endTime: item.input.endTime,
    repeat: item.input.repeat ?? null,
  };
  if (item.id && state.events.some((event) => event.id === item.id)) {
    return updateEvent(state, item.id, { ...schedule, source }, now);
  }
  const added = addEvent(state, { ...item.input, category: 'personal', note: item.input.note ?? '', important: false, source }, undefined, now);
  return added;
}

export function applyCalendarRemovals(state: PlannerState, ids: string[]): PlannerState {
  return ids.reduce((current, id) => deleteEvent(current, id), state);
}

/** Record the remote identity of an event that was just uploaded. */
export function markPushed(state: PlannerState, id: string, href: string, url: string, now = new Date().toISOString()): PlannerState {
  return updateEvent(state, id, { source: { url, uid: href } }, now);
}

// ── Bookkeeping on the subscription record ────────────────────────────────

/**
 * Fold one run's outcome back into the subscription: which addresses exist, the
 * etags to write against next time, the mappings of items this app uploaded,
 * and the addresses it deleted — so nothing comes back from the dead.
 */
export function recordSync(
  subscription: CalendarSubscription,
  plan: CalendarPlan,
  applied: {
    pushed: { id: string; href: string; etag: string }[];
    removed: { href: string }[];
  },
  at = new Date().toISOString(),
): CalendarSubscription {
  const hrefs = { ...subscription.hrefs };
  const etags: Record<string, string> = { ...subscription.etags };
  // What the pull chose to keep: its etag, and — for an item this app had
  // uploaded — the address it now answers at.
  for (const item of plan.pull) {
    if (item.etag) etags[item.href] = item.etag;
    if (item.id && plannerIdFromUid(item.input.uid)) hrefs[item.id] = item.href;
  }
  for (const item of applied.pushed) {
    hrefs[item.id] = item.href;
    if (item.etag) etags[item.href] = item.etag;
  }
  // Everything this run removed, on either side, is remembered as dropped so a
  // later pull cannot fetch it and a later push cannot re-create it.
  const gone = new Set<string>(applied.removed.map((entry) => entry.href));
  for (const id of plan.removeLocal) {
    const href = hrefs[id];
    if (href) gone.add(href);
    delete hrefs[id];
  }
  // A mapping to an address that no longer exists is a mapping to nothing: it
  // would make the next run try to update an event the server has forgotten.
  for (const [id, href] of Object.entries(hrefs)) {
    if (gone.has(href)) delete hrefs[id];
  }
  for (const href of gone) delete etags[href];
  const keep = new Set([...plan.seen, ...Object.values(hrefs), ...applied.pushed.map((entry) => entry.href)]);
  for (const href of Object.keys(etags)) {
    if (!keep.has(href)) delete etags[href];
  }
  return {
    ...subscription,
    hrefs,
    etags,
    dropped: [...new Set([...subscription.dropped, ...gone])].slice(-MAX_DROPPED),
    seen: plan.seen.slice(0, MAX_SEEN),
    lastSyncedAt: at,
    lastError: null,
  };
}

/** Everything a failed run needs to remember: the message, and nothing else. */
export function recordFailure(subscription: CalendarSubscription, message: string): CalendarSubscription {
  return { ...subscription, lastError: message.slice(0, 240) };
}
