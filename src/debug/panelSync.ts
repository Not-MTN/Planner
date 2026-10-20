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
  // eslint-disable-next-line no-console
  console.debug(`[panel-sync] ${tag}`, { at: new Date().toISOString().slice(11, 19), ...details });
}

export function syncInvariant(panels: unknown, message: string) {
  if (!debugEnabled()) return;
  // eslint-disable-next-line no-console
  console.warn(`[panel-sync-invariant] ${message}`, panels);
}
