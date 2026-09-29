import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import vercelFunction from '../../api/[...path]';
import { MAX_PLAN_IMAGE_BYTES, GROQ_CHAT_URL, GROQ_STATUS_URL, GROQ_TEXT_MODEL, GROQ_VISION_MODEL } from '../ai';
import {
  MAX_PROXY_BODY_BYTES,
  GROQ_DEFAULT_TEXT_MODEL,
  GROQ_DEFAULT_VISION_MODEL,
  finalizeUpstreamBody,
  GROQ_UPSTREAM_CHAT_COMPLETIONS,
  handleGroqChatCompletions,
  handleGroqStatus,
  normalizeApiKey,
  upstreamErrorResponse,
  isSameOriginRequest,
  validateChatPayload,
} from './groqProxy';
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
  return JSON.stringify({ model: GROQ_DEFAULT_TEXT_MODEL, messages: [{ role: 'user', content: 'Plan my day' }], ...extra });
}

function imageChatBody(model: string): string {
  return JSON.stringify({
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Read my plan' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }],
  });
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
  it('keeps api/ to a single catch-all function (Hobby plan allows 12) and it routes the status URL', async () => {
    const apiRoot = join(__dirname, '..', '..', 'api');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    const functions = walk(apiRoot).filter((file) => /\.(ts|js|mjs)$/.test(file) && !file.includes('.test.'));
    // Vercel's Hobby plan rejects Deployments with more than 12 Serverless
    // Functions; the API has 16 routes, so they all share the one catch-all.
    expect(functions.map((file) => relative(apiRoot, file).split(sep).join('/'))).toEqual(['[...path].ts']);
    expect(typeof vercelFunction).toBe('function');
    expect(await (await vercelFunction(request(GROQ_STATUS_URL))).json()).toEqual({ configured: false });
  });
});

describe('status route', () => {
  it('reports configured:true from GROQ_API_KEY without exposing the key', async () => {
    vi.stubEnv('GROQ_API_KEY', FAKE_KEY);
    const response = await vercelFunction(request(GROQ_STATUS_URL));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ configured: true });
    expect(text).not.toContain(FAKE_KEY);
  });

  it('reports configured:false when the variable is missing or blank', async () => {
    vi.stubEnv('GROQ_API_KEY', '   ');
    expect(await (await vercelFunction(request(GROQ_STATUS_URL))).json()).toEqual({ configured: false });
    expect(await handleGroqStatus(request('/api/groq/status'), undefined).json()).toEqual({ configured: false });
  });

  it('rejects cross-origin browser requests', () => {
    const response = handleGroqStatus(request('/api/groq/status', { origin: 'https://evil.example' }), FAKE_KEY);
    expect(response.status).toBe(403);
  });
});

