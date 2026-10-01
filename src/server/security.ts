/** Small, dependency-free security helpers shared by the server-side API handlers. */

export const API_SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), midi=(), xr-spatial-tracking=(), clipboard-read=()',
};

export class BodyTooLargeError extends Error {}

/** Read a request without allowing a chunked request to bypass the byte limit. */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<string> {
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

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();
const MAX_BUCKETS = 10_000;

function clientKey(request: Request): string {
  // These headers are set by Vercel/our reverse proxy. They are only a best-effort
  // limiter key, never an authentication decision.
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = request.headers.get('x-real-ip')?.trim();
  return forwarded || real || request.headers.get('host')?.trim().toLowerCase() || 'anonymous';
}

function prune(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
    if (buckets.size < MAX_BUCKETS) break;
  }
  // A hostile stream of spoofed forwarding headers must not grow this map forever.
  if (buckets.size >= MAX_BUCKETS) buckets.clear();
}

/**
 * Best-effort per-client throttling for public serverless endpoints. It is an
 * abuse brake, not an authentication boundary; a durable edge limiter can be
 * placed in front of the app for production deployments that need stronger
 * quotas across serverless instances.
 */
export function rateLimitResponse(
  request: Request,
  bucketName: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Response | null {
  prune(now);
  const key = `${bucketName}:${clientKey(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return new Response(JSON.stringify({ error: { message: 'Too many requests. Please try again shortly.' } }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfter),
      ...API_SECURITY_HEADERS,
    },
  });
}

/** Test hook; it has no effect on application data. */
export function resetRateLimits(): void {
  buckets.clear();
  aiQuota.clear();
}

/**
 * How many AI requests one signed-in account may make in a day.
 *
 * Not a product limit — a guard rail. The API key belongs to whoever deployed
 * this, and one runaway account (a loop, a script, a very enthusiastic week)
 * can exhaust it for everybody. Set `AI_DAILY_REQUESTS` to change it; zero
 * turns the check off.
 */
export const AI_DAILY_REQUESTS_DEFAULT = 60;

const AI_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Bounded like `buckets`: a map that grows forever is its own outage. */
const MAX_QUOTA_ENTRIES = 20_000;
const aiQuota = new Map<string, RateBucket>();

/**
 * A per-account daily allowance for AI calls, on top of the per-client limiter.
 *
 * Only signed-in accounts are counted. The planner is meant to work without an
 * account, and someone using it locally is not spending a shared key any
 * differently than they would be from any other tab — refusing them would make
 * the app worse without protecting anything.
 *
 * Best-effort, for the same reason the limiter above is: state lives in one
 * serverless instance, so a deployment running several will allow several
 * times the number. Enough to stop one account spoiling it for everyone, and
 * deliberately not a billing system.
 */
export function aiQuotaResponse(
  accountId: string,
  limit = AI_DAILY_REQUESTS_DEFAULT,
  now = Date.now(),
): Response | null {
  if (limit <= 0) return null;
  if (aiQuota.size >= MAX_QUOTA_ENTRIES && !aiQuota.has(accountId)) aiQuota.clear();
  const current = aiQuota.get(accountId);
  if (!current || current.resetAt <= now) {
    aiQuota.set(accountId, { count: 1, resetAt: now + AI_QUOTA_WINDOW_MS });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  const hours = Math.max(1, Math.round(retryAfter / 3600));
  return new Response(
    JSON.stringify({
      error: {
        message: `This account has used its ${limit} AI requests for today. It resets in about ${hours} ${hours === 1 ? 'hour' : 'hours'}.`,
        code: 'quota_exceeded',
      },
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfter),
        ...API_SECURITY_HEADERS,
      },
    },
  );
}
