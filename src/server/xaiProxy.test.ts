import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as chatRoute from '../../api/xai/chat/completions';
import * as statusRoute from '../../api/xai/status';
import { MAX_PLAN_IMAGE_BYTES, XAI_CHAT_URL, XAI_STATUS_URL } from '../ai';
import {
  MAX_PROXY_BODY_BYTES,
  XAI_ALLOWED_MODEL,
  XAI_UPSTREAM_CHAT_COMPLETIONS,
  handleXAIChatCompletions,
  handleXAIStatus,
  normalizeApiKey,
  upstreamErrorResponse,
  isSameOriginRequest,
  validateChatPayload,
} from './xaiProxy';
import { resetRateLimits } from './security';

// Obviously fake placeholder; never a real credential.
const FAKE_KEY = 'test-placeholder-not-a-real-key';
const HOST = 'planner.example.test';

function request(path: string, init: RequestInit & { origin?: string } = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('host', HOST);
  if (init.origin) headers.set('origin', init.origin);
  return new Request(`https://${HOST}${path}`, { ...init, headers });
}

function chatBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ model: 'grok-4.7', messages: [{ role: 'user', content: 'Plan my day' }], ...extra });
}

function upstreamOk() {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Vercel function discovery', () => {
  it('maps api/ files to exactly the URLs the frontend calls', () => {
    const apiRoot = join(__dirname, '..', '..', 'api');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    const routes = walk(apiRoot)
      .filter((file) => /\.(ts|js|mjs)$/.test(file) && !file.includes('.test.'))
      .map((file) => '/api/' + relative(apiRoot, file).split(sep).join('/').replace(/\.(ts|js|mjs)$/, ''))
      .sort();
    // api/sync/index.ts is served by Vercel at /api/sync, api/ics/index.ts at /api/ics.
    expect(routes).toEqual(
      [
        XAI_CHAT_URL,
        XAI_STATUS_URL,
        '/api/sync/index',
        '/api/sync/status',
        '/api/ics/index',
        '/api/auth/signup',
        '/api/auth/salt',
        '/api/auth/login',
        '/api/auth/session',
        '/api/auth/logout',
        '/api/auth/vault',
        '/api/auth/status',
        '/api/auth/links',
        '/api/auth/link-accept',
        '/api/auth/share',
        '/api/auth/note',
      ].sort(),
    );
  });

  it('exports web handlers for the right HTTP methods', () => {
    expect(typeof statusRoute.GET).toBe('function');
    expect(typeof chatRoute.POST).toBe('function');
    expect(Object.keys(chatRoute)).not.toContain('GET');
  });
});

describe('status route', () => {
  it('reports configured:true from XAI_API_KEY without exposing the key', async () => {
    vi.stubEnv('XAI_API_KEY', FAKE_KEY);
    const response = statusRoute.GET(request('/api/xai/status'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ configured: true });
    expect(text).not.toContain(FAKE_KEY);
  });

  it('reports configured:false when the variable is missing or blank', async () => {
    vi.stubEnv('XAI_API_KEY', '   ');
    expect(await statusRoute.GET(request('/api/xai/status')).json()).toEqual({ configured: false });
    expect(await handleXAIStatus(request('/api/xai/status'), undefined).json()).toEqual({ configured: false });
  });

  it('rejects cross-origin browser requests', () => {
    const response = handleXAIStatus(request('/api/xai/status', { origin: 'https://evil.example' }), FAKE_KEY);
    expect(response.status).toBe(403);
  });
});

