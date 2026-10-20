/**
 * Panel sync observability — dev-only, zero cost in prod.
 * Enable with localStorage.debug='sync' or ?debug=sync
 */
export interface SyncDebug {
  notices: number;
  plans: number;
  linkChat: number;
  globalChat: number;
  at: string;
}

export function debugEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (new URLSearchParams(window.location.search).get('debug') === 'sync') return true;
    return window.localStorage.getItem('debug') === 'sync';
  } catch { return false; }
}

export function logSync(tag: string, details: Record<string, unknown>) {
  if (!debugEnabled()) return;
  // Device wall-clock time: a debug line should agree with the clock of the
  // person reading the console, not with UTC.
  const now = new Date();
  const at = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  console.debug(`[panel-sync] ${tag}`, { at, ...details });
}

export function syncInvariant(panels: unknown, message: string) {
  if (!debugEnabled()) return;
  console.warn(`[panel-sync-invariant] ${message}`, panels);
}
