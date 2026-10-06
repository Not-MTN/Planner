import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_THRESHOLD,
  countRecent,
  ensureReportTable,
  groupReports,
  handleReport,
  handleReportOverview,
  memoryReports,
  normalizeReport,
  recentReports,
  redactReportText,
  parseWindow,
  reportDashboardHtml,
  reportInbox,
  resetReportInbox,
  storeReport,
  type ReportSql,
  type StoredReport,
} from './reportApi';
import { resetRateLimits } from './security.js';

/**
 * The endpoint is reachable by anyone, so its tests are mostly about what it
 * refuses: cross-origin callers, wrong methods, oversized or malformed bodies,
 * and a client that sends a report-shaped payload full of things we must not
 * keep.
 */

beforeEach(() => {
  resetReportInbox();
  resetRateLimits();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://planner.test/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://planner.test', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('normalizeReport', () => {
  it('keeps the fields a developer needs', () => {
    const report = normalizeReport({
      id: 'abc123',
      at: '2026-01-01T00:00:00.000Z',
      kind: 'error',
      message: 'Cannot read properties of undefined',
      area: 'calendar',
      action: 'render',
      route: '/app#/calendar',
      surface: 'app',
      session: 'deadbeef',
      uptime: 12_345,
      breadcrumbs: [{ at: 10, kind: 'nav', detail: 'opened the calendar' }],
    });
    expect(report?.area).toBe('calendar');
    expect(report?.uptime).toBe(12_345);
    expect(report?.breadcrumbs).toEqual([{ at: 10, kind: 'nav', detail: 'opened the calendar' }]);
  });

  it('drops anything that is not a string, and anything it does not know', () => {
    const report = normalizeReport({
      message: 'boom',
      stack: { evil: true },
      route: 42,
      extra: { drop: null, keep: 'yes' },
      unexpected: 'ignored',
    });
    expect(report?.stack).toBeUndefined();
    expect(report?.route).toBeUndefined();
    expect(report?.extra).toEqual({ keep: 'yes' });
    expect('unexpected' in (report ?? {})).toBe(false);
  });

  it('rejects a payload with no message', () => {
    expect(normalizeReport({ stack: 'only a stack' })).toBeNull();
    expect(normalizeReport('boom')).toBeNull();
    expect(normalizeReport([])).toBeNull();
    expect(normalizeReport(null)).toBeNull();
  });

  it('redacts on the way in, even though the client already did', () => {
    expect(normalizeReport({ message: 'failed for sam@example.com' })?.message).not.toContain('sam@example.com');
    expect(normalizeReport({ message: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.x' })?.message).not.toContain('eyJ');
    expect(redactReportText('key aGVsbG90aGVyZWlzYWxvbmdlcnN0cmluZ3RoYW5tb3N0')).not.toContain('aGVsbG90');
  });

  it('caps every field so one report cannot fill the log', () => {
    const report = normalizeReport({
      message: 'x'.repeat(5_000),
      stack: 'y'.repeat(50_000),
      breadcrumbs: Array.from({ length: 500 }, () => ({ at: 1, kind: 'ui', detail: 'z'.repeat(500) })),
      extra: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, 'v'])),
    });
    expect(report?.message.length).toBeLessThanOrEqual(301);
    expect(report?.stack?.length ?? 0).toBeLessThanOrEqual(2_001);
    expect(report?.breadcrumbs).toHaveLength(30);
    expect(Object.keys(report?.extra ?? {}).length).toBeLessThanOrEqual(10);
  });

  it('never scans the part of a field it throws away', () => {
    // A report is untrusted input. These two patterns backtrack over a long
    // run of one character, so redacting the whole body before clamping it
    // cost the endpoint seconds of CPU for a payload of a few kilobytes —
    // enough to trip this suite's 5 second timeout on a slow machine.
    const started = Date.now();
    const report = normalizeReport({ message: 'y'.repeat(50_000), stack: '-'.repeat(50_000) });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(report?.message.length).toBeLessThanOrEqual(301);
    expect(report?.stack?.length ?? 0).toBeLessThanOrEqual(2_001);
    // A cut field has to say so, even though redaction made it short.
    expect(report?.message.endsWith('…')).toBe(true);
    expect(report?.stack?.endsWith('…')).toBe(true);
    expect(report?.message).not.toContain('yyy');
  });
});

