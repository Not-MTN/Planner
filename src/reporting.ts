/**
 * Crash and error reporting for the browser build.
 *
 * The vault is zero-knowledge: the server cannot read a single task, event, or
 * note, and nothing here may change that. A report therefore carries only what
 * a developer needs to reproduce a crash — the message, the stack, the screen
 * the user was on, and the last few things the app did (breadcrumbs) — and
 * never the content the user typed. Every string passes through `redactText`
 * on the way out, which strips e-mail addresses, tokens, long opaque blobs and
 * URL query strings.
 *
 * Three properties matter and are covered by tests:
 *
 *  1. Reporting can never break the app it reports on. Every entry point is
 *     wrapped so a failure inside the reporter is swallowed.
 *  2. Reporting can never loop. A report is one `fetch`; if that fails we drop
 *     it rather than report the report.
 *  3. Reporting is quiet. Duplicate errors are collapsed and a hard per-page
 *     cap stops a render loop from flooding the endpoint.
 */

import { isTestEnv } from './env';

/** Report endpoint. Same-origin, so no CORS surface and no third-party call. */
export const REPORT_ENDPOINT = '/api/report';

/** How many breadcrumbs a report carries. Oldest are dropped first. */
const BREADCRUMB_LIMIT = 30;
/** Reports sent from one page load, at most. A render loop must not flood us. */
const REPORT_LIMIT_PER_PAGE = 8;
/** The same error twice inside this window is counted, not sent again. */
const DEDUPE_WINDOW_MS = 60_000;
/** Longest string kept for any single field. */
const FIELD_LIMIT = 500;
/** Stack frames kept. Deeper frames are framework internals. */
const STACK_FRAME_LIMIT = 8;

export interface Breadcrumb {
  /** Milliseconds since the page loaded — small, stable, and not a clock. */
  at: number;
  /** Short label: 'nav', 'ai', 'sync', 'vault', 'feed', 'task', 'ui'. */
  kind: string;
  /** One redacted line of human-readable detail. */
  detail: string;
}

export interface ErrorContext {
  /** Where in the app this happened, e.g. 'shell', 'calendar', 'ai'. */
  area?: string;
  /** What the user was doing, e.g. 'ask', 'save', 'import'. */
  action?: string;
  /** The React component stack, for errors caught by a boundary. */
  componentStack?: string;
  /** A handful of short, already-safe details. Values are redacted. */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

interface ReportPayload {
  id: string;
  at: string;
  kind: 'error' | 'promise';
  message: string;
  stack?: string;
  source?: string;
  componentStack?: string;
  area?: string;
  action?: string;
  extra?: Record<string, string>;
  /** 'app' or 'site'; tells us which bundle to look in. */
  surface: string;
  /** Location without the query string — query strings hold share codes. */
  route: string;
  lang: string;
  release: string;
  /** Random per page load, never persisted. Groups the breadcrumbs of a crash. */
  session: string;
  /** Milliseconds the page had been open. Catches "it always breaks at boot". */
  uptime: number;
  breadcrumbs: Breadcrumb[];
}

/** Reusable opt-out key — the Settings switch writes the same value. */
const OPT_OUT_KEY = 'planner-error-reports';

let enabled: boolean | null = null;
const startedAt = Date.now();
const sessionId = randomId();
const breadcrumbs: Breadcrumb[] = [];
let sent = 0;
const recentlySent = new Map<string, number>();
let transport: ((body: string) => void) | null = null;

/**
 * True once `installGlobalErrorHandlers` has run, so tests can assert on the
 * wiring, and so a second install is a no-op.
 */
let installed = false;
/** Lifted only by `enableReportingInTests`. */
let testOverride = false;

export function isReportingInstalled(): boolean {
  return installed;
}

function randomId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

function safeReadItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode, disabled storage, or a blocked origin.
    return null;
  }
}

function safeWriteItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * Whether crash reports leave the device.
 *
 * On by default — a crash report holds no planner content, and without one the
 * only way we learn about a breakage is a user who writes in. Off permanently
 * once the user says so in Settings, and off for anyone who has asked the
 * browser not to track them.
 */
export function isReportingEnabled(): boolean {
  if (enabled !== null) return enabled;
  const saved = safeReadItem(OPT_OUT_KEY);
  if (saved === 'off') {
    enabled = false;
    return enabled;
  }
  const dnt = typeof navigator !== 'undefined' && navigator.doNotTrack === '1';
  enabled = saved === 'on' || !dnt;
  return enabled;
}

