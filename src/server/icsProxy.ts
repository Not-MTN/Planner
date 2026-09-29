/**
 * Server-side proxy for calendar feed subscriptions: GET /api/ics?url=<https feed>.
 *
 * The browser's CSP forbids cross-origin fetch, and most calendar hosts don't
 * send CORS headers — so subscriptions go same-origin through this handler,
 * same pattern as the Groq proxy. Hardened against abuse:
 * - GET only, http(s) URLs only, no credentials forwarded
 * - private/loopback hostnames refused (basic SSRF guard)
 * - 10 s timeout, body capped at 2 MB, text output only
 */
import { API_SECURITY_HEADERS } from './security.js';

const MAX_BODY = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...API_SECURITY_HEADERS },
  });
}

/** Refuse obvious internal targets. Hostnames (not just IPs) are also checked so "localhost" can't slip through. */
function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '[::1]' || host.startsWith('fe80:')) return true;
  if (/^127\./.test(host) || /^0\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts.every((n) => n === 0)) return true;
  }
  return false;
}

export async function handleICS(request: Request): Promise<Response> {
  if (request.method !== 'GET') return jsonError(405, 'Method not allowed.');
  const url = new URL(request.url).searchParams.get('url') ?? '';
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return jsonError(400, 'That calendar address is not a valid URL.');
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return jsonError(400, 'Only http(s) calendar feeds can be fetched.');
  }
  if (target.username || target.password) {
    return jsonError(400, 'Calendar addresses with credentials are not supported.');
  }
  if (isForbiddenHost(target.hostname)) {
    return jsonError(400, 'That calendar address is not allowed.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // A plain calendar reader; never forward the app's own cookies/headers.
        'User-Agent': 'PlannerICS/1.0 (+https://planner.app)',
        Accept: 'text/calendar, text/plain, application/octet-stream, */*;q=0.1',
      },
    });
    if (!upstream.ok) return jsonError(502, `The calendar server answered ${upstream.status}.`);
    const reader = upstream.body?.getReader();
    if (!reader) return jsonError(502, 'The calendar server sent an empty response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value?.byteLength ?? 0;
      if (size > MAX_BODY) {
        void reader.cancel();
        return jsonError(413, 'That calendar file is too large (2 MB max).');
      }
      if (value) chunks.push(value);
    }
    const body = new TextDecoder('utf-8', { fatal: false }).decode(concat(chunks));
    if (!/BEGIN:VCALENDAR/i.test(body)) return jsonError(422, 'That address did not return a calendar (.ics).');
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
        ...API_SECURITY_HEADERS,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return jsonError(504, 'The calendar server took too long.');
    return jsonError(502, 'The calendar could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
