// @vitest-environment node
/**
 * Telling "no network" apart from "the server said no".
 *
 * A packaged app calls an API on another origin, so a server that has not been
 * told the app's origin is ours answers 403 and the browser hides that answer
 * behind a CORS failure. `fetch` reports both as the same `TypeError`, which is
 * why an app with no sign-in page blamed the connection. `mode: 'no-cors'`
 * sends the request without needing to read the answer, so the promise settles
 * on the one fact that matters: did anything answer at all?
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeApiReachability } from './reachability';

const API = 'https://planner.example.com';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeApiReachability', () => {
  it('calls a refused cross-origin answer what it is', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));
    expect(await probeApiReachability({ origin: API, fetchImpl })).toBe('refused');
    // The probe must ask without expecting to read: that is what makes it
    // survive the very CORS policy it is detecting.
    expect(fetchImpl).toHaveBeenCalledWith(`${API}/api/auth/status`, expect.objectContaining({ mode: 'no-cors' }));
  });

  it('calls a connection that answered nothing offline', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await probeApiReachability({ origin: API, fetchImpl })).toBe('offline');
  });

  it('never blames the origin when the API is on this app’s own origin', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await probeApiReachability({ origin: '', fetchImpl })).toBe('reachable');
    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/status', expect.objectContaining({ mode: 'no-cors' }));
  });

  it('reports offline when the probe could not be sent at all', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    expect(await probeApiReachability({ origin: API, fetchImpl, timeoutMs: 5 })).toBe('offline');
  });
});
