/**
 * The rhythm of live sync between linked accounts.
 *
 * Everything here is pure: it decides *when* a tick should happen, it never
 * fetches anything. The React layer owns the clock and the network, so the
 * policy — chat in seconds, the rest in breaths, back off while the line is
 * dead, stay silent while the tab is hidden — can be tested without a browser.
 *
 * The transport underneath is request/response against serverless functions,
 * so "real time" here means "as fast as a cheap poll can honestly be": a
 * timestamp probe while a conversation is open, and the full encrypted sync
 * only when that probe says something moved.
 */

/** How much the user currently cares about fresh link data. */
export type SyncPriority = 'chat' | 'panel' | 'idle';

/** What the last few sync attempts looked like, for the little status line. */
export type LinkSyncStatus = 'live' | 'reconnecting' | 'offline';

/** How hard the user is looking: an open thread beats an open panel. */
const PRIORITY_RANK: Record<SyncPriority, number> = { chat: 3, panel: 2, idle: 1 };

export function highestPriority(a: SyncPriority, b: SyncPriority): SyncPriority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

/** Base tick per priority, in milliseconds. Hidden tabs do not tick at all. */
export const POLL_INTERVALS_MS: Record<Exclude<SyncPriority, 'idle'> | 'idle', number> = {
  chat: 5_000,
  panel: 15_000,
  idle: 45_000,
};

/** Failures never slow a chat past this: a dead line still retries within a minute. */
export const MAX_BACKOFF_MS = 60_000;

/**
 * Wait before the next tick.
 *
 * A visible, healthy tick runs at the priority's own rhythm. Each consecutive
 * failure backs off exponentially (2^n, capped) so a phone in a tunnel does
 * not hammer the API, and the first success puts the rhythm straight back.
 * Hidden tabs return `null` — the scheduler should not run at all while
 * nobody can read the screen; visibilitychange kicks it on return.
 */
export function pollDelayMs(priority: SyncPriority, visible: boolean, failures: number): number | null {
  if (!visible) return null;
  const base = POLL_INTERVALS_MS[priority];
  if (failures <= 0) return base;
  return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 4));
}

/**
 * Whether the server's timestamps say a full encrypted sync is worth it.
 *
 * A link that is new or whose last-write moved is a change. Links that
 * disappeared are not — the sync itself reconciles removals, and a probe that
 * raced a deletion must not trigger forever.
 */
export function activityChanged(
  previous: Record<string, string> | null,
  next: Record<string, string>,
): boolean {
  if (previous === null) return Object.keys(next).length > 0;
  for (const [linkId, updatedAt] of Object.entries(next)) {
    if (previous[linkId] !== updatedAt) return true;
  }
  return false;
}

/** The next priority after one release, given the ones still held. */
export function priorityFromHeld(held: SyncPriority[]): SyncPriority {
  return held.reduce<SyncPriority>((best, entry) => highestPriority(best, entry), 'idle');
}