describe('handleReport', () => {
  it('accepts a report and records it', async () => {
    const response = await handleReport(post({ message: 'boom', area: 'ai' }));
    expect(response.status).toBe(204);
    expect(reportInbox()).toHaveLength(1);
    expect(reportInbox()[0].area).toBe('ai');
  });

  it('writes one log line — the sink that always exists', async () => {
    await handleReport(post({ message: 'boom' }));
    const line = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0];
    expect(String(line)).toContain('[planner:report]');
    expect(String(line)).toContain('boom');
  });

  it('refuses cross-origin callers, wrong methods and non-JSON', async () => {
    const cross = await handleReport(
      new Request('https://planner.test/api/report', {
        method: 'POST',
        headers: { Origin: 'https://elsewhere.example', 'Content-Type': 'application/json' },
        body: '{"message":"boom"}',
      }),
    );
    expect(cross.status).toBe(403);

    const wrong = await handleReport(new Request('https://planner.test/api/report', { method: 'GET' }));
    expect(wrong.status).toBe(405);

    const junk = await handleReport(post('not json'));
    expect(junk.status).toBe(400);
    expect(reportInbox()).toHaveLength(0);
  });

  it('refuses a body big enough to be anything but a report', async () => {
    const response = await handleReport(post({ message: 'boom', stack: 'x'.repeat(64 * 1024) }));
    expect(response.status).toBe(413);
    expect(reportInbox()).toHaveLength(0);
  });

  it('throttles a client that sends too many', async () => {
    for (let index = 0; index < 20; index += 1) await handleReport(post({ message: `boom ${index}` }));
    expect(reportInbox()).toHaveLength(20);
    const limited = await handleReport(post({ message: 'one too many' }));
    expect(limited.status).toBe(429);
    expect(reportInbox()).toHaveLength(20);
  });

  it('forwards to a webhook when one is configured, and survives it failing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('webhook down'));
    const response = await handleReport(post({ message: 'boom' }), 'https://hooks.example.test/report');
    expect(response.status).toBe(204);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(reportInbox()).toHaveLength(1);
  });
});

// ── The sink, the dashboard and the alert rule ─────────────────────────────
//
// The store half is exercised with a recorder standing in for the Neon client:
// these tests are about which statements run, in what order, and what the
// dashboard makes of the rows that come back. The live SQL is covered by the
// same reasoning as the other stores — it is small, and it is checked on a real
// database by `npm run check:deployment`.
function recorder(rows: StoredReport[] = []) {
  const statements: string[] = [];
  const sql: ReportSql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (/^SELECT count/i.test(text)) {
      const message = String(values[0] ?? '');
      return [{ count: rows.filter((row) => row.message === message).length }];
    }
    if (/^SELECT id, at/i.test(text)) return rows.map((row) => ({ ...row, breadcrumbs: row.breadcrumbs }));
    return [];
  }) as unknown as ReportSql;
  return { sql, statements };
}

function stored(overrides: Partial<StoredReport> = {}): StoredReport {
  return {
    id: 'r1',
    at: new Date().toISOString(),
    kind: 'error',
    message: 'Cannot read properties of undefined',
    breadcrumbs: [],
    ...overrides,
  };
}

