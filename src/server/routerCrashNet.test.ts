// @vitest-environment node
/**
 * The last-resort net around the whole API surface.
 *
 * If any handler or store-resolving promise throws, `handleApiRequest` must
 * still answer JSON (so the client can classify it) and log the cause with the
 * database credentials redacted — never let the request die as the platform's
 * bare HTML 500, which reads as "an unexpected response" in the UI and leaves
 * nothing diagnosable in the function logs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./authApi.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    handleSignup: async () => {
      throw new Error('simulated crash while touching postgresql://user:secretpass@example.test/neondb');
    },
  };
});

const { handleApiRequest } = await import('./apiRouter');

const request = () =>
  new Request('https://planner.test/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

describe('a crashing handler', () => {
  afterEach(() => vi.restoreAllMocks());

  it('still gets a JSON 500 in our own envelope', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleApiRequest(request(), {});
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toContain('Something went wrong');
  });

  it('logs the cause with credentials redacted', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await handleApiRequest(request(), {});
    const logged = log.mock.calls.map((line) => line.join(' ')).join('\n');
    expect(logged).toContain('/api/auth/signup');
    expect(logged).toContain('simulated crash');
    expect(logged).not.toContain('secretpass');
  });
});
