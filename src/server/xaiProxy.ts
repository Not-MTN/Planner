/**
 * Server-only xAI proxy shared by the Vercel Functions in `api/xai/*` and the
 * Vite dev/preview middleware in `vite.config.ts`.
 *
 * The xAI API key is passed in by the caller (read from `process.env.XAI_API_KEY`
 * on the server). It is never returned in a response, logged, or bundled into
 * the browser build: nothing under `src/` that the React app imports references
 * this module.
 */

import { API_SECURITY_HEADERS, BodyTooLargeError, rateLimitResponse, readLimitedBody } from './security.js';

export const XAI_UPSTREAM_CHAT_COMPLETIONS = 'https://api.x.ai/v1/chat/completions';
/** Default model; override with the XAI_MODEL environment variable if needed. */
export const XAI_ALLOWED_MODEL = 'grok-4.7';

/**
 * Vercel rejects function request bodies over 4.5 MB before our code runs, so
 * the proxy enforces a slightly lower ceiling to give a consistent, friendly
 * error locally and on Vercel.
 */
export const MAX_PROXY_BODY_BYTES = 4_400_000;
export const MAX_UPSTREAM_RESPONSE_BYTES = 2_000_000;

/** Must stay below the Vercel function max duration (300s default with Fluid compute). */
export const UPSTREAM_TIMEOUT_MS = 180_000;

export const MISSING_KEY_MESSAGE =
  'XAI_API_KEY is not configured on the server. On Vercel, add it under Project Settings → Environment Variables and redeploy. Locally, add it to .env.local and restart the dev server.';

export interface ChatProxyOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
  /** Overrides the allowed model, e.g. from XAI_MODEL. */
  model?: string;
}

/**
 * Keys are usually pasted into a dashboard field, and a surprising number of
 * copies pick up surrounding quotes, a "Bearer " prefix, or invisible
 * characters from a document. Each of those produces a 401 from xAI while the
 * key itself is perfectly valid, so clean it up before use.
 */
export function normalizeApiKey(value: string | undefined): string {
  if (!value) return '';
  let key = value.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, '').trim();
  return key.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
}

function defaultUpstreamMessage(code: string): string {
  if (code === 'upstream_auth') {
    return 'xAI rejected the API key. Re-copy it from console.x.ai into the XAI_API_KEY environment variable, then redeploy. Watch for stray quotes, spaces or a "Bearer " prefix around the key.';
  }
  if (code === 'upstream_forbidden') {
    return 'xAI refused this request for that key (403). The key may not have access to this model.';
  }
  if (code === 'model_not_found') {
    return 'xAI does not recognise that model name. Set XAI_MODEL on the server to a model your key can use (for example grok-4.7) and redeploy.';
  }
  if (code === 'rate_limited') {
    return 'xAI is rate-limiting this key right now. Wait a moment and try again.';
  }
  return 'xAI returned an error for this request.';
}

/**
 * Upstream failures keep their status code but gain a stable code and xAI's own
 * message, so the app can explain what actually happened instead of guessing.
 */
export function upstreamErrorResponse(status: number, body: string): Response {
  let message = '';
  try {
    const parsed = JSON.parse(body) as unknown;
    const error = (parsed as { error?: unknown } | null)?.error;
    if (typeof error === 'string') message = error;
    else if (error && typeof error === 'object') message = String((error as { message?: unknown }).message ?? '');
  } catch {
    /* not JSON; fall back to the generic message */
  }
  const code =
    status === 401
      ? 'upstream_auth'
      : status === 403
        ? 'upstream_forbidden'
        : status === 404
          ? 'model_not_found'
          : status === 429
            ? 'rate_limited'
            : 'upstream_error';
  return json(status, { error: { message: message || defaultUpstreamMessage(code), code, upstream: status } });
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function errorResponse(status: number, message: string, extraHeaders?: Record<string, string>): Response {
  return json(status, { error: { message } }, extraHeaders);
}

function hostOf(value: string | null): string {
  if (!value) return '';
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Browsers attach `Origin` to cross-origin requests and to same-origin POSTs.
 * Requests without an Origin (curl, server-to-server, same-origin GET) are allowed;
 * a present Origin must match the Host/URL the request was addressed to. Forwarded
 * host headers are deliberately ignored so a caller cannot spoof an allowlisted host.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const originHost = hostOf(origin);
  if (!originHost) return false;
  const candidates = [
    request.headers.get('host'),
    hostOf(request.url),
  ]
    .flatMap((value) => (value ? value.split(',') : []))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return candidates.includes(originHost);
}

function crossOriginResponse(): Response {
  return errorResponse(403, 'Cross-origin xAI proxy requests are not allowed.');
}

export function handleXAIStatus(request: Request, apiKey: string | undefined): Response {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
  }
  // Only a boolean is ever reported; the key itself never leaves the server.
  return json(200, { configured: Boolean(apiKey && apiKey.trim()) });
}