/** Turn crash reporting on or off. The choice is remembered on this device. */
export function setReportingEnabled(next: boolean): void {
  enabled = next;
  safeWriteItem(OPT_OUT_KEY, next ? 'on' : 'off');
}

/**
 * Remove anything that could carry user content or a credential.
 *
 * Deliberately blunt: we would rather lose a little detail from a stack trace
 * than ever ship an address, a share code, or a token.
 */
export function redactText(value: string, limit = FIELD_LIMIT): string {
  let out = value;
  // JSON Web Tokens and anything JWT-shaped.
  out = out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.?[A-Za-z0-9_-]*/g, '<token>');
  // Bearer / Basic credentials.
  out = out.replace(/(?:bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '<token>');
  // E-mail addresses.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
  // URLs: keep the path, drop the query and fragment, which hold share codes.
  out = out.replace(/\bhttps?:\/\/[^\s'"<>)]+/gi, (url) => {
    const trimmed = url.replace(/[),.;]+$/, '');
    const queryAt = trimmed.search(/[?#]/);
    return queryAt === -1 ? trimmed : `${trimmed.slice(0, queryAt)}?<query>`;
  });
  // Relative paths with a query — `/api/sync?code=…` is the one that matters.
  out = out.replace(/(\/[A-Za-z0-9._~%+-]+)\?[^\s'"`)]*/g, '$1?<query>');
  // Opaque blobs: base64 or hex runs. Keys, ciphertext, wrap keys, hashes.
  out = out.replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, '<data>');
  // Identifiers: UUIDs and UUID-like ids.
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>');
  // Long digit runs (phone numbers, card-ish strings).
  out = out.replace(/\b\d{9,}\b/g, '<number>');
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > limit ? `${out.slice(0, limit)}…` : out;
}

/** Keep only the tail of a path: everything before it is host and deploy detail. */
function tail(value: string): string {
  const segments = value.split('/').filter(Boolean);
  if (segments.length <= 3) return value;
  return `…/${segments.slice(-3).join('/')}`;
}

/**
 * Strip origins and home directories out of a line of stack trace.
 *
 * The absolute URL of the bundle says nothing useful to us, and a
 * `/home/<name>/...` path says something about the user that has no business
 * in a log — so both are reduced to the three segments that identify a file.
 */
function shortenPaths(line: string): string {
  return line
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi, (url) => tail(url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/\s]*/i, '')))
    .replace(/(?:[A-Za-z0-9._~%+-]+\/){3,}[A-Za-z0-9._~%+-:]+/g, (path) => tail(path));
}

/**
 * Trim a stack to its useful frames, redact each line, and strip hostnames and
 * query strings.
 *
 * The per-line redaction is the point. An error's `message` is often clean
 * while its stack still carries whatever was in scope — a file path, a query
 * string, an id. Redacting the message alone would leak all of it.
 */
export function redactStack(stack: string): string {
  return stack
    .split('\n')
    .slice(0, STACK_FRAME_LIMIT)
    .map((line) => shortenPaths(redactText(line, 400)))
    .join('\n')
    .slice(0, 2000);
}

/** Record something that happened. Kept in memory only, never written to disk. */
export function addBreadcrumb(kind: string, detail: string): void {
  try {
    const line = redactText(detail, 200);
    if (!line) return;
    breadcrumbs.push({ at: Date.now() - startedAt, kind: redactText(kind, 24), detail: line });
    if (breadcrumbs.length > BREADCRUMB_LIMIT) breadcrumbs.splice(0, breadcrumbs.length - BREADCRUMB_LIMIT);
  } catch {
    /* never let a breadcrumb break a feature */
  }
}

/** Test hook: forget every breadcrumb recorded so far. */
export function resetBreadcrumbs(): void {
  breadcrumbs.length = 0;
}

/** Test hook: the breadcrumbs a report would carry. */
export function currentBreadcrumbs(): Breadcrumb[] {
  return breadcrumbs.map((item) => ({ ...item }));
}

function currentRoute(): string {
  try {
    const { pathname, hash } = window.location;
    return `${pathname}${hash}`.slice(0, 200);
  } catch {
    return '';
  }
}

function currentSurface(): string {
  try {
    return window.location.pathname.startsWith('/app') ? 'app' : 'site';
  } catch {
    return 'app';
  }
}

function currentLang(): string {
  try {
    return document.documentElement.lang || 'en';
  } catch {
    return 'en';
  }
}

/** Override the sender. Tests use this instead of touching the network. */
export function setReportTransport(next: ((body: string) => void) | null): void {
  transport = next;
}

/** Test hook: forget the per-page counters. */
export function resetReportCounters(): void {
  sent = 0;
  recentlySent.clear();
}

