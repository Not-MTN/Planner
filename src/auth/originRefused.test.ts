// @vitest-environment jsdom
/**
 * A packaged app the server refuses.
 *
 * This is the shape the downloaded apps were in: the API origin is baked in,
 * the server does not list the shell's origin in `PLANNER_APP_ORIGINS`, so every
 * call comes back 403 — and the browser, seeing no `Access-Control-Allow-Origin`
 * on that answer, hands the app a bare `TypeError`. Classifying that as
 * "offline" is what produced a silent local-only planner with no sign-in page.
 * The client now asks the one question that separates the two and names the
 * refused origin instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { API } = vi.hoisted(() => ({ API: 'https://planner.example.com' }));

vi.mock('../shared/nativeShell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/nativeShell')>();
  return {
    ...actual,
    isNativeShell: () => true,
    hasConfiguredApi: () => true,
    configuredApiOrigin: () => API,
  };
});

import { request } from './session';

/** The real call, rejected the way a CORS refusal arrives; the probe answers. */
function stubRefusedOrigin(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.mode === 'no-cors') return new Response(null, { status: 403 });
      throw new TypeError('Failed to fetch');
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a shell the server refuses', () => {
  it('names the refused origin instead of blaming the connection', async () => {
    stubRefusedOrigin();
    await expect(request('/api/auth/session')).rejects.toMatchObject({ code: 'origin_refused' });
  });

  it('keeps the refused origin in the technical detail, for a report', async () => {
    stubRefusedOrigin();
    const error = await request('/api/auth/session').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as { detail?: string }).detail)).toContain(API);
  });

  it('still says "offline" when nothing answers at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(request('/api/auth/session')).rejects.toMatchObject({ code: 'network' });
  });
});
