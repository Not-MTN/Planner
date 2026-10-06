/**
 * Running inside a packaged app rather than a browser tab.
 *
 * The Android, iOS and desktop builds serve the very same files the website
 * serves, and both WebView routers answer an unknown path with `index.html`,
 * so every route in the app behaves exactly as it does on the web. Two things
 * are genuinely different, and this module is where they are handled:
 *
 *   1. The API is not on the shell's own origin. A build made with
 *      `PLANNER_API_ORIGIN` carries that address, and `installApiOriginShim()`
 *      rewrites relative `/api/...` requests to it — including the session
 *      cookie. Every existing call site keeps writing `fetch('/api/...')`.
 *   2. "Install the app" and "is this installed?" mean something else there.
 *      `src/pwa.ts` asks this module instead of trusting the browser.
 *
 * Nothing here changes behaviour in a browser tab: with no API origin
 * configured the shim is never installed, and `/api/...` stays relative.
 */

/** What Capacitor injects into the page inside a native shell. */
interface CapacitorWindow extends Window {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
  plannerDesktop?: { version?: string };
}

/** Injected by Vite from `PLANNER_API_ORIGIN` at build time; '' in the browser. */
declare const __PLANNER_API_ORIGIN__: string;

/**
 * Injected by Vite from `PLANNER_LINK_ORIGIN`, `PLANNER_APP_URL` or
 * `PLANNER_API_ORIGIN` — whichever the build was given. '' in the browser.
 */
declare const __PLANNER_LINK_ORIGIN__: string;

export type ShellPlatform = 'web' | 'android' | 'ios' | 'desktop';

function shellWindow(): CapacitorWindow | null {
  return typeof window === 'undefined' ? null : (window as CapacitorWindow);
}

/** True inside the packaged Android, iOS or desktop app. */
export function isNativeShell(): boolean {
  const shell = shellWindow();
  if (!shell) return false;
  if (shell.plannerDesktop) return true;
  try {
    return shell.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** Which packaged app this is, or `web` for an ordinary browser tab. */
export function shellPlatform(): ShellPlatform {
  if (typeof window === 'undefined') return 'web';
  if (shellWindow()?.plannerDesktop) return 'desktop';
  if (!isNativeShell()) return 'web';
  try {
    const platform = shellWindow()?.Capacitor?.getPlatform?.();
    if (platform === 'android' || platform === 'ios') return platform;
  } catch {
    /* fall through to the generic answer */
  }
  return isNativeShell() ? 'android' : 'web';
}

/** Native phone/tablet shells that expose the Android or iOS permission UI. */
export function isNativeMobileShell(): boolean {
  const platform = shellPlatform();
  return platform === 'android' || platform === 'ios';
}

/**
 * The API this build talks to, or '' when the app is served from the same
 * origin as the API (the website, and local development).
 */
export function configuredApiOrigin(): string {
  let raw = '';
  try {
    raw = typeof __PLANNER_API_ORIGIN__ === 'string' ? __PLANNER_API_ORIGIN__ : '';
  } catch {
    raw = '';
  }
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** True when this build was told where its API lives. */
export function hasConfiguredApi(): boolean {
  return configuredApiOrigin() !== '';
}

/**
 * The address a link this app hands out should point at.
 *
 * In a browser tab that is simply the page's own address. Inside a packaged app
 * it is not: the app is served from `https://localhost` (Android) or
 * `capacitor://localhost` (iOS), and a link to either is a link to nowhere —
 * the QR code a guardian shows would be scanned by a phone that cannot open it.
 * So a packaged build carries its deployment's address, baked in from
 * `PLANNER_LINK_ORIGIN` (or `PLANNER_APP_URL` / `PLANNER_API_ORIGIN`, which name
 * the same deployment when no explicit link address was given).
 *
 * '' means this app has no address to hand out — an offline-only build. Callers
 * show the code without a link rather than a link that cannot work.
 */
export function linkOrigin(): string {
  let raw = '';
  try {
    raw = typeof __PLANNER_LINK_ORIGIN__ === 'string' ? __PLANNER_LINK_ORIGIN__ : '';
  } catch {
    raw = '';
  }
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      /* fall through to the address we are actually on */
    }
  }
  if (isNativeShell()) return '';
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** `/api/sync` → `https://api.example.com/api/sync` (unchanged in the browser). */
export function apiUrl(path: string, origin = configuredApiOrigin()): string {
  if (!origin) return path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path;
  return path.startsWith('/') ? `${origin}${path}` : `${origin}/${path}`;
}

/**
 * The address this request should really go to, or null when it is not an API
 * call of this app's own. Three shapes count as the app's own: a relative
 * `/api/...` path, an absolute URL on the shell's local origin (what a
 * `new Request('/api/...')` becomes), and a URL already pointing at the API.
 */
function rewriteApiUrl(value: string, origin: string): string | null {
  if (value === '/api' || value.startsWith('/api/') || value.startsWith('/api?')) return `${origin}${value}`;
  let url: URL;
  try {
    url = new URL(value, 'https://planner.invalid');
  } catch {
    return null;
  }
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return null;
  if (url.origin === origin) return value;
  const ownOrigin = shellWindow()?.location?.origin ?? '';
  if (url.origin === ownOrigin || url.origin === 'https://planner.invalid') {
    return `${origin}${url.pathname}${url.search}${url.hash}`;
  }
  return null;
}

/**
 * Send every `/api/...` request to the build's API origin, cookies included.
 *
 * `credentials: 'include'` is forced rather than defaulted: the app's browser
 * call sites ask for `'same-origin'`, which on a cross-origin request means
 * "send nothing" — the session cookie would silently be dropped and sign-in
 * would look like it worked while the next request said "signed out".
 *
 * Returns an undo function so tests (and a hot-reloaded dev server) can put
 * the original `fetch` back.
 */
export function installApiOriginShim(
  target: typeof globalThis = globalThis,
  origin: string = configuredApiOrigin(),
): () => void {
  const shell = shellWindow();
  if (!shell) return () => undefined;
  if (!origin) return () => undefined;

  const original = target.fetch;
  if (typeof original !== 'function') return () => undefined;

  const rewrite = (input: RequestInfo | URL, init?: RequestInit): [RequestInfo | URL, RequestInit | undefined] => {
    if (typeof input === 'string' || input instanceof URL) {
      const value = typeof input === 'string' ? input : input.toString();
      const target = rewriteApiUrl(value, origin);
      if (!target) return [input, init];
      return [target, { ...init, credentials: 'include' }];
    }
    if (typeof Request === 'function' && input instanceof Request) {
      const target = rewriteApiUrl(input.url, origin);
      if (!target) return [input, init];
      // Rebuilt piece by piece rather than `new Request(target, input)`:
      // passing a Request as the init dictionary drops the method and the body
      // in some WebView engines (and in jsdom), which would turn a sync PUT
      // into a GET that quietly does nothing.
      const hasBody = input.method !== 'GET' && input.method !== 'HEAD';
      const rebuilt = new Request(target, {
        method: input.method,
        headers: new Headers(input.headers),
        ...(hasBody && input.body ? { body: input.body, duplex: 'half' } : {}),
        ...init,
        credentials: 'include',
      } as RequestInit);
      return [rebuilt, undefined];
    }
    return [input, init];
  };

  const patched = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const [nextInput, nextInit] = rewrite(input, init);
    return original.call(target, nextInput as RequestInfo, nextInit);
  } as typeof globalThis.fetch;

  target.fetch = patched;
  return () => {
    if (target.fetch === patched) target.fetch = original;
  };
}