/** Test hook: let reports through even under Vitest, where they are off. */
export function enableReportingInTests(): void {
  testOverride = true;
  enabled = true;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error('Unknown error');
  }
}

/** Build the payload. Exported so tests can inspect exactly what would be sent. */
export function buildReportPayload(
  error: unknown,
  kind: 'error' | 'promise' = 'error',
  context: ErrorContext = {},
  now = Date.now(),
): ReportPayload {
  const err = toError(error);
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(context.extra ?? {})) {
    if (value === null || value === undefined) continue;
    extra[key] = redactText(String(value), 120);
  }
  const payload: ReportPayload = {
    id: randomId(),
    at: new Date(now).toISOString(),
    kind,
    message: redactText(err.message || err.name || 'Unknown error', 300),
    route: currentRoute(),
    surface: currentSurface(),
    lang: currentLang(),
    release: import.meta.env.MODE,
    session: sessionId,
    uptime: now - startedAt,
    breadcrumbs: breadcrumbs.map((item) => ({ ...item })),
  };
  if (err.stack) payload.stack = redactStack(err.stack);
  if (context.area) payload.area = redactText(context.area, 60);
  if (context.action) payload.action = redactText(context.action, 60);
  if (context.componentStack) payload.componentStack = redactStack(context.componentStack);
  if (Object.keys(extra).length) payload.extra = extra;
  return payload;
}

/**
 * Send one error report.
 *
 * Returns the report id when something was sent, and `null` when it was
 * suppressed (reporting off, duplicate, over the per-page cap, or running
 * under a test). Safe to call from anywhere, including a `catch` that is
 * already on its last legs: this never throws and never re-enters itself.
 */
export function reportError(error: unknown, context: ErrorContext = {}): string | null {
  try {
    if (isTestEnv() && !testOverride) return null;
    if (!isReportingEnabled()) return null;
    if (sent >= REPORT_LIMIT_PER_PAGE) return null;

    const payload = buildReportPayload(error, 'error', context);
    // Collapse repeats: a component that throws on every render would
    // otherwise send the same report on every frame.
    const fingerprint = `${payload.message}|${payload.stack?.split('\n')[1] ?? ''}|${payload.area ?? ''}`;
    const lastSentAt = recentlySent.get(fingerprint);
    if (lastSentAt !== undefined && Date.now() - lastSentAt < DEDUPE_WINDOW_MS) return null;
    recentlySent.set(fingerprint, Date.now());

    sent += 1;
    const body = JSON.stringify(payload);
    if (transport) {
      transport(body);
      return payload.id;
    }
    // `keepalive: true` lets the request survive a page that is closing, which
    // is exactly when crashes happen. If it fails, drop it — never report the
    // report.
    void fetch(REPORT_ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => undefined);
    return payload.id;
  } catch {
    return null;
  }
}

/**
 * Report a failure the app has already handled — a failed AI call, a sync that
 * did not land. The user sees the normal message; we still learn it broke.
 */
export function reportCaught(error: unknown, context: ErrorContext = {}): string | null {
  return reportError(error, context);
}

/**
 * Wire up the two listeners that catch everything React does not: a thrown
 * error in an event handler or timer, and a promise nobody awaited.
 * Idempotent, because `main.tsx` may run more than once in a long session.
 */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    // Cross-origin scripts report as a bare "Script error." with no detail;
    // there is nothing to learn from them.
    const error = event.error ?? (event.message ? new Error(event.message) : new Error('Unknown error'));
    reportError(error, {
      area: 'window',
      action: 'uncaught',
      extra: { source: `${shortenPaths(event.filename ?? '')}:${event.lineno ?? 0}:${event.colno ?? 0}` },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { area: 'window', action: 'unhandled-rejection' });
  });

  window.addEventListener('hashchange', () => addBreadcrumb('nav', currentRoute()));
  window.addEventListener('online', () => addBreadcrumb('net', 'back online'));
  window.addEventListener('offline', () => addBreadcrumb('net', 'went offline'));
}

/**
 * Wrap an async function so a throw is reported before it propagates.
 *
 * For the places where the caller is already showing the user a message and
 * simply wants us to hear about it too.
 */
export async function reported<T>(
  area: string,
  action: string,
  run: () => Promise<T>,
  extra?: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  addBreadcrumb(area, `${action}: started`);
  try {
    const result = await run();
    addBreadcrumb(area, `${action}: done`);
    return result;
  } catch (error) {
    addBreadcrumb(area, `${action}: failed`);
    reportCaught(error, { area, action, extra });
    throw error;
  }
}
