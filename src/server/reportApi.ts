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
import { cleanDatabaseUrl, DatabaseConfigError, redactDatabaseError } from './authStore.js';

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
  // Nothing past `limit` can survive the clamp, so nothing past it is scanned.
  // The patterns below backtrack quadratically on a long run of one character
  // (`'y'.repeat(50_000)` through the email pattern is seconds of CPU), and
  // this endpoint is unauthenticated: scanning the body cap instead of the
  // kept window would let one report pay for a 32 KB run of single characters.
  const truncated = value.length > limit;
  const redacted = (truncated ? value.slice(0, limit) : value)
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.?[A-Za-z0-9_-]*/g, '<token>')
    .replace(/(?:bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '<token>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(OPAQUE, '<data>')
    .replace(/\s+/g, ' ')
    .trim();
  const clipped = clamp(redacted, limit);
  // Redaction shortens text, so say plainly when the original was cut.
  return truncated && !clipped.endsWith('…') ? `${clipped}…` : clipped;
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
export async function handleReport(request: Request, webhook?: string, databaseUrl?: string): Promise<Response> {
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
  // Persist before answering: a serverless function may be frozen the instant
  // the response is sent, and a report that only reached a log line is exactly
  // the report nobody can count. A storage failure must not fail the intake —
  // the 204 is a promise that the report was taken, and it was: the log line
  // above is unconditional.
  try {
    const sql = await reportDatabase(databaseUrl);
    if (sql) {
      await storeReport(sql, report);
      // Alert once per crossing, not once per report: the count reaching the
      // threshold is the event, and everything after it is the same outage.
      const count = await countRecent(sql, report.message, new Date(Date.now() - ALERT_WINDOW_MS).toISOString());
      if (count === ALERT_THRESHOLD) forwardReport({ ...report, kind: 'alert' }, webhook);
    }
  } catch (error) {
    console.error(`[planner:report] could not store report: ${redactDatabaseError(error)}`);
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...API_SECURITY_HEADERS } });
}

// ── The sink, the dashboard and the alert rule ─────────────────────────────
//
// Logs are the sink that always exists: every report is one structured line,
// and hosts forward those to whatever drain is configured. That is where the
// trail should live, and it is also a place nobody looks while a release is
// going wrong.
//
// So reports are also *stored*, when a database is configured: one row each,
// pruned to a recent window, read back by `GET /api/report/recent`. That
// endpoint answers JSON for a script and a small HTML page for a person, and it
// groups by message — because "this one error has happened 240 times since the
// release" is the fact that matters, and it is invisible in a list.
//
// Alerting is deliberately not a pager: a serverless function has no memory to
// alert from, and inventing state it cannot keep is how alerting ends up
// quietly broken. Two honest mechanisms instead:
//
//   1. `alerts` in the dashboard response: any message that crossed the
//      threshold inside the window. Anything that can fetch a URL can poll it
//      once a minute and page someone — including the same cron that already
//      drives push reminders.
//   2. `ERROR_REPORT_WEBHOOK`, when a message *crosses* the threshold on
//      insert, receives one extra post with `alert: true`. Exactly once per
//      crossing, so it is a signal rather than a stream.

/** Rows kept in the table. A crash loop can produce thousands in a minute. */
const REPORT_ROWS_KEPT = 500;
/** A message this many times inside the window is worth waking someone for. */
export const ALERT_THRESHOLD = 5;
export const ALERT_WINDOW_MS = 60 * 60 * 1000;
/** How far back the dashboard reads by default. */
export const DASHBOARD_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The slice of the Neon client this module needs; tests pass their own. */
export type ReportSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

/**
 * Create the table if it is not there. Called on every write: `CREATE TABLE IF
 * NOT EXISTS` is cheap, and a migration nobody runs is worse than one line of
 * SQL repeated.
 */
