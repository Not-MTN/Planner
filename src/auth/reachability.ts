/**
 * "There is no network" and "the server is refusing this app" are different
 * problems that look identical to `fetch`.
 *
 * In a packaged app the API lives on another origin, so the browser enforces
 * CORS on every call. When the server has not been told the app's origin is
 * ours (a missing `PLANNER_APP_ORIGINS`, see docs/APPS.md §2) the request does
 * reach the server, the server does answer `403` — and the browser then hides
 * that answer from JavaScript because the response carries no
 * `Access-Control-Allow-Origin`. All `fetch` rejects with is a bare
 * `TypeError`, which the app has been reporting as "offline" ever since. That
 * sends people to look at their Wi-Fi instead of at the one server setting that
 * was wrong, and it is why a downloaded app could sit in a local-only planner
 * with no sign-in page in sight.
 *
 * `mode: 'no-cors'` is the way to tell the two apart. The browser still refuses
 * to let us read the answer, but the request is still sent, so the promise
 * settles differently depending on what actually happened:
 *
 *   resolves → something answered on that address. The connection is fine; the
 *              cross-origin policy is what failed.
 *   rejects  → nothing answered: genuinely offline, or a wrong address.
 *
 * It only ever runs to explain a failure that already happened, so the happy
 * path pays nothing for it.
 */
import { apiUrl, effectiveApiOrigin } from '../shared/nativeShell';

export type Reachability =
  /** The API is on this app's own origin — a browser tab, or local development. */
  | 'reachable'
  /** Another origin answered, and its CORS policy is what turned the call away. */
  | 'refused'
  /** Nothing answered at all. */
  | 'offline';

/** Long enough for a slow mobile connection, short enough not to stall a boot. */
const PROBE_TIMEOUT_MS = 5000;

export interface ReachabilityOptions {
  /** The API origin to ask, overriding the one the build carries. */
  origin?: string;
  timeoutMs?: number;
  /** Injectable for tests; the real `fetch` otherwise. */
  fetchImpl?: typeof fetch;
}

/**
 * Ask whether anything is answering at the API, without needing permission to
 * read the answer. Never throws: an unexpected failure is reported as
 * `offline`, the answer that blames nothing but the connection.
 */
export async function probeApiReachability(options: ReachabilityOptions = {}): Promise<Reachability> {
  const origin = options.origin ?? effectiveApiOrigin();
  const target = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!target) return 'offline';
  if (!origin) return 'offline';
  const withTimeout = async (ms: number, fn: (signal: AbortSignal | undefined) => Promise<unknown>) => {
    const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = c ? setTimeout(() => c.abort(), ms) : null;
    try {
      await fn(c?.signal);
      return true;
    } catch { return false; } finally { if (t) clearTimeout(t); }
  };
  // Phase 1: is anything answering at all? no-cors bypasses CORS — offline vs online.
  const online = await withTimeout(options.timeoutMs ?? PROBE_TIMEOUT_MS, (signal) =>
    target(apiUrl('/api/auth/status', origin), {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      ...(signal ? { signal } : {}),
    }),
  );
  if (!online) return 'offline';
  // Phase 2: online — is it CORS? Try a real cors fetch; if it resolves with opaque CORS headers hidden, the server answered but refused our origin.
  // For same-origin builds, cors will succeed (reachable). For cross-origin, cors fails when PLANNER_APP_ORIGINS missing.
  const ownOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  const corsOk = await withTimeout(options.timeoutMs ?? PROBE_TIMEOUT_MS, (signal) =>
    target(apiUrl('/api/auth/status', origin), {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      ...(signal ? { signal } : {}),
    }).then((r) => {
      // If we can read ok, CORS is allowed. If we got opaque, it still means no CORS (fetch would have rejected — so if we are here, CORS passed).
      if (!(r instanceof Response)) throw new Error('no response');
      if (!r.ok && r.type === 'opaque') throw new Error('opaque');
    }),
  );
  if (!corsOk) {
    // no-cors succeeded but cors failed → network fine, CORS blocked → server refused our origin.
    // Only claim refused for cross-origin builds; same-origin failures are not CORS.
    return origin && origin !== ownOrigin ? 'refused' : 'offline';
  }
  return 'reachable';
}
