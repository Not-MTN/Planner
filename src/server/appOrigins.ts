/**
 * Who may call this API.
 *
 * The website is same-origin, so the browser's own rules protect it. The
 * packaged apps are not: an Android shell is `https://localhost`, an iOS shell
 * is `capacitor://localhost`, and a desktop build is `app://planner`. Those
 * origins are only trusted when the operator names them in
 * `PLANNER_APP_ORIGINS` — one bare origin per entry, comma separated:
 *
 *     PLANNER_APP_ORIGINS=capacitor://localhost,https://localhost,app://planner
 *
 * Nothing is trusted by default, and no entry may contain a path, a query or a
 * wildcard, so a mistake in the variable cannot widen the API to the web.
 * Everything that is not explicitly allowed keeps the old same-origin rule.
 */

export const APP_ORIGINS_ENV = 'PLANNER_APP_ORIGINS';

type EnvSource = Record<string, string | undefined>;

/**
 * The shell origins that are expected to be configured in practice. Kept here
 * for the docs and for the build-time warning, never as an implicit default.
 */
export const KNOWN_SHELL_ORIGINS = ['capacitor://localhost', 'https://localhost', 'app://planner'] as const;

/** `https://example.com:443/` → `https://example.com`. Null when unusable. */
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  // Bare origins only: no wildcard, no credentials, no path, no query.
  if (/[*?#]/.test(trimmed) || trimmed.includes('@')) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return null;
  if (url.pathname !== '' && url.pathname !== '/') return null;
  if (!url.hostname) return null;
  const host = url.hostname.toLowerCase();
  const effectivePort = url.port && !isDefaultPort(scheme, url.port) ? `:${url.port}` : '';
  return `${scheme}://${host}${effectivePort}`;
}

function isDefaultPort(scheme: string, port: string): boolean {
  return (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80');
}

const cache = new Map<string, string[]>();

/** The allow-list, parsed and normalized. Malformed entries are dropped. */
export function configuredAppOrigins(raw: string | undefined | EnvSource = readEnv(APP_ORIGINS_ENV)): string[] {
  const value = typeof raw === 'string' ? raw : (raw ?? {})[APP_ORIGINS_ENV];
  const key = value ?? '';
  const cached = cache.get(key);
  if (cached) return cached;
  const parsed = (value ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);
  const unique = [...new Set(parsed)];
  if (cache.size > 50) cache.clear();
  cache.set(key, unique);
  return unique;
}

function readEnv(name: string): string | undefined {
  try {
    return typeof process !== 'undefined' ? process.env?.[name] : undefined;
  } catch {
    return undefined;
  }
}

/** The request's `Origin` header, lowercased, or null when it has none. */
export function requestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin')?.trim();
  if (!origin) return null;
  return normalizeOrigin(origin) ?? origin.toLowerCase();
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function requestHosts(request: Request): string[] {
  return [request.headers.get('host'), hostOf(request.url)]
    .flatMap((value) => (value ? value.split(',') : []))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * An allow-listed shell origin, in the exact form to echo back in CORS
 * headers — or null when this request is not from one.
 */
export function allowedAppOrigin(
  request: Request,
  raw: string | undefined = readEnv(APP_ORIGINS_ENV),
): string | null {
  const origin = requestOrigin(request);
  if (!origin) return null;
  if (!configuredAppOrigins(raw).includes(origin)) return null;
  // A shell origin that is also this deployment's own host is just same-origin.
  if (requestHosts(request).includes(hostOf(origin) ?? '')) return null;
  return origin;
}

/**
 * The CORS headers a shell needs, or null when this is not a shell request.
 * `Vary: Origin` keeps any cache from handing one origin's answer to another.
 */
export function corsHeadersForRequest(
  request: Request,
  raw: string | undefined = readEnv(APP_ORIGINS_ENV),
): Record<string, string> | null {
  const origin = allowedAppOrigin(request, raw);
  if (!origin) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

/**
 * Answer a shell's preflight. Only allow-listed origins ever reach this, so
 * the requested headers can be echoed back as asked.
 */
export function preflightResponse(
  request: Request,
  raw: string | undefined = readEnv(APP_ORIGINS_ENV),
): Response | null {
  const headers = corsHeadersForRequest(request, raw);
  if (!headers) return null;
  const requested = request.headers.get('access-control-request-headers');
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': requested?.trim() || 'Content-Type',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
      Vary: requested ? 'Origin, Access-Control-Request-Headers' : 'Origin',
    },
  });
}

/**
 * Trusted cross-origin request: the origin is explicitly allowed, so it is
 * treated exactly like a same-origin call. `Sec-Fetch-Site: cross-site` is
 * expected here — the shell is a different origin by design.
 */
export function isTrustedAppOriginRequest(request: Request): boolean {
  return allowedAppOrigin(request) !== null;
}
