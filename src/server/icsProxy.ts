/**
 * Server-side proxy for calendar feed subscriptions: GET /api/ics?url=<https feed>.
 *
 * The browser's CSP forbids cross-origin fetch, and most calendar hosts don't
 * send CORS headers — so subscriptions go same-origin through this handler,
 * same pattern as the Groq proxy. Hardened against abuse:
 * - GET only, http(s) URLs only, no credentials forwarded
 * - private, loopback, link-local and metadata addresses refused, in every
 *   spelling, including hostnames that *resolve* to one
 * - redirects are followed by hand so an allowed host cannot bounce us at
 *   cloud metadata or anything else inside its own network
 * - 10 s timeout, body capped at 2 MB, text output only
 */
import { lookup } from 'node:dns/promises';
import { API_SECURITY_HEADERS } from './security.js';

const MAX_BODY = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...API_SECURITY_HEADERS },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Address classification.
//
// The WHATWG URL parser already folds the exotic IPv4 spellings into dotted
// quad — 2130706433, 0177.0.0.1, 0x7f.0.0.1 and 127.1 all arrive as
// "127.0.0.1" — so the work left is: accept every spelling anyway (defence in
// depth against a future parser), expand IPv6 properly (the parser rewrites
// [::ffff:127.0.0.1] as [::ffff:7f00:1], which a naive prefix test misses),
// strip the FQDN root dot, and resolve names.
// ─────────────────────────────────────────────────────────────────────────────

/** One IPv4 byte written in decimal, octal (0177) or hex (0x7f). */
function ipv4Byte(part: string): number | null {
  const text = part.toLowerCase();
  const value = /^0x[0-9a-f]+$/.test(text)
    ? Number.parseInt(text.slice(2), 16)
    : /^0[0-7]+$/.test(text)
      ? Number.parseInt(text, 8)
      : /^[0-9]+$/.test(text)
        ? Number.parseInt(text, 10)
        : Number.NaN;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * inet_aton: every IPv4 spelling — "127.0.0.1", "127.1", "0177.0.0.1",
 * "0x7f.0.0.1", "2130706433". Returns the 32-bit value, or null if this is not
 * an IPv4 literal at all.
 */
function ipv4ToNumber(host: string): number | null {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  // The last part absorbs every byte left over: "a.b.c" reads c as 16 bits.
  const tailBits = 8 * (5 - parts.length);
  const tailMax = tailBits >= 32 ? 0xffffffff : 2 ** tailBits - 1;
  let value = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const byte = ipv4Byte(parts[index]);
    if (byte === null) return null;
    if (index === parts.length - 1) {
      if (byte > tailMax) return null;
      return (value * 2 ** tailBits + byte) >>> 0;
    }
    if (byte > 255) return null;
    value = value * 256 + byte;
  }
  return null;
}

function isPrivateIPv4(value: number): boolean {
  const a = (value >>> 24) & 0xff;
  const b = (value >>> 16) & 0xff;
  if (a === 0) return true;                                 // 0.0.0.0/8
  if (a === 10) return true;                                // private
  if (a === 127) return true;                               // loopback
  if (a === 100 && b >= 64 && b <= 127) return true;        // carrier-grade NAT
  if (a === 169 && b === 254) return true;                  // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;         // private
  if (a === 192 && b === 168) return true;                  // private
  if (a === 192 && b === 0 && ((value >>> 8) & 0xff) === 0) return true; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true;     // benchmarking
  if (a >= 224) return true;                                // multicast + reserved
  return false;
}