const MAX_MESSAGES = 10;
const MAX_MESSAGE_TEXT_BYTES = 80_000;
const ALLOWED_CHAT_KEYS = new Set(['model', 'messages', 'temperature', 'max_tokens', 'response_format']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validImageDataUrl(value: unknown): boolean {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\s]+$/.test(value);
}

function validMessageContent(value: unknown): { valid: boolean; textBytes: number } {
  if (typeof value === 'string') return { valid: true, textBytes: new TextEncoder().encode(value).byteLength };
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return { valid: false, textBytes: 0 };
  let textBytes = 0;
  for (const part of value) {
    if (!isRecord(part) || (part.type !== 'text' && part.type !== 'image_url')) return { valid: false, textBytes: 0 };
    if (part.type === 'text') {
      if (typeof part.text !== 'string') return { valid: false, textBytes: 0 };
      textBytes += new TextEncoder().encode(part.text).byteLength;
    } else {
      const image = isRecord(part.image_url) ? part.image_url : null;
      if (!image || !validImageDataUrl(image.url)) return { valid: false, textBytes: 0 };
      if (image.detail !== undefined && !['auto', 'low', 'high'].includes(String(image.detail))) return { valid: false, textBytes: 0 };
    }
  }
  return { valid: true, textBytes };
}

/** Only the narrow JSON shape used by Planner is allowed through the API-key proxy. */
export function validateChatPayload(value: unknown, allowedModel: string = XAI_ALLOWED_MODEL): string | null {
  if (!isRecord(value)) return 'The request body must be a JSON object.';
  if ([...Object.keys(value)].some((key) => !ALLOWED_CHAT_KEYS.has(key))) return 'The request contains an unsupported field.';
  if (value.model !== allowedModel) return 'That AI model is not available through this endpoint.';
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > MAX_MESSAGES) return 'The request must contain a short messages list.';
  let textBytes = 0;
  for (const message of value.messages) {
    if (!isRecord(message) || !['system', 'user', 'assistant'].includes(String(message.role))) return 'The request contains an invalid message.';
    const content = validMessageContent(message.content);
    if (!content.valid) return 'The request contains invalid message content.';
    textBytes += content.textBytes;
  }
  if (textBytes > MAX_MESSAGE_TEXT_BYTES) return 'The text in this request is too long.';
  if (value.temperature !== undefined && (typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 1)) {
    return 'The temperature value is invalid.';
  }
  if (value.max_tokens !== undefined && (typeof value.max_tokens !== 'number' || !Number.isInteger(value.max_tokens) || value.max_tokens < 1 || value.max_tokens > 4_000)) {
    return 'The token limit is invalid.';
  }
  if (value.response_format !== undefined && (!isRecord(value.response_format) || value.response_format.type !== 'json_object')) {
    return 'The response format is invalid.';
  }
  return null;
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new BodyTooLargeError();
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
}

export async function handleXAIChatCompletions(
  request: Request,
  apiKey: string | undefined,
  options: ChatProxyOptions = {},
): Promise<Response> {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method not allowed.', { Allow: 'POST' });
  }
  const key = normalizeApiKey(apiKey);
  if (!key) return errorResponse(503, MISSING_KEY_MESSAGE);
  const limited = rateLimitResponse(request, 'xai-chat', 20, 60_000);
  if (limited) return limited;

  let body: string;
  try {
    body = await readLimitedBody(request, options.maxBodyBytes ?? MAX_PROXY_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(413, 'The image or plan is too large for one request. Use a smaller image (up to 3 MB).');
    }
    return errorResponse(400, 'The request body could not be read.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return errorResponse(400, 'The request body must be JSON.');
  }
  const model = normalizeApiKey(options.model) || XAI_ALLOWED_MODEL;
  const validationError = validateChatPayload(parsed, model);
  if (validationError) return errorResponse(400, validationError);

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const upstream = await fetchImpl(XAI_UPSTREAM_CHAT_COMPLETIONS, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
    });
    const responseBody = await readLimitedResponse(upstream, MAX_UPSTREAM_RESPONSE_BYTES);
    if (!upstream.ok) {
      // Keep the status, but report why — a 401 can come from a stray character
      // in the key or from something in front of the app, not only a bad key.
      return upstreamErrorResponse(upstream.status, responseBody);
    }
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...API_SECURITY_HEADERS,
      },
    });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return errorResponse(502, 'The xAI response was too large.');
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return timedOut
      ? errorResponse(504, 'The xAI request timed out. Please try again.')
      : errorResponse(502, 'Could not reach xAI. Check the server connection and try again.');
  }
}
