// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addBreadcrumb,
  buildReportPayload,
  currentBreadcrumbs,
  enableReportingInTests,
  installGlobalErrorHandlers,
  isReportingEnabled,
  redactStack,
  redactText,
  reportError,
  resetBreadcrumbs,
  resetReportCounters,
  setReportTransport,
  setReportingEnabled,
} from './reporting';

/**
 * The promises these tests make to the rest of the app: nothing a user typed
 * reaches a report, a broken reporter cannot break a feature, and a render
 * loop cannot turn into a flood of requests.
 */

beforeEach(() => {
  resetBreadcrumbs();
  resetReportCounters();
  setReportTransport(null);
  enableReportingInTests();
  setReportingEnabled(true);
  localStorage.clear();
});

afterEach(() => {
  setReportTransport(null);
  vi.restoreAllMocks();
});

describe('redaction', () => {
  it('removes e-mail addresses, tokens and long blobs', () => {
    expect(redactText('connect sam@example.com now')).not.toContain('sam@example.com');
    expect(redactText('Authorization: Bearer abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
    expect(redactText('key eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature')).not.toContain('eyJ');
    expect(redactText('cipher aGVsbG90aGVyZWlzYWxvbmdlcnN0cmluZ3RoYW5tb3N0')).not.toContain('aGVsbG90');
  });

  it('drops query strings, which is where share and sync codes live', () => {
    expect(redactText('GET /api/sync?code=ABCD-EFGH failed')).toBe('GET /api/sync?<query> failed');
  });

  it('keeps the shape of an error message', () => {
    expect(redactText('Cannot read properties of undefined')).toBe('Cannot read properties of undefined');
  });

  it('collapses whitespace and caps runaway text', () => {
    expect(redactText('a\n\n   b')).toBe('a b');
    // Varied text, so this exercises truncation rather than the blob rule.
    expect(redactText('word '.repeat(300), 50)).toHaveLength(51);
  });

  it('shortens absolute bundle URLs in a stack but keeps the file', () => {
    const stack = redactStack('Error: boom\n    at Planner (https://cdn.example.com/assets/index-a1b2c3.js:1:2)\n    at x (http://localhost:5173/src/views/CalendarView.tsx:44:9)');
    expect(stack).toContain('CalendarView.tsx:44:9');
    expect(stack).not.toContain('localhost:5173');
    expect(stack).not.toContain('cdn.example.com');
  });
});

describe('breadcrumbs', () => {
  it('records what happened, in order, and drops the oldest past the limit', () => {
    addBreadcrumb('nav', 'opened the calendar');
    addBreadcrumb('ai', 'request');
    expect(currentBreadcrumbs().map((item) => item.kind)).toEqual(['nav', 'ai']);
    for (let index = 0; index < 60; index += 1) addBreadcrumb('ui', `tick ${index}`);
    expect(currentBreadcrumbs()).toHaveLength(30);
    expect(currentBreadcrumbs().at(-1)?.detail).toBe('tick 59');
  });

  it('redacts and refuses to throw on hostile input', () => {
    addBreadcrumb('sync', 'failed for sam@example.com');
    expect(currentBreadcrumbs().at(-1)?.detail).not.toContain('sam@example.com');
    const hostile = { toString() { throw new Error('nope'); } };
    expect(() => addBreadcrumb('ui', hostile as unknown as string)).not.toThrow();
  });
});

describe('reportError', () => {
  it('sends one report per distinct failure', () => {
    const sent: unknown[] = [];
    setReportTransport((body) => sent.push(JSON.parse(body)));
    // The same error object twice: two `new Error('boom')` calls would differ
    // only by their source line, which is part of the fingerprint.
    const boom = new Error('boom');
    expect(reportError(boom, { area: 'calendar', action: 'render' })).toBeTruthy();
    expect(reportError(boom, { area: 'calendar', action: 'render' })).toBeNull();
    expect(reportError(new Error('different'), { area: 'calendar' })).toBeTruthy();
    expect(sent).toHaveLength(2);
  });

  it('stops after the per-page cap so a render loop cannot flood the endpoint', () => {
    let count = 0;
    setReportTransport(() => { count += 1; });
    for (let index = 0; index < 50; index += 1) reportError(new Error(`boom ${index}`));
    expect(count).toBe(8);
  });

  it('sends nothing once the user turns reporting off', () => {
    const sent: unknown[] = [];
    setReportTransport((body) => sent.push(body));
    setReportingEnabled(false);
    expect(isReportingEnabled()).toBe(false);
    expect(reportError(new Error('boom'))).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('remembers the choice on this device', () => {
    setReportingEnabled(false);
    expect(localStorage.getItem('planner-error-reports')).toBe('off');
    setReportingEnabled(true);
    expect(localStorage.getItem('planner-error-reports')).toBe('on');
  });

  it('never throws, whatever it is handed', () => {
    expect(() => reportError(undefined)).not.toThrow();
    expect(() => reportError('a string')).not.toThrow();
    expect(() => reportError({ circular: null as unknown })).not.toThrow();
  });

  it('carries the screen, the breadcrumbs and no planner content', () => {
    const sent: Record<string, unknown>[] = [];
    setReportTransport((body) => sent.push(JSON.parse(body) as Record<string, unknown>));
    window.history.replaceState({}, '', '/app#/calendar');
    addBreadcrumb('nav', 'opened the calendar');
    reportError(new Error('Failed for Milk at 08:00 <ada@lovelace.dev>'), { area: 'calendar', action: 'render' });
    const payload = sent[0];
    expect(payload.route).toBe('/app#/calendar');
    expect(payload.surface).toBe('app');
    expect(payload.area).toBe('calendar');
    expect((payload.breadcrumbs as unknown[])).toHaveLength(1);
    // The vault is zero-knowledge; a report must not be a way around that.
    expect(JSON.stringify(payload)).not.toContain('ada@lovelace.dev');
  });

  it('builds a payload without sending it', () => {
    const payload = buildReportPayload(new Error('quiet'), 'error', { area: 'vault', extra: { item: 'x'.repeat(400) } });
    expect(payload.area).toBe('vault');
    expect(payload.extra?.item?.length ?? 0).toBeLessThan(130);
  });
});

describe('installGlobalErrorHandlers', () => {
  it('reports an unhandled rejection instead of losing it', async () => {
    const sent: Record<string, unknown>[] = [];
    setReportTransport((body) => sent.push(JSON.parse(body) as Record<string, unknown>));
    installGlobalErrorHandlers();
    const rejection = Promise.reject(new Error('nobody awaited me'));
    await rejection.catch(() => undefined);
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { reason: new Error('nobody awaited me'), promise: rejection }));
    await Promise.resolve();
    expect(sent.some((item) => item.action === 'unhandled-rejection')).toBe(true);
  });

  it('leaves a breadcrumb when the app goes offline', () => {
    resetBreadcrumbs();
    installGlobalErrorHandlers();
    window.dispatchEvent(new Event('offline'));
    expect(currentBreadcrumbs().some((item) => item.detail === 'went offline')).toBe(true);
  });
});