/** Rewrite a trailing dotted quad inside an IPv6 literal into two hex groups. */
function foldIPv4Tail(text: string): string | null {
  const match = /^(.*?)((?::|^)(?:\d{1,3}\.){3}\d{1,3})$/.exec(text);
  if (!match) return text;
  const value = ipv4ToNumber(match[2].replace(/^:/, ''));
  if (value === null) return null;
  return `${match[1]}:${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
}

/** Expand an IPv6 literal into its eight 16-bit groups, or null if malformed. */
function ipv6Groups(text: string): number[] | null {
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups: number[] = [];
  const read = (chunk: string): boolean => {
    if (chunk === '') return true;
    for (const piece of chunk.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return false;
      groups.push(Number.parseInt(piece, 16));
    }
    return true;
  };
  if (!read(halves[0])) return null;
  if (halves.length === 1) return groups.length === 8 ? groups : null;
  const tailStart = groups.length;
  if (!read(halves[1])) return null;
  const missing = 8 - groups.length;
  if (missing < 0) return null;
  return groups.slice(0, tailStart).concat(new Array<number>(missing).fill(0), groups.slice(tailStart));
}

function isPrivateIPv6(groups: number[]): boolean {
  const bytes: number[] = [];
  for (const group of groups) bytes.push((group >>> 8) & 0xff, group & 0xff);
  if (bytes.every((byte) => byte === 0)) return true;                     // ::
  if ((bytes[0] & 0xfe) === 0xfc) return true;                            // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;       // fe80::/10 link-local
  const word = (from: number): number =>
    (((bytes[from] << 24) | (bytes[from + 1] << 16) | (bytes[from + 2] << 8) | bytes[from + 3]) >>> 0);
  const zeros = (from: number, to: number): boolean => bytes.slice(from, to).every((byte) => byte === 0);
  // IPv4 smuggled inside IPv6: ::a.b.c.d (compatible), ::ffff:a.b.c.d (mapped),
  // 64:ff9b::/96 (NAT64) and 2002::/16 (6to4).
  if (zeros(0, 12)) return isPrivateIPv4(word(12));
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateIPv4(word(12));
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zeros(4, 12)) {
    return isPrivateIPv4(word(12));
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isPrivateIPv4(word(2));
  return false;
}

/** Is this literal address inside someone's network? */
function isPrivateLiteral(address: string): boolean {
  const text = address.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (/^\d{1,3}(\.\d{1,3}){1,3}$/.test(text) || /^\d+$/.test(text)) {
    const value = ipv4ToNumber(text);
    if (value !== null) return isPrivateIPv4(value);
  }
  if (text.includes(':')) {
    const folded = foldIPv4Tail(text);
    const groups = folded === null ? null : ipv6Groups(folded);
    if (groups) return isPrivateIPv6(groups);
  }
  return false;
}

/** Strip the FQDN root label so "localhost." cannot sidestep the suffix tests. */
function normaliseHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

function isForbiddenName(hostname: string): boolean {
  const host = normaliseHost(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
  if (host.endsWith('.localdomain') || host.endsWith('.home.arpa')) return true;
  if (host === 'metadata' || host.endsWith('metadata.google.internal')) return true;
  return false;
}

/**
 * Refuse internal targets. Hostnames (not just IPs) are also checked, and every
 * name is resolved first: a calendar host is public by definition, so anything
 * pointing inside a network is a probe, whatever it calls itself.
 *
 * Exported because the CalDAV client connects to the same kind of host and must
 * not have a second, weaker opinion about what "internal" means.
 */
export async function isForbiddenTarget(hostname: string): Promise<boolean> {
  const host = normaliseHost(hostname);
  if (isPrivateLiteral(host) || isForbiddenName(host)) return true;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    // Unresolvable is not "inside the network" — the fetch will say so itself.
    return false;
  }
  return addresses.some((entry) => isPrivateLiteral(entry.address));
}

const FEED_HEADERS = {
  // A plain calendar reader; never forward the app's own cookies/headers.
  'User-Agent': 'PlannerICS/1.0 (+https://planner.app)',
  Accept: 'text/calendar, text/plain, application/octet-stream, */*;q=0.1',
};

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Follow redirects by hand so every hop is checked: an allowed host must
    // not be able to bounce us at 169.254.169.254 or anything else internal.
    let current = target;
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (await isForbiddenTarget(current.hostname)) return jsonError(400, 'That calendar address is not allowed.');
      const upstream = await fetch(current, { signal: controller.signal, redirect: 'manual', headers: FEED_HEADERS });
      if (upstream.status >= 300 && upstream.status < 400) {
        void upstream.body?.cancel();
        const location = upstream.headers.get('location');
        if (!location) return jsonError(502, 'The calendar server sent a redirect without an address.');
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return jsonError(502, 'The calendar server sent an unusable redirect.');
        }
        if (next.protocol !== 'https:' && next.protocol !== 'http:') {
          return jsonError(400, 'Only http(s) calendar feeds can be fetched.');
        }
        current = next;
        continue;
      }
      response = upstream;
      break;
    }
    if (!response) return jsonError(502, 'That calendar redirected too many times.');
    if (!response.ok) {
      void response.body?.cancel();
      return jsonError(502, `The calendar server answered ${response.status}.`);
    }
    const reader = response.body?.getReader();
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
