import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleReport, normalizeReport, redactReportText, reportInbox, resetReportInbox } from './reportApi';
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
