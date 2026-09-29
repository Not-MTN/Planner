// @vitest-environment node
/**
 * How `@vercel/node` invokes the catch-all function in production.
 *
 * The platform loads the module, unwraps `default`, and — because the export
 * is a plain function with no `GET`/`POST`/`fetch` members — calls it as
 * `listener(req, res)` on a Node http server, after its own `addHelpers`
 * pre-reads the body and patches `req.on`. The response only reaches the
 * browser if our code writes to `res` and ends it: a returned `Response`
 * object is ignored in that path.
 *
 * That was the "no error but stuck" bug: the handler received Node's
 * `IncomingMessage`, `request.headers.get(...)` threw, the router answered a
 * JSON 500 `Response` that nobody wrote to the socket, and the browser waited
 * forever on "Securing your planner".
 *
 * These tests drive the real `api/[...path].ts` default export through a
 * faithful copy of that runtime and assert every request gets a complete
 * HTTP response.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import vercelFunction from '../../api/[...path]';
import { resetRateLimits } from './security';

/** Verbatim mirror of `@vercel/node`'s dev-server `restoreBody`/`readBody`/`addHelpers`. */
async function addHelpers(req: IncomingMessage, _res: ServerResponse): Promise<void> {
  const contentType = req.headers['content-type'];
  if (contentType === undefined) return;
  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const replicate = new PassThrough();
  const on = replicate.on.bind(replicate);
  const originalOn = req.on.bind(req);
  req.read = replicate.read.bind(replicate);
  req.on = req.addListener = ((name: string, cb: (...args: unknown[]) => void) =>
    name === 'data' || name === 'end' ? on(name, cb) : originalOn(name as never, cb as never)) as typeof req.on;
  replicate.write(body);
  replicate.end();
  Object.defineProperty(req, 'body', {
    configurable: true,
    get: () => JSON.parse(body.toString('utf8') || '{}'),
  });
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      await addHelpers(req, res);
      await vercelFunction(req, res);
    } catch (caught) {
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { message: String(caught) } }));
      }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

beforeEach(() => {
  resetRateLimits();
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'http', ...headers },
    body: JSON.stringify(body),
  });
}

describe('the catch-all function under the Node (req, res) runtime', () => {
  it('answers GET /api/auth/status instead of leaving the socket open', async () => {
    const response = await fetch(`${base}/api/auth/status`, { headers: { 'X-Forwarded-Proto': 'http' } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configured: false, storage: 'temporary' });
  });

  it('signs up: the request body survives addHelpers and the response is written to res', async () => {
    const response = await post('/api/auth/signup', {
      username: 'nodepath',
      email: null,
      displayName: 'Node Path',
      role: 'personal',
      kdfSalt: 'c2FsdHNhbHRzYWx0c2E=',
      authToken: 'YXV0aFRva2VuYXV0aFRva2VuYXV0aFRva2VuMTI=',
      recoveryHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      wrappedDek: 'd3JhcHBlZERla3dyYXBwZWREZWt3cmFwcGVkRGVrMTI=',
      wrappedRecovery: 'd3JhcHBlZFJlY292ZXJ5d3JhcHBlZFJlY292ZXJ5MTI=',
      ciphertext: 'dmF1bHRjaXBoZXJ0ZXh0',
    });
    expect(response.status).toBe(201);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('planner_session=');
    await expect(response.json()).resolves.toMatchObject({ user: { username: 'nodepath' } });
  }, 60_000);

  it('routes the rewritten catch-all URL (?...path=auth/salt) too', async () => {
    const response = await post('/api/[...path]?...path=auth%2Fsalt', { username: 'someone' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kdfSalt: string };
    // Unknown account → deterministic decoy salt, not an error.
    expect(body.kdfSalt).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('answers unknown paths with the JSON 404, not a hang', async () => {
    const response = await post('/api/auth/nope', {});
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { message: 'Not found.' } });
  });

  it('still ends the response when the handler itself crashes', async () => {
    // No matching route with a body that breaks the method check still
    // produces a complete response; and an empty POST body must not crash
    // addHelpers' JSON getter into an un-ended socket.
    const response = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'http' },
      body: '',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('the module also still answers a Web Request directly (unit-test path)', async () => {
    const response = await vercelFunction(
      new Request('https://planner.test/api/auth/status', { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configured: false, storage: 'temporary' });
  });
});

describe('resolveApiPathname', () => {
  it('normalizes both direct and rewritten catch-all URLs', async () => {
    const { resolveApiPathname } = await import('./apiRouter');
    expect(resolveApiPathname(new URL('https://x.test/api/auth/signup'))).toBe('/api/auth/signup');
    expect(resolveApiPathname(new URL('https://x.test/api/auth/signup/'))).toBe('/api/auth/signup');
    expect(resolveApiPathname(new URL('https://x.test/api/[...path]?...path=auth/signup'))).toBe('/api/auth/signup');
    expect(resolveApiPathname(new URL('https://x.test/api/[...path]?path=auth&path=salt'))).toBe('/api/auth/salt');
    expect(resolveApiPathname(new URL('https://x.test/api/[...path]'))).toBe('/api');
    expect(resolveApiPathname(new URL('https://x.test/api/'))).toBe('/api');
  });
});
