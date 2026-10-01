/**
 * Crash-report intake.
 *
 * The browser sends what `src/reporting.ts` produces: a message, a stack, the
 * screen the user was on, and the last breadcrumbs — never planner content,
 * because the server could not decrypt it even if it were sent.
 *
 * This endpoint still treats the payload as hostile. Anything can POST here,
 * so every field is re-redacted, length-clamped and type-checked before it is
 * logged, and the whole body is capped so the endpoint cannot be used to park
 * data or to blow up a log line.
 */

import { API_SECURITY_HEADERS, BodyTooLargeError, rateLimitResponse, readLimitedBody } from './security.js';
import { isSameOriginRequest } from './groqProxy.js';

/** A report body is small. Anything larger is not a report. */
const MAX_REPORT_BYTES = 32 * 1024;
/** Per-client throttle. A render loop on one device must not fill the log. */
const REPORT_LIMIT = 20;
const REPORT_WINDOW_MS = 60_000;

const FIELD = 500;
const SHORT = 120;

/** Opaque runs long enough to be a key, a blob, or a ciphertext. */
const OPAQUE = /\b[A-Za-z0-9+/=_-]{32,}\b/g;

function clamp(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/** Second pass over the client's redaction: the client is not trusted. */
export function redactReportText(value: string, limit = FIELD): string {
  return clamp(
    value
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.?[A-Za-z0-9_-]*/g, '<token>')
      .replace(/(?:bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '<token>')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
      .replace(OPAQUE, '<data>')
      .replace(/\s+/g, ' ')
      .trim(),
    limit,
  );
}

export interface StoredReport {
  id: string;
  at: string;
  kind: string;
  message: string;
  area?: string;
  action?: string;
  route?: string;
  surface?: string;
  lang?: string;
  release?: string;
  session?: string;
  uptime?: number;
  stack?: string;
  componentStack?: string;
  extra?: Record<string, string>;
  breadcrumbs: { at: number; kind: string; detail: string }[];
}

function str(value: unknown, limit = FIELD): string | undefined {
  if (typeof value !== 'string') return undefined;
  const out = redactReportText(value, limit);
  return out || undefined;
}

/**
 * Turn an untrusted JSON value into a report with every field bounded.
 * Unknown keys are dropped rather than passed through to the log.
 */
export function normalizeReport(value: unknown): StoredReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const message = str(raw.message, 300);
  if (!message) return null;

  const report: StoredReport = {
    id: str(raw.id, 40) ?? 'unknown',
    at: str(raw.at, 40) ?? new Date().toISOString(),
    kind: str(raw.kind, 20) ?? 'error',
    message,
    breadcrumbs: [],
  };
  const area = str(raw.area, SHORT);
  const action = str(raw.action, SHORT);
  const route = str(raw.route, 200);
  const surface = str(raw.surface, 20);
  const lang = str(raw.lang, 10);
  const release = str(raw.release, 40);
  const session = str(raw.session, 40);
  const stack = str(raw.stack, 2000);
  const componentStack = str(raw.componentStack, 2000);
  if (area) report.area = area;
  if (action) report.action = action;
  if (route) report.route = route;
  if (surface) report.surface = surface;
  if (lang) report.lang = lang;
  if (release) report.release = release;
  if (session) report.session = session;
  if (stack) report.stack = stack;
  if (componentStack) report.componentStack = componentStack;
  if (typeof raw.uptime === 'number' && Number.isFinite(raw.uptime)) report.uptime = Math.trunc(raw.uptime);

  if (raw.extra && typeof raw.extra === 'object' && !Array.isArray(raw.extra)) {
    const extra: Record<string, string> = {};
    for (const [key, entry] of Object.entries(raw.extra as Record<string, unknown>)) {
      if (Object.keys(extra).length >= 10) break;
      const safeKey = redactReportText(String(key).slice(0, 40), 40);
      const safeValue = str(entry, 120);
      if (safeKey && safeValue) extra[safeKey] = safeValue;
    }
    if (Object.keys(extra).length) report.extra = extra;
  }

  if (Array.isArray(raw.breadcrumbs)) {
    for (const entry of raw.breadcrumbs.slice(0, 30)) {
      if (!entry || typeof entry !== 'object') continue;
      const crumb = entry as Record<string, unknown>;
      const detail = str(crumb.detail, 200);
      if (!detail) continue;
      report.breadcrumbs.push({
        at: typeof crumb.at === 'number' && Number.isFinite(crumb.at) ? Math.trunc(crumb.at) : 0,
        kind: str(crumb.kind, 24) ?? '?',
        detail,
      });
    }
  }
  return report;
}

/**
 * Where reports go. Server logs are the sink that always exists; set
 * `ERROR_REPORT_WEBHOOK` to also POST each report somewhere you read.
 */
const inbox: StoredReport[] = [];
const INBOX_LIMIT = 50;

/** Test hook: the reports received since the last reset. */
export function reportInbox(): StoredReport[] {
  return inbox.map((item) => ({ ...item }));
}

/** Test hook: clear the inbox. */
export function resetReportInbox(): void {
  inbox.length = 0;
}

function record(report: StoredReport): void {
  inbox.push(report);
  if (inbox.length > INBOX_LIMIT) inbox.splice(0, inbox.length - INBOX_LIMIT);
  // One structured line per report. `console.error` is what Vercel (and every
  // other host) captures and forwards to log drains.
  console.error(`[planner:report] ${JSON.stringify(report)}`);
}

/**
 * Fire-and-forget forward. A webhook that is down must not make report intake
 * fail, and must not be waited on: the browser is already gone.
 */
export function forwardReport(report: StoredReport, webhook: string | undefined): void {
  if (!webhook) return;
  void fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `[${report.kind}] ${report.message}`, report }),
  }).catch(() => undefined);
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
      ...extra,
    },
  });
}

/**
 * `POST /api/report`.
 *
 * The reply is always an empty 204: whether a report was accepted is not
 * information a caller needs, and echoing it back would only help an attacker
 * probe the limiter.
 */
export async function handleReport(request: Request, webhook?: string): Promise<Response> {
  if (!isSameOriginRequest(request)) return json(403, { error: { message: 'Cross-origin report requests are not allowed.' } });
  if (request.method !== 'POST') return json(405, { error: { message: 'Method not allowed.' } }, { Allow: 'POST' });

  const limited = rateLimitResponse(request, 'report', REPORT_LIMIT, REPORT_WINDOW_MS);
  if (limited) return limited;

  let body: string;
  try {
    body = await readLimitedBody(request, MAX_REPORT_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json(413, { error: { message: 'Report too large.' } });
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, { error: { message: 'Report must be JSON.' } });
  }

  const report = normalizeReport(parsed);
  if (!report) return json(400, { error: { message: 'Report is missing a message.' } });

  record(report);
  forwardReport(report, webhook);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...API_SECURITY_HEADERS } });
}
