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
import { apiUrl, configuredApiOrigin } from '../shared/nativeShell';

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
  const origin = options.origin ?? configuredApiOrigin();
  const target = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!target) return 'offline';
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? PROBE_TIMEOUT_MS) : null;
  try {
    await target(apiUrl('/api/auth/status', origin), {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch {
    return 'offline';
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  // An answer came back. In a cross-origin build the browser threw that answer
  // away, which is exactly the shape of an origin the server has not allowed.
  const ownOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  return origin && origin !== ownOrigin ? 'refused' : 'reachable';
}
