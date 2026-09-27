/**
 * Server-only xAI proxy shared by the Vercel Functions in `api/xai/*` and the
 * Vite dev/preview middleware in `vite.config.ts`.
 *
 * The xAI API key is passed in by the caller (read from `process.env.XAI_API_KEY`
 * on the server). It is never returned in a response, logged, or bundled into
 * the browser build: nothing under `src/` that the React app imports references
 * this module.
 */

export const XAI_UPSTREAM_CHAT_COMPLETIONS = 'https://api.x.ai/v1/chat/completions';

/**
 * Vercel rejects function request bodies over 4.5 MB before our code runs, so
 * the proxy enforces a slightly lower ceiling to give a consistent, friendly
 * error locally and on Vercel.
 */
export const MAX_PROXY_BODY_BYTES = 4_400_000;

/** Must stay below the Vercel function max duration (300s default with Fluid compute). */
export const UPSTREAM_TIMEOUT_MS = 180_000;

export const MISSING_KEY_MESSAGE =
  'XAI_API_KEY is not configured on the server. On Vercel, add it under Project Settings → Environment Variables and redeploy. Locally, add it to .env.local and restart the dev server.';

export interface ChatProxyOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
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
 * a present Origin must match the host the request was addressed to.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const originHost = hostOf(origin);
  if (!originHost) return false;
  const candidates = [
    request.headers.get('x-forwarded-host'),
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

class BodyTooLargeError extends Error {}

async function readLimitedBody(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return '';
  const reader = request.body.getReader();
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
  const key = apiKey?.trim();
  if (!key) return errorResponse(503, MISSING_KEY_MESSAGE);

  let body: string;
  try {
    body = await readLimitedBody(request, options.maxBodyBytes ?? MAX_PROXY_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(413, 'The image or plan is too large for one request. Use a smaller image (up to 3 MB).');
    }
    return errorResponse(400, 'The request body could not be read.');
  }
  try {
    JSON.parse(body);
  } catch {
    return errorResponse(400, 'The request body must be JSON.');
  }

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
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return timedOut
      ? errorResponse(504, 'The xAI request timed out. Please try again.')
      : errorResponse(502, 'Could not reach xAI. Check the server connection and try again.');
  }
}