describe('chat completions route', () => {
  it('forwards the body to xAI with the server-side key and relays the reply', async () => {
    vi.stubEnv('XAI_API_KEY', FAKE_KEY);
    const fetchMock = upstreamOk();
    vi.stubGlobal('fetch', fetchMock);
    const body = chatBody();
    const response = await chatRoute.POST(request('/api/xai/chat/completions', {
      method: 'POST', body, origin: `https://${HOST}`, headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ choices: [{ message: { content: '{}' } }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(XAI_UPSTREAM_CHAT_COMPLETIONS);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${FAKE_KEY}`);
    expect(init?.body).toBe(body);
  });

  it('returns 503 with setup guidance when the key is missing, without calling xAI', async () => {
    const fetchMock = upstreamOk();
    const response = await handleXAIChatCompletions(
      request('/api/xai/chat/completions', { method: 'POST', body: chatBody() }), undefined, { fetchImpl: fetchMock });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain('Vercel');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies with 413 before contacting xAI', async () => {
    const fetchMock = upstreamOk();
    const huge = chatBody({ image: 'x'.repeat(MAX_PROXY_BODY_BYTES) });
    const response = await handleXAIChatCompletions(
      request('/api/xai/chat/completions', { method: 'POST', body: huge }), FAKE_KEY, { fetchImpl: fetchMock });
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-origin, non-POST, and non-JSON requests', async () => {
    const fetchMock = upstreamOk();
    const cross = await handleXAIChatCompletions(request('/api/xai/chat/completions', {
      method: 'POST', body: chatBody(), origin: 'https://evil.example',
    }), FAKE_KEY, { fetchImpl: fetchMock });
    expect(cross.status).toBe(403);
    const get = await handleXAIChatCompletions(request('/api/xai/chat/completions'), FAKE_KEY, { fetchImpl: fetchMock });
    expect(get.status).toBe(405);
    const bad = await handleXAIChatCompletions(request('/api/xai/chat/completions', {
      method: 'POST', body: 'not json',
    }), FAKE_KEY, { fetchImpl: fetchMock });
    expect(bad.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates the narrow proxy payload and rejects remote image URLs or extra fields', () => {
    const valid = JSON.parse(chatBody()) as Record<string, unknown>;
    expect(validateChatPayload(valid)).toBeNull();
    expect(validateChatPayload({ ...valid, model: 'another-model' })).toContain('model');
    expect(XAI_ALLOWED_MODEL).toBe('grok-4.7');
    expect(validateChatPayload({ ...valid, stream: true })).toContain('unsupported');
    expect(validateChatPayload({
      ...valid,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/secret.png' } }] }],
    })).toContain('invalid');
  });

  it('passes upstream errors through and maps network failures and timeouts', async () => {
    const rejected = await handleXAIChatCompletions(request('/api/xai/chat/completions', { method: 'POST', body: chatBody() }), FAKE_KEY, {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'bad key' }), { status: 401 }),
    });
    expect(rejected.status).toBe(401);
    const offline = await handleXAIChatCompletions(request('/api/xai/chat/completions', { method: 'POST', body: chatBody() }), FAKE_KEY, {
      fetchImpl: async () => { throw new TypeError('fetch failed'); },
    });
    expect(offline.status).toBe(502);
    const slow = await handleXAIChatCompletions(request('/api/xai/chat/completions', { method: 'POST', body: chatBody() }), FAKE_KEY, {
      fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); },
    });
    expect(slow.status).toBe(504);
  });
});

describe('abuse controls', () => {
  it('throttles repeated xAI proxy calls before the upstream key is used again', async () => {
    resetRateLimits();
    const fetchMock = upstreamOk();
    let last: Response | null = null;
    for (let index = 0; index < 21; index += 1) {
      last = await handleXAIChatCompletions(
        request('/api/xai/chat/completions', { method: 'POST', body: chatBody() }),
        FAKE_KEY,
        { fetchImpl: fetchMock },
      );
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(20);
    resetRateLimits();
  });
});

describe('request size budget', () => {
  it('keeps a max-size base64 plan image plus prompt under the 4.5 MB Vercel body limit', () => {
    const encodedImage = Math.ceil(MAX_PLAN_IMAGE_BYTES / 3) * 4 + 'data:image/jpeg;base64,'.length;
    const promptAllowance = 150_000;
    expect(encodedImage + promptAllowance).toBeLessThanOrEqual(MAX_PROXY_BODY_BYTES);
    expect(MAX_PROXY_BODY_BYTES).toBeLessThan(4_500_000);
  });
});

describe('same-origin check', () => {
  it('accepts requests without Origin and matching request hosts', () => {
    expect(isSameOriginRequest(new Request(`https://${HOST}/api/xai/status`))).toBe(true);
    const forwarded = new Request('http://internal/api/xai/status', {
      headers: { origin: `https://${HOST}`, host: HOST },
    });
    expect(isSameOriginRequest(forwarded)).toBe(true);
    const malformed = new Request(`https://${HOST}/api/xai/status`, { headers: { origin: 'null' } });
    expect(isSameOriginRequest(malformed)).toBe(false);
    const spoofedForwardedHost = new Request(`https://${HOST}/api/xai/status`, {
      headers: { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' },
    });
    expect(isSameOriginRequest(spoofedForwardedHost)).toBe(false);
  });
});

describe('xAI key handling', () => {
  it('cleans up the ways a key usually arrives from a paste', () => {
    // Surrounding quotes, a "Bearer " prefix and invisible characters all make
    // xAI answer 401 even though the key itself is valid.
    expect(normalizeApiKey('  xai-abc123  ')).toBe('xai-abc123');
    expect(normalizeApiKey('"xai-abc123"')).toBe('xai-abc123');
    expect(normalizeApiKey("'xai-abc123'")).toBe('xai-abc123');
    expect(normalizeApiKey('Bearer xai-abc123')).toBe('xai-abc123');
    expect(normalizeApiKey('xai-\u200Babc\u00A0123')).toBe('xai-abc123');
    expect(normalizeApiKey(undefined)).toBe('');
    expect(normalizeApiKey('   ')).toBe('');
  });

  it('accepts a key that only needed cleaning', async () => {
    resetRateLimits();
    let sent = '';
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      sent = String((init.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
    });
    const response = await handleXAIChatCompletions(
      request('/api/xai/chat/completions', { method: 'POST', body: chatBody() }),
      '  "Bearer xai-abc123"\n',
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(response.status).toBe(200);
    expect(sent).toBe('Bearer xai-abc123');
  });

  it('accepts a model override without a code change', async () => {
    resetRateLimits();
    const fetchMock = upstreamOk();
    const response = await handleXAIChatCompletions(
      request('/api/xai/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'grok-4.6', messages: [{ role: 'user', content: 'hello' }] }),
      }),
      FAKE_KEY,
      { fetchImpl: fetchMock as unknown as typeof fetch, model: 'grok-4.6' },
    );
    expect(response.status).toBe(200);
  });
});

describe('upstream error reporting', () => {
  it('keeps the status but explains what xAI actually said', async () => {
    const body = JSON.stringify({ error: { message: 'Incorrect API key provided' } });
    const response = upstreamErrorResponse(401, body);
    expect(response.status).toBe(401);
    const parsed = (await response.json()) as { error: { code: string; message: string; upstream: number } };
    expect(parsed.error.code).toBe('upstream_auth');
    expect(parsed.error.message).toContain('Incorrect API key provided');
    expect(parsed.error.upstream).toBe(401);
  });

  it('distinguishes a missing model from a missing function', async () => {
    const response = upstreamErrorResponse(404, '{}');
    expect(response.status).toBe(404);
    const parsed = (await response.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('model_not_found');
    expect(parsed.error.message).toContain('XAI_MODEL');
  });

  it('falls back to actionable advice when xAI sends nothing useful', async () => {
    const response = upstreamErrorResponse(401, '<html>not json</html>');
    const parsed = (await response.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('upstream_auth');
    expect(parsed.error.message).toContain('console.x.ai');
  });

  it('passes upstream failures through with a code instead of a bare body', async () => {
    resetRateLimits();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'bad key' }), { status: 401 }));
    const response = await handleXAIChatCompletions(
      request('/api/xai/chat/completions', { method: 'POST', body: chatBody() }),
      FAKE_KEY,
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(response.status).toBe(401);
    const parsed = (await response.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('upstream_auth');
    expect(parsed.error.message).toBe('bad key');
  });
});