describe('storing a report', () => {
  it('creates the table, inserts once, and prunes by row count', async () => {
    const { sql, statements } = recorder();
    await storeReport(sql, stored());
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS planner_reports');
    expect(statements.some((text) => text.startsWith('INSERT INTO planner_reports'))).toBe(true);
    const insert = statements.find((text) => text.startsWith('INSERT INTO planner_reports')) ?? '';
    // The id is the primary key, so a retried report is the same row.
    expect(insert).toContain('ON CONFLICT (id) DO NOTHING');
    expect(statements.some((text) => text.includes('OFFSET'))).toBe(true);
  });

  it('reads rows back as reports, tolerating null columns', async () => {
    const rows: StoredReport[] = [stored({ area: 'calendar', route: '/app#/calendar' }), stored({ id: 'r2', at: '2026-01-01T00:00:00.000Z' })];
    const { sql } = recorder(rows);
    const read = await recentReports(sql, '2026-01-01T00:00:00.000Z');
    expect(read).toHaveLength(2);
    expect(read[0]).toMatchObject({ id: 'r1', area: 'calendar', route: '/app#/calendar', kind: 'error' });
    expect(read[1].at).toBe('2026-01-01T00:00:00.000Z');
    expect(Array.isArray(read[1].breadcrumbs)).toBe(true);
  });

  it('falls back to the in-memory inbox when there is no database', async () => {
    await handleReport(post({ id: 'mem1', message: 'Boom in the calendar', at: new Date().toISOString() }));
    expect(memoryReports().map((report) => report.message)).toContain('Boom in the calendar');
  });

  it('counts the occurrences of one message inside the window', async () => {
    const { sql, statements } = recorder([stored({ message: 'Boom' }), stored({ id: 'r2', message: 'Boom' }), stored({ id: 'r3', message: 'Other' })]);
    expect(await countRecent(sql, 'Boom', '2026-01-01T00:00:00.000Z')).toBe(2);
    expect(statements[0]).toContain('count(*)');
  });

  it('never fails the write with the report itself: a bad database still answers 204', async () => {
    // Storage is best-effort and the log line is unconditional, so a report
    // must be accepted even when the store cannot be reached.
    const response = await handleReport(post({ id: 'x', message: 'Boom', at: new Date().toISOString() }), undefined, 'not a connection string');
    expect(response.status).toBe(204);
    expect(memoryReports().map((report) => report.message)).toContain('Boom');
  });

  it('exports the same table creation the store calls', async () => {
    const { sql, statements } = recorder();
    await ensureReportTable(sql);
    expect(statements.filter((text) => text.startsWith('CREATE TABLE'))).toHaveLength(1);
    expect(statements.filter((text) => text.startsWith('CREATE INDEX'))).toHaveLength(2);
  });
});

describe('the alert rule', () => {
  const now = Date.parse('2026-03-12T09:20:00.000Z');
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

  it('marks a message that crossed the threshold inside the window', () => {
    const reports = Array.from({ length: ALERT_THRESHOLD }, (_, index) => stored({ id: `r${index}`, at: at(index) }));
    const overview = groupReports(reports, now);
    expect(overview.groups).toHaveLength(1);
    expect(overview.groups[0]).toMatchObject({ count: ALERT_THRESHOLD, alerting: true });
  });

  it('does not mark the same number of reports spread over a day', () => {
    // Chronic is not the same as acute, and paging on it is how alerting gets
    // turned off.
    const reports = Array.from({ length: ALERT_THRESHOLD }, (_, index) => stored({ id: `r${index}`, at: at(index * 120) }));
    expect(groupReports(reports, now).groups[0].alerting).toBe(false);
  });

  it('groups by message, newest first, and keeps the first and last sighting', () => {
    const overview = groupReports(
      [
        stored({ id: 'a', at: at(90), message: 'Older but frequent' }),
        stored({ id: 'b', at: at(5), message: 'Newer but rare', area: 'ai' }),
        stored({ id: 'c', at: at(3), message: 'Newer but rare', release: '1.4.0', route: '/app#/today' }),
        stored({ id: 'd', at: at(1), message: 'Older but frequent' }),
      ],
      now,
    );
    expect(overview.total).toBe(4);
    expect(overview.groups[0].message).toBe('Older but frequent');
    expect(overview.groups[0]).toMatchObject({ count: 2, first: at(90), last: at(1) });
    const rare = overview.groups.find((group) => group.message === 'Newer but rare');
    expect(rare).toMatchObject({ count: 2, areas: ['ai'], releases: ['1.4.0'], routes: ['/app#/today'] });
  });

  it('handles an empty window without inventing groups', () => {
    expect(groupReports([], now)).toMatchObject({ total: 0, groups: [], alerts: [], recent: [] });
  });

  it('lists the alerting groups separately, because that is what a monitor reads', () => {
    const reports = [
      ...Array.from({ length: ALERT_THRESHOLD }, (_, index) => stored({ id: `hot${index}`, at: at(index) })),
      stored({ id: 'cold', at: at(10), message: 'Seen once' }),
    ];
    const overview = groupReports(reports, now);
    expect(overview.alerts.map((group) => group.message)).toEqual(['Cannot read properties of undefined']);
    expect(overview.groups).toHaveLength(2);
  });

  it('reads a window written the way a person writes one', () => {
    expect(parseWindow('30m')).toBe(30 * 60_000);
    expect(parseWindow('2h')).toBe(2 * 3_600_000);
    expect(parseWindow('7d')).toBe(7 * 86_400_000);
    // Absent or nonsense falls back to the default; nothing is unbounded.
    expect(parseWindow(null)).toBe(24 * 3_600_000);
    expect(parseWindow('forever')).toBe(24 * 3_600_000);
    expect(parseWindow('0h')).toBe(24 * 3_600_000);
    expect(parseWindow('99d')).toBe(7 * 86_400_000);
  });
});

