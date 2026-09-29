// @vitest-environment node
/**
 * What the client says when the API does not answer.
 *
 * Sign-in used to collapse every non-JSON answer into "The server returned an
 * unexpected response. Please try again." — the same sentence for a protected
 * deployment, a missing route, and a crashed function, which is why the real
 * cause took several rounds to find. Each answer now has a name, a sentence
 * that says what to do, and a technical line naming what actually came back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, fetchApiStatus, request } from './session';

function stubFetch(response: Response | (() => Response | Promise<Response>)): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (typeof response === 'function' ? response() : response)),
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** What `redirect: 'manual'` hands back when a hosting gate intercepts a fetch. */
function opaqueRedirect(): Response {
  return { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), text: async () => '' } as unknown as Response;
}

async function failure(path = '/api/auth/salt'): Promise<AuthError> {
  try {
    await request(path, { method: 'POST', body: '{}' });
  } catch (caught) {
    if (caught instanceof AuthError) return caught;
    throw caught;
  }
  throw new Error('expected the request to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('naming what answered instead of the API', () => {
  it('names a hosting sign-in gate that serves HTML', async () => {
    stubFetch(
      html(
        '<html><head><title>Protected Deployment – Vercel</title></head><body>Log in to Vercel</body></html>',
        401,
      ),
    );
    const error = await failure();
    expect(error.code).toBe('deployment_gate');
    expect(error.message).toContain('Vercel Authentication');
    // The detail names the request and the answer, so a report can be checked.
    expect(error.detail).toContain('POST /api/auth/salt');
    expect(error.detail).toContain('401');
  });

  it('names a gate that redirects the request away', async () => {
    stubFetch(opaqueRedirect());
    const error = await failure();
    expect(error.code).toBe('deployment_gate');
    expect(error.detail).toContain('redirected to a sign-in page');
  });

  it('names an empty 404 as a missing API', async () => {
    stubFetch(new Response('', { status: 404 }));
    const error = await failure();
    expect(error.code).toBe('api_missing');
    expect(error.message).toContain('accounts API');
  });

  it('names the router\'s bare 404 as a missing API', async () => {
    stubFetch(json({ error: { message: 'Not found.' } }, 404));
    const error = await failure();
    expect(error.code).toBe('api_missing');
    expect(error.detail).toContain('POST /api/auth/salt');
  });

  it('names the app shell served in place of the API', async () => {
    stubFetch(html('<!doctype html><html><body><div id="root"></div></body></html>', 200));
    const error = await failure();
    expect(error.code).toBe('api_missing');
  });

  it('keeps a plain-text 500 as an unknown failure, with the status as detail', async () => {
    stubFetch(new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } }));
    const error = await failure();
    expect(error.code).toBe('unknown');
    expect(error.message).toBe('The server answered with 500 instead of JSON.');
    expect(error.detail).toContain('500 text/plain');
  });

  it('never falls back to the old vague sentence', async () => {
    stubFetch(new Response('', { status: 502 }));
    const error = await failure();
    expect(error.message).not.toContain('unexpected response');
    expect(error.detail).not.toContain('unexpected response');
  });
});

describe('keeping the server\'s own answers intact', () => {
  it('passes through a coded bad-credentials answer', async () => {
    stubFetch(json({ error: { message: 'Wrong username or password.', code: 'bad_credentials' } }, 401));
    const error = await failure();
    expect(error.code).toBe('bad_credentials');
    expect(error.detail).toBe('Wrong username or password.');
  });

  it('keeps a route-level 404 with its own code and message', async () => {
    stubFetch(json({ error: { message: 'No vault yet.', code: 'not_found' } }, 404));
    const error = await failure('/api/auth/vault');
    expect(error.code).toBe('not_found');
    expect(error.message).toBe('No vault yet.');
  });

  it('reports a dead connection as a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const error = await failure();
    expect(error.code).toBe('network');
  });

  it('still returns parsed JSON', async () => {
    stubFetch(json({ kdfSalt: 'c2FsdA==' }));
    await expect(request('/api/auth/salt', { method: 'POST' })).resolves.toEqual({ kdfSalt: 'c2FsdA==' });
  });

  it('reports whether the server has a database', async () => {
    stubFetch(json({ configured: true }));
    await expect(fetchApiStatus()).resolves.toEqual({ configured: true });
  });
});