describe('chat completions route', () => {
  it('forwards the body to Groq with the server-side key and relays the reply', async () => {
    vi.stubEnv('GROQ_API_KEY', FAKE_KEY);
    const fetchMock = upstreamOk();
    vi.stubGlobal('fetch', fetchMock);
    const body = chatBody();
    const response = await vercelFunction(request(GROQ_CHAT_URL, {
      method: 'POST', body, origin: `https://${HOST}`, headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ choices: [{ message: { content: '{}' } }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GROQ_UPSTREAM_CHAT_COMPLETIONS);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${FAKE_KEY}`);
    // Not byte-identical to what the browser sent: the proxy resolves the model
    // and sets the reasoning effort on the way out.
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(sent).toMatchObject(JSON.parse(body));
    expect(sent.model).toBe(GROQ_DEFAULT_TEXT_MODEL);
    expect(sent.reasoning_effort).toBe('low');
  });

  it('returns 503 with setup guidance when the key is missing, without calling Groq', async () => {
    const fetchMock = upstreamOk();
    const response = await handleGroqChatCompletions(
      request('/api/groq/chat/completions', { method: 'POST', body: chatBody() }), undefined, { fetchImpl: fetchMock });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain('Vercel');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies with 413 before contacting Groq', async () => {
    const fetchMock = upstreamOk();
    const huge = chatBody({ image: 'x'.repeat(MAX_PROXY_BODY_BYTES) });
    const response = await handleGroqChatCompletions(
      request('/api/groq/chat/completions', { method: 'POST', body: huge }), FAKE_KEY, { fetchImpl: fetchMock });
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-origin, non-POST, and non-JSON requests', async () => {
    const fetchMock = upstreamOk();
    const cross = await handleGroqChatCompletions(request('/api/groq/chat/completions', {
      method: 'POST', body: chatBody(), origin: 'https://evil.example',
    }), FAKE_KEY, { fetchImpl: fetchMock });
    expect(cross.status).toBe(403);
    const get = await handleGroqChatCompletions(request('/api/groq/chat/completions'), FAKE_KEY, { fetchImpl: fetchMock });
    expect(get.status).toBe(405);
    const bad = await handleGroqChatCompletions(request('/api/groq/chat/completions', {
      method: 'POST', body: 'not json',
    }), FAKE_KEY, { fetchImpl: fetchMock });
    expect(bad.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates the narrow proxy payload and rejects remote image URLs or extra fields', () => {
    const valid = JSON.parse(chatBody()) as Record<string, unknown>;
    expect(validateChatPayload(valid)).toBeNull();
    expect(validateChatPayload({ ...valid, model: 'another-model' })).toContain('model');
    expect(GROQ_DEFAULT_TEXT_MODEL).toBe('openai/gpt-oss-120b');
    expect(GROQ_DEFAULT_VISION_MODEL).toBe('qwen/qwen3.8-27b');
    expect(validateChatPayload({ ...valid, stream: true })).toContain('unsupported');
    expect(validateChatPayload({
      ...valid,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/secret.png' } }] }],
    })).toContain('invalid');
    // Groq's token cap moved from max_tokens to max_completion_tokens; both pass.
    expect(validateChatPayload({ ...valid, max_completion_tokens: 3500 })).toBeNull();
    expect(validateChatPayload({ ...valid, max_completion_tokens: 99_000 })).toContain('token limit');
    // Groq documents 0-2 for its reasoning models.
    expect(validateChatPayload({ ...valid, temperature: 1.4 })).toBeNull();
    expect(validateChatPayload({ ...valid, temperature: 2.5 })).toContain('temperature');
  });

  it('sends images only to a model that can read them', () => {
    const models = [GROQ_DEFAULT_TEXT_MODEL, GROQ_DEFAULT_VISION_MODEL];
    // Groq's text models reject array content, so the proxy names the real fix.
    expect(validateChatPayload(JSON.parse(imageChatBody(GROQ_DEFAULT_TEXT_MODEL)), models, [GROQ_DEFAULT_VISION_MODEL])).toContain('vision model');
    expect(validateChatPayload(JSON.parse(imageChatBody(GROQ_DEFAULT_VISION_MODEL)), models, [GROQ_DEFAULT_VISION_MODEL])).toBeNull();
    // A deployment that turned the vision model off refuses the image outright.
    expect(validateChatPayload(JSON.parse(imageChatBody(GROQ_DEFAULT_VISION_MODEL)), [GROQ_DEFAULT_TEXT_MODEL], [])).toContain('not available');
  });

  it('passes upstream errors through and maps network failures and timeouts', async () => {
    const rejected = await handleGroqChatCompletions(request('/api/groq/chat/completions', { method: 'POST', body: chatBody() }), FAKE_KEY, {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'bad key' }), { status: 401 }),
    });
    expect(rejected.status).toBe(401);
    const offline = await handleGroqChatCompletions(request('/api/groq/chat/completions', { method: 'POST', body: chatBody() }), FAKE_KEY, {
      fetchImpl: async () => { throw new TypeError('fetch failed'); },
    });
    expect(offline.status).toBe(502);
    const slow = await handleGroqChatCompletions(request('/api/groq/chat/completions', { method: 'POST', body: chatBody() }), FAKE_KEY, {
      fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); },
    });
    expect(slow.status).toBe(504);
  });
});

describe('abuse controls', () => {
  it('throttles repeated Groq proxy calls before the upstream key is used again', async () => {
    resetRateLimits();
    const fetchMock = upstreamOk();
    let last: Response | null = null;
    for (let index = 0; index < 21; index += 1) {
      last = await handleGroqChatCompletions(
        request('/api/groq/chat/completions', { method: 'POST', body: chatBody() }),
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
    expect(isSameOriginRequest(new Request(`https://${HOST}/api/groq/status`))).toBe(true);
    const forwarded = new Request('http://internal/api/groq/status', {
      headers: { origin: `https://${HOST}`, host: HOST },
    });
    expect(isSameOriginRequest(forwarded)).toBe(true);
    const malformed = new Request(`https://${HOST}/api/groq/status`, { headers: { origin: 'null' } });
    expect(isSameOriginRequest(malformed)).toBe(false);
    const spoofedForwardedHost = new Request(`https://${HOST}/api/groq/status`, {
      headers: { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' },
    });
    expect(isSameOriginRequest(spoofedForwardedHost)).toBe(false);
  });
});

describe('Groq key handling', () => {
  it('cleans up the ways a key usually arrives from a paste', () => {
    // Surrounding quotes, a "Bearer " prefix and invisible characters all make
    // Groq answer 401 even though the key itself is valid.
    expect(normalizeApiKey('  key-abc123  ')).toBe('key-abc123');
    expect(normalizeApiKey('"key-abc123"')).toBe('key-abc123');
    expect(normalizeApiKey("'key-abc123'")).toBe('key-abc123');
    expect(normalizeApiKey('Bearer key-abc123')).toBe('key-abc123');
    expect(normalizeApiKey('key-\u200Babc\u00A0123')).toBe('key-abc123');
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
    const response = await handleGroqChatCompletions(
      request('/api/groq/chat/completions', { method: 'POST', body: chatBody() }),
      '  "Bearer key-abc123"\n',
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(response.status).toBe(200);
    expect(sent).toBe('Bearer key-abc123');
  });

  it('accepts a model override without a code change', async () => {
    resetRateLimits();
    const fetchMock = upstreamOk();
    const response = await handleGroqChatCompletions(
      request('/api/groq/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'hello' }] }),
      }),
      FAKE_KEY,
      { fetchImpl: fetchMock as unknown as typeof fetch, model: 'openai/gpt-oss-20b' },
    );
    expect(response.status).toBe(200);
  });
});

describe('upstream error reporting', () => {
  it('keeps the status but explains what Groq actually said', async () => {
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
    expect(parsed.error.message).toContain('GROQ_MODEL');
  });

  it('falls back to actionable advice when Groq sends nothing useful', async () => {
    const response = upstreamErrorResponse(401, '<html>not json</html>');
    const parsed = (await response.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('upstream_auth');
    expect(parsed.error.message).toContain('console.groq.com');
  });

  it('passes upstream failures through with a code instead of a bare body', async () => {
    resetRateLimits();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'bad key' }), { status: 401 }));
    const response = await handleGroqChatCompletions(
      request('/api/groq/chat/completions', { method: 'POST', body: chatBody() }),
      FAKE_KEY,
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(response.status).toBe(401);
    const parsed = (await response.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('upstream_auth');
    expect(parsed.error.message).toBe('bad key');
  });
});

describe('billing errors', () => {
  // Groq answers a *valid* key with a 429 once the free allowance is used up.
  // The status says "slow down", which is exactly the wrong advice, so the
  // proxy has to read the message rather than the status.
  const EXHAUSTED_BODY = JSON.stringify({
    error: {
      message: 'Please add a payment method to continue using the API. Please visit https://console.groq.com/settings/billing to add a payment method.',
      type: 'payment_required',
      code: 'payment_required',
    },
  });

  it('reports an exhausted free allowance as billing, not a bad key', async () => {
    for (const status of [401, 403, 429]) {
      const response = upstreamErrorResponse(status, EXHAUSTED_BODY);
      expect(response.status).toBe(status);
      const parsed = (await response.json()) as { error: { code: string; message: string; upstream: number } };
      expect(parsed.error.code).toBe('billing');
      expect(parsed.error.upstream).toBe(status);
      expect(parsed.error.message).toContain('https://console.groq.com/settings/billing');
      expect(parsed.error.message).toContain('free allowance');
      expect(parsed.error.message.toLowerCase()).not.toContain('re-copy it from console.groq.com');
    }
  });

  it('recognises the other ways a provider phrases an empty balance', async () => {
    for (const message of [
      'Your credit balance is too low to use this model.',
      'You exceeded your current quota, please check your plan.',
      'insufficient_quota: there are no credits left',
    ]) {
      const response = upstreamErrorResponse(429, JSON.stringify({ error: { message } }));
      const parsed = (await response.json()) as { error: { code: string } };
      expect(parsed.error.code).toBe('billing');
    }
  });

  it('still calls a genuine rate limit a rate limit', async () => {
    const response = upstreamErrorResponse(
      429,
      JSON.stringify({ error: { message: 'Rate limit reached for model openai/gpt-oss-120b. Limit 30, Used 30. Try again in 1s.' } }),
    );
    const parsed = (await response.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('rate_limited');
    expect(parsed.error.message).toContain('Rate limit reached');
  });

  it('still calls a genuinely wrong key an auth problem', async () => {
    const response = upstreamErrorResponse(401, JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
    const parsed = (await response.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('upstream_auth');
    expect(parsed.error.message).toContain('Incorrect API key provided');
  });

  it('reaches the browser through the chat endpoint with the billing link intact', async () => {
    resetRateLimits();
    const fetchMock = vi.fn(async () => new Response(EXHAUSTED_BODY, { status: 429 }));
    const response = await handleGroqChatCompletions(
      request('/api/groq/chat/completions', { method: 'POST', body: chatBody() }),
      FAKE_KEY,
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(response.status).toBe(429);
    const parsed = (await response.json()) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('billing');
    expect(parsed.error.message).toContain('console.groq.com/settings/billing');
    expect(parsed.error.message).toContain('no redeploy');
  });
});

describe('what actually reaches Groq', () => {
  it('keeps the browser and the server agreeing on the default model ids', () => {
    // The browser names a role, the proxy resolves the model. If these drift,
    // every request would be rejected as an unknown model.
    expect(GROQ_TEXT_MODEL).toBe(GROQ_DEFAULT_TEXT_MODEL);
    expect(GROQ_VISION_MODEL).toBe(GROQ_DEFAULT_VISION_MODEL);
  });

  it('maps the browser\'s model onto the one this deployment configured', async () => {
    resetRateLimits();
    let sent = '';
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
    });
    // GROQ_MODEL points elsewhere; the browser still sends the shipped default.
    const response = await handleGroqChatCompletions(
      request('/api/groq/chat/completions', { method: 'POST', body: chatBody() }),
      FAKE_KEY,
      { fetchImpl: fetchMock as unknown as typeof fetch, model: 'llama-3.3-70b-versatile' },
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(sent).model).toBe('llama-3.3-70b-versatile');
  });

  it('gives reasoning models an effort, so thinking cannot eat the answer budget', () => {
    const text = JSON.parse(finalizeUpstreamBody({ model: 'x', messages: [] }, 'openai/gpt-oss-120b', 'low'));
    expect(text.reasoning_effort).toBe('low');
    const vision = JSON.parse(finalizeUpstreamBody({ model: 'x', messages: [] }, 'qwen/qwen3.8-27b', 'none'));
    expect(vision.reasoning_effort).toBe('none');
    // A model that does not take the knob gets no invented parameter.
    const other = JSON.parse(finalizeUpstreamBody({ model: 'x', messages: [] }, 'llama-3.3-70b-versatile', undefined));
    expect(other.reasoning_effort).toBeUndefined();
  });

  it('drops the OpenAI-only image `detail` hint before forwarding', () => {
    const body = {
      model: 'qwen/qwen3.8-27b',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'read' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'high' } }] },
        { role: 'assistant', content: 'plain string stays alone' },
      ],
    };
    const sent = JSON.parse(finalizeUpstreamBody(body, 'qwen/qwen3.8-27b', 'none')) as {
      messages: Array<{ content: unknown }>;
    };
    const parts = sent.messages[0].content as Array<{ type: string; image_url?: { url: string; detail?: string } }>;
    expect(parts[1].image_url).toEqual({ url: 'data:image/png;base64,AAAA' });
    expect(sent.messages[1].content).toBe('plain string stays alone');
  });

  it('refuses an image outright when the vision model is switched off', async () => {
    resetRateLimits();
    const fetchMock = upstreamOk();
    const response = await handleGroqChatCompletions(
      request('/api/groq/chat/completions', { method: 'POST', body: imageChatBody(GROQ_DEFAULT_VISION_MODEL) }),
      FAKE_KEY,
      { fetchImpl: fetchMock as unknown as typeof fetch, visionModel: '' },
    );
    expect(response.status).toBe(400);
    const parsed = (await response.json()) as { error: { message: string } };
    expect(parsed.error.message).toContain('GROQ_VISION_MODEL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