describe('the crash-report dashboard', () => {
  const request = (headers: Record<string, string> = {}, query = '') =>
    new Request(`https://planner.test/api/report/recent${query}`, { method: 'GET', headers });

  it('is not served at all unless the deployment turns it on', async () => {
    const response = await handleReportOverview(request());
    expect(response.status).toBe(404);
  });

  it('refuses anything but the secret, and the wrong method', async () => {
    const env = { REPORT_DASHBOARD_SECRET: 'long-secret' };
    expect((await handleReportOverview(request(), env)).status).toBe(401);
    expect((await handleReportOverview(request({ Authorization: 'Bearer wrong-secret' }), env)).status).toBe(401);
    expect((await handleReportOverview(request({ Authorization: 'Bearer long-secret' }, ''), env)).status).toBe(200);
    const wrongMethod = new Request('https://planner.test/api/report/recent', { method: 'POST', headers: { Authorization: 'Bearer long-secret' } });
    expect((await handleReportOverview(wrongMethod, env)).status).toBe(405);
  });

  it('answers JSON for a script and a page for a person', async () => {
    resetReportInbox();
    await handleReport(post({ id: 'd1', message: 'Boom in the calendar', at: new Date().toISOString(), area: 'calendar' }));
    const env = { REPORT_DASHBOARD_SECRET: 'long-secret' };
    const json = await handleReportOverview(request({ Authorization: 'Bearer long-secret' }), env);
    expect(json.headers.get('Content-Type')).toContain('application/json');
    const body = (await json.json()) as { total: number; groups: { message: string }[] };
    expect(body.total).toBeGreaterThan(0);
    expect(body.groups.map((group) => group.message)).toContain('Boom in the calendar');

    const html = await handleReportOverview(request({ Authorization: 'Bearer long-secret' }, '?format=html'), env);
    expect(html.headers.get('Content-Type')).toContain('text/html');
    expect(html.headers.get('X-Robots-Tag')).toBe('noindex');
    const page = await html.text();
    expect(page).toContain('Crash reports');
    expect(page).toContain('Boom in the calendar');
  });

  it('escapes anything a message contains, because it is rendered as HTML', () => {
    const page = reportDashboardHtml(
      groupReports([stored({ message: '<img src=x onerror=alert(1)> is not a message' })]),
      new Date('2026-03-12T09:20:00.000Z'),
    );
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&#60;img src=x');
  });

  it('says so loudly when the threshold is crossed', () => {
    const now = Date.parse('2026-03-12T09:20:00.000Z');
    const reports = Array.from({ length: ALERT_THRESHOLD }, (_, index) => stored({ id: `r${index}`, at: new Date(now - index * 1000).toISOString() }));
    const page = reportDashboardHtml(groupReports(reports, now), new Date(now));
    expect(page).toContain('crossed the alert threshold');
    expect(page).toContain('hot');
  });
});