export async function ensureReportTable(sql: ReportSql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS planner_reports (
    id text PRIMARY KEY,
    at timestamptz NOT NULL,
    kind text NOT NULL,
    message text NOT NULL,
    area text,
    action text,
    route text,
    surface text,
    lang text,
    release text,
    session text,
    uptime integer,
    stack text,
    component_stack text,
    extra jsonb,
    breadcrumbs jsonb
  )`;
  await sql`CREATE INDEX IF NOT EXISTS planner_reports_at_idx ON planner_reports (at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS planner_reports_message_idx ON planner_reports (message)`;
}

export async function storeReport(sql: ReportSql, report: StoredReport): Promise<void> {
  await ensureReportTable(sql);
  await sql`INSERT INTO planner_reports (id, at, kind, message, area, action, route, surface, lang, release, session, uptime, stack, component_stack, extra, breadcrumbs)
    VALUES (${report.id}, ${report.at}, ${report.kind}, ${report.message}, ${report.area ?? null}, ${report.action ?? null},
      ${report.route ?? null}, ${report.surface ?? null}, ${report.lang ?? null}, ${report.release ?? null}, ${report.session ?? null},
      ${report.uptime ?? null}, ${report.stack ?? null}, ${report.componentStack ?? null},
      ${report.extra ? JSON.stringify(report.extra) : null}, ${JSON.stringify(report.breadcrumbs)})
    ON CONFLICT (id) DO NOTHING`;
  // Pruning by row count rather than by age: a quiet deployment keeps its
  // history, and a loud one cannot fill the table.
  await sql`DELETE FROM planner_reports WHERE id IN (
    SELECT id FROM planner_reports ORDER BY at DESC OFFSET ${REPORT_ROWS_KEPT}
  )`;
}

/** How many times this message has been stored since `since`. */
export async function countRecent(sql: ReportSql, message: string, since: string): Promise<number> {
  const rows = (await sql`SELECT count(*)::int AS count FROM planner_reports WHERE message = ${message} AND at >= ${since}`) as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 0);
}

export async function recentReports(sql: ReportSql, since: string, limit = 200): Promise<StoredReport[]> {
  const rows = (await sql`SELECT id, at, kind, message, area, route, release, session, stack, uptime, extra, breadcrumbs
    FROM planner_reports WHERE at >= ${since} ORDER BY at DESC LIMIT ${limit}`) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const report: StoredReport = {
      id: String(row.id ?? ''),
      at: row.at instanceof Date ? row.at.toISOString() : String(row.at ?? ''),
      kind: String(row.kind ?? 'error'),
      message: String(row.message ?? ''),
      breadcrumbs: Array.isArray(row.breadcrumbs) ? (row.breadcrumbs as StoredReport['breadcrumbs']) : [],
    };
    if (row.area) report.area = String(row.area);
    if (row.route) report.route = String(row.route);
    if (row.release) report.release = String(row.release);
    if (row.session) report.session = String(row.session);
    if (row.stack) report.stack = String(row.stack);
    if (typeof row.uptime === 'number') report.uptime = row.uptime;
    if (row.extra && typeof row.extra === 'object') report.extra = row.extra as Record<string, string>;
    return report;
  });
}

/** Reports kept in memory when there is no database (development, tests). */
export function memoryReports(): StoredReport[] {
  return inbox.map((item) => ({ ...item }));
}

export interface ReportGroup {
  message: string;
  count: number;
  first: string;
  last: string;
  kind: string;
  releases: string[];
  areas: string[];
  routes: string[];
  /** Worth waking someone: this many occurrences inside the alert window. */
  alerting: boolean;
}

export interface ReportOverview {
  windowMs: number;
  total: number;
  groups: ReportGroup[];
  /** The subset of `groups` past the threshold: exactly what to page on. */
  alerts: ReportGroup[];
  recent: StoredReport[];
}

/**
 * Group reports by message, newest group first, and mark the ones past the
 * threshold. Pure, so the rule can be tested without a database or a request.
 */
export function groupReports(reports: StoredReport[], now = Date.now(), windowMs = DASHBOARD_WINDOW_MS): ReportOverview {
  const groups = new Map<string, ReportGroup>();
  for (const report of reports) {
    const at = Date.parse(report.at);
    const existing = groups.get(report.message);
    if (!existing) {
      groups.set(report.message, {
        message: report.message,
        count: 1,
        first: report.at,
        last: report.at,
        kind: report.kind,
        releases: report.release ? [report.release] : [],
        areas: report.area ? [report.area] : [],
        routes: report.route ? [report.route] : [],
        alerting: false,
      });
      continue;
    }
    existing.count += 1;
    if (Number.isFinite(at) && Date.parse(existing.first) > at) existing.first = report.at;
    if (Number.isFinite(at) && Date.parse(existing.last) < at) existing.last = report.at;
    if (report.release && !existing.releases.includes(report.release)) existing.releases.push(report.release);
    if (report.area && !existing.areas.includes(report.area)) existing.areas.push(report.area);
    if (report.route && !existing.routes.includes(report.route)) existing.routes.push(report.route);
  }
  const list = [...groups.values()];
  for (const group of list) {
    // The alert rule counts *recent* occurrences, not total ones: twenty
    // reports spread over a month is a chronic annoyance, ten in an hour is an
    // outage.
    group.alerting = countInsideWindow(reports, group.message, now - ALERT_WINDOW_MS) >= ALERT_THRESHOLD;
  }
  list.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
  return {
    windowMs,
    total: reports.length,
    groups: list,
    alerts: list.filter((group) => group.alerting),
    recent: reports.slice(0, 50),
  };
}

function countInsideWindow(reports: StoredReport[], message: string, since: number): number {
  let count = 0;
  for (const report of reports) {
    if (report.message !== message) continue;
    const at = Date.parse(report.at);
    if (Number.isFinite(at) && at >= since) count += 1;
  }
  return count;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&#38;').replace(/</g, '&#60;').replace(/>/g, '&#62;').replace(/"/g, '&#34;');
}

/**
 * The dashboard, as a page a person can read at 2am.
 *
 * Deliberately self-contained: inline styles, no scripts, no fonts, no
 * external anything — it is served by the same function that takes the reports,
 * and it must work when the rest of the deployment is having a bad day.
 */
export function reportDashboardHtml(overview: ReportOverview, now = new Date()): string {
  const alerting = overview.groups.filter((group) => group.alerting);
  const rows = overview.groups
    .map(
      (group) => `<tr class="${group.alerting ? 'hot' : ''}">
      <td class="count">${group.count}</td>
      <td>
        <p class="message">${escapeHtml(group.message)}</p>
        <p class="meta">${escapeHtml(group.kind)}${group.areas.length ? ` · ${escapeHtml(group.areas.join(', '))}` : ''}${
          group.releases.length ? ` · ${escapeHtml(group.releases.join(', '))}` : ''
        }</p>
      </td>
      <td class="when">${escapeHtml(group.last)}<br /><span>first ${escapeHtml(group.first)}</span></td>
    </tr>`,
    )
    .join('');
  const recent = overview.recent
    .map(
      (report) => `<li><span class="when">${escapeHtml(report.at)}</span> <strong>${escapeHtml(report.message)}</strong>${
        report.route ? ` <span class="meta">${escapeHtml(report.route)}</span>` : ''
      }</li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Planner crash reports</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 60rem; padding: 2rem 1rem 4rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  p.lede { margin: 0 0 1.5rem; opacity: .75; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: start; padding: .55rem .6rem; border-bottom: 1px solid rgba(128,128,128,.3); vertical-align: top; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; opacity: .6; }
  td.count { font-variant-numeric: tabular-nums; font-weight: 600; width: 4rem; }
  p.message { margin: 0; }
  p.meta, span.meta { margin: .15rem 0 0; font-size: .82rem; opacity: .65; }
  .when { white-space: nowrap; font-size: .82rem; opacity: .8; }
  .when span { opacity: .7; }
  tr.hot td.count { color: #b3261e; }
  tr.hot { background: rgba(179,38,30,.06); }
  .banner { border: 1px solid rgba(179,38,30,.5); background: rgba(179,38,30,.08); padding: .75rem 1rem; border-radius: .5rem; margin-bottom: 1.25rem; }
  .banner p { margin: 0; }
  ul { padding-inline-start: 1.1rem; }
  li { margin: .3rem 0; }
  code { font-family: ui-monospace, monospace; }
</style></head>
<body>
  <h1>Crash reports</h1>
  <p class="lede">Last ${Math.round(overview.windowMs / 3_600_000)} hours · ${overview.total} report(s) · ${overview.groups.length} distinct message(s) · page rendered ${escapeHtml(now.toISOString())}</p>
  ${
    alerting.length
      ? `<div class="banner"><p><strong>${alerting.length} message(s) crossed the alert threshold</strong> — ${ALERT_THRESHOLD} occurrences in the last hour. This is the condition to page on.</p></div>`
      : ''
  }
  <table>
    <thead><tr><th>Count</th><th>Message</th><th>Last seen</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">Nothing reported in this window.</td></tr>'}</tbody>
  </table>
  <h2 style="font-size:1.1rem;margin-top:2.5rem;">Newest first</h2>
  <ul>${recent || '<li>Nothing reported in this window.</li>'}</ul>
  <p class="meta">Reports are redacted before they are stored, and never contain planner content. Refresh to re-read.</p>
</body></html>`;
}

/** A read window: `30m`, `24h`, `7d`. Anything past a week is not a dashboard. */
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export function parseWindow(value: string | null): number {
  const match = value ? /^(\d{1,4})(m|h|d)$/.exec(value.trim().toLowerCase()) : null;
  if (!match) return DASHBOARD_WINDOW_MS;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return DASHBOARD_WINDOW_MS;
  const unit = match[2] === 'm' ? 60_000 : match[2] === 'h' ? 3_600_000 : 86_400_000;
  return Math.min(amount * unit, MAX_WINDOW_MS);
}

/**
 * `GET /api/report/recent` — the dashboard.
 *
 * Off unless `REPORT_DASHBOARD_SECRET` is set: an endpoint that lists the
 * deployment's error messages is not something to serve by default. When it is
 * set, the secret is the only credential, so the check is a constant-time
 * comparison of the whole `Authorization` header.
 */
export async function handleReportOverview(
  request: Request,
  env: { DATABASE_URL?: string; REPORT_DASHBOARD_SECRET?: string } = {},
): Promise<Response> {
  const secret = env.REPORT_DASHBOARD_SECRET?.trim();
  if (!secret) return json(404, { error: { message: 'Not found.' } });
  if (request.method !== 'GET') return json(405, { error: { message: 'Method not allowed.' } }, { Allow: 'GET' });
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length || !timingSafeEqual(header, expected)) {
    return json(401, { error: { message: 'Unauthorized.' } });
  }
  const limited = rateLimitResponse(request, 'report-dashboard', 30, 60_000);
  if (limited) return limited;

  const windowMs = parseWindow(new URL(request.url).searchParams.get('window'));
  const since = new Date(Date.now() - windowMs).toISOString();
  let reports: StoredReport[];
  try {
    const sql = await reportDatabase(env.DATABASE_URL);
    reports = sql ? await recentReports(sql, since) : memoryReportsInWindow(since);
  } catch (error) {
    return json(503, { error: { message: `Could not read reports: ${redactDatabaseError(error)}` } });
  }
  const overview = groupReports(reports, Date.now(), windowMs);
  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'html') {
    return new Response(reportDashboardHtml(overview), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }
  return json(200, overview);
}

/** The in-memory inbox, filtered the same way the database read is. */
function memoryReportsInWindow(since: string): StoredReport[] {
  const cut = Date.parse(since);
  return inbox.filter((report) => {
    const at = Date.parse(report.at);
    return !Number.isFinite(at) || at >= cut;
  });
}

/** Constant-time string comparison, so the secret cannot be probed by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

async function reportDatabase(databaseUrl?: string): Promise<ReportSql | null> {
  const url = cleanDatabaseUrl(databaseUrl ?? '');
  if (!url) return null;
  const { neon } = await import('@neondatabase/serverless');
  let sql: unknown;
  try {
    sql = neon(url);
  } catch (error) {
    throw new DatabaseConfigError(`DATABASE_URL is not a valid database connection string. (${redactDatabaseError(error)})`);
  }
  return sql as ReportSql;
}
