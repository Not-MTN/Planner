/**
 * Server-side CalDAV client: POST /api/caldav, one action per request.
 *
 * A calendar server will not talk to the browser directly. It refuses
 * cross-origin requests, it insists on a WebDAV method (`PROPFIND`, `REPORT`)
 * that `fetch()` cannot even send with a custom body, and its answers are XML.
 * So the browser posts `{ action, url, username, password, ... }` here and this
 * handler speaks WebDAV on its behalf — the same proxy pattern as `/api/ics`,
 * with the same reasoning applied to the URLs it will connect to:
 *
 * - POST only, same-origin only, credentials in the body (never in the URL, so
 *   they cannot land in a log line or a Referer header)
 * - private, loopback, link-local and metadata addresses refused, in every
 *   spelling, including hostnames that *resolve* to one
 * - 20 s timeout, response capped at 4 MB, text output only
 * - upstream errors are reported as a short message, never with the
 *   credentials or the raw body echoed back
 *
 * Actions: `discover` (which calendars does this address offer), `list`
 * (VEVENTs in a time range, with etags), `push` (PUT one event, conditionally),
 * `delete` (DELETE one event, conditionally).
 */
import { API_SECURITY_HEADERS, BodyTooLargeError, rateLimitResponse, readLimitedBody } from './security.js';
import { isForbiddenTarget } from './icsProxy.js';
import { isSameOriginRequest } from './groqProxy.js';

const TIMEOUT_MS = 20_000;
const MAX_RESPONSE = 4 * 1024 * 1024;
const MAX_BODY = 512 * 1024;
const DAV_HEADERS = {
  'User-Agent': 'PlannerCalDAV/1.0 (+https://planner.app)',
};

export interface CalDavItem {
  href: string;
  etag: string;
  data: string;
}

export interface CalDavCalendar {
  url: string;
  name: string;
  readOnly: boolean;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
    },
  });
}

function fail(status: number, message: string, code?: string): Response {
  return json(status, { error: code ? { message, code } : { message } });
}

// ─────────────────────────────────────────────────────────────────────────────
// XML, read without a dependency.
//
// A CalDAV answer is a small, well-formed document from a server we chose to
// trust with a password — but "well-formed" is not a guarantee, and a
// multi-megabyte `<calendar-data>` blob should not be turned into a DOM tree in
// a serverless function. These helpers walk the text: strip namespace
// prefixes, decode entities, find the elements we asked for and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** The local name of a tag: `D:getetag` → `getetag`, `getetag` → `getetag`. */
export function localName(tag: string): string {
  const colon = tag.lastIndexOf(':');
  return (colon < 0 ? tag : tag.slice(colon + 1)).toLowerCase();
}

export interface XmlElement {
  name: string;
  /** Everything between this element's start and its matching end tag. */
  inner: string;
  attributes: Record<string, string>;
}

/**
 * Every element with this local name, at any depth, in document order, with
 * proper nesting matched: `<a><a>x</a></a>` yields both, and an unclosed tag
 * does not swallow the rest of the document.
 *
 * Closing tags are consumed by the same pass as opening ones, on a stack, so a
 * nested element of the same name closes its own copy rather than the outer
 * one — which is exactly how `<response>` lists behave when a server omits the
 * namespace prefix on the reply's inner elements.
 */
export function elements(xml: string, name: string): XmlElement[] {
  const wanted = name.toLowerCase();
  const out: XmlElement[] = [];
  const open: Array<{ name: string; start: number; attributes: Record<string, string> }> = [];
  const tokens = /<([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\/([A-Za-z_][\w.:-]*)\s*>/g;
  for (let match = tokens.exec(xml); match; match = tokens.exec(xml)) {
    const [full, rawName, rawAttributes, selfClosing, closingName] = match;
    if (closingName) {
      const top = open.pop();
      if (!top) continue;
      if (localName(top.name) === localName(closingName) && localName(closingName) === wanted) {
        out.push({ name: wanted, inner: xml.slice(top.start, match.index), attributes: top.attributes });
      }
      continue;
    }
    const elementName = localName(rawName);
    const attributes: Record<string, string> = {};
    for (const attribute of rawAttributes.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attributes[localName(attribute[1])] = decodeXmlText(attribute[3] ?? attribute[4] ?? '');
    }
    if (selfClosing) {
      if (elementName === wanted) out.push({ name: elementName, inner: '', attributes });
      continue;
    }
    open.push({ name: elementName, start: match.index + full.length, attributes });
  }
  return out;
}

/** Text of the first child element with this local name, or ''. */
export function childText(inner: string, name: string): string {
  const found = elements(inner, name)[0];
  return found ? decodeXmlText(found.inner).trim() : '';
}

/** Local names of the elements inside the first `<resourcetype>` (calendar, addressbook…). */
export function resourceTypes(inner: string): string[] {
  const type = elements(inner, 'resourcetype')[0];
  if (!type) return [];
  return [...type.inner.matchAll(/<([A-Za-z_][\w.:-]*)/g)]
    .map((match) => localName(match[1]))
    .filter((name) => name !== 'resourcetype');
}

export interface ParsedCalDavResponse {
  href: string;
  etag: string;
  calendars: string[];
  displayName: string;
  status: string;
  data: string;
}

/** One entry per `<response>` in a PROPFIND or REPORT answer. */
export function parseDavResponses(xml: string): ParsedCalDavResponse[] {
  return elements(xml, 'response').map((response) => ({
    href: decodeXmlText(childText(response.inner, 'href')).trim(),
    etag: childText(response.inner, 'getetag').replace(/^W\//i, '').replace(/^"|"$/g, ''),
    calendars: resourceTypes(response.inner),
    displayName: childText(response.inner, 'displayname'),
    status: childText(response.inner, 'status'),
    data: childText(response.inner, 'calendar-data'),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// WebDAV calls.
// ─────────────────────────────────────────────────────────────────────────────

function credentials(username: string, password: string): Record<string, string> {
  if (!username && !password) return {};
  // btoa is ASCII-only; a password with accents would throw. Buffer handles it.
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${token}` };
}

interface Target {
  url: URL;
  headers: Record<string, string>;
}

async function resolveTarget(rawUrl: string, username: string, password: string): Promise<Target | Response> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail(400, 'That calendar address is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail(400, 'Calendar addresses must start with https.');
  if (url.username || url.password) return fail(400, 'Put the username and password in their fields, not in the address.');
  if (await isForbiddenTarget(url.hostname)) return fail(400, 'That calendar address is not allowed.');
  return { url, headers: { ...DAV_HEADERS, ...credentials(username, password) } };
}

/**
 * One WebDAV request. Redirects are not followed: a calendar that answers with
 * a Location has been misconfigured, and following it is how an allowed host
 * bounces the server at something internal. `DELETE`/`PUT` redirects would also
 * change a write into a mystery.
 */
async function davRequest(target: Target, method: string, body: string | null, extra: Record<string, string>): Promise<Response | ResponseFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target.url, {
      method,
      headers: { ...target.headers, ...extra, ...(body ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}) },
      body: body ?? undefined,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel();
      return { failure: fail(502, 'The calendar server redirected the request. Use the address it redirects to.') };
    }
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { failure: fail(504, 'The calendar server took too long to answer.') };
    const message = error instanceof Error ? error.message : '';
    if (/certificate|self.signed|UNABLE_TO_VERIFY/i.test(message)) return { failure: fail(502, 'The calendar server’s certificate could not be verified.') };
    return { failure: fail(502, 'The calendar server could not be reached.') };
  } finally {
    clearTimeout(timer);
  }
}

interface ResponseFailure {
  failure: Response;
}

function isFailure(value: Response | ResponseFailure): value is ResponseFailure {
  return typeof value === 'object' && value !== null && 'failure' in value;
}

/** Read a response body as text, refusing anything absurdly large. */
async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value?.byteLength ?? 0;
    if (size > MAX_RESPONSE) {
      void reader.cancel();
      return null;
    }
    if (value) chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(joined);
}

/** 401 and 403 are the two answers worth naming precisely. */
function authFailure(response: Response): Response | null {
  if (response.status === 401) return fail(401, 'The calendar server rejected those credentials.', 'unauthorized');
  if (response.status === 403) return fail(403, 'Those credentials are not allowed to use this calendar.', 'forbidden');
  if (response.status === 404) return fail(404, 'That calendar address was not found on the server.', 'not_found');
  if (response.status === 412) return fail(409, 'The calendar changed since it was last read.', 'conflict');
  return null;
}

const CALENDAR_QUERY = (start: string, end: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">
    <C:time-range start="${start}" end="${end}"/>
  </C:comp-filter></C:comp-filter></C:filter>
</C:calendar-query>`;

const DISCOVERY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:displayname/><D:current-user-privilege-set/></D:prop></D:propfind>`;

/** `20260901T000000Z` — the stamp CalDAV's time-range filter wants. */
export function davStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace('T', 'T').slice(0, 15) + 'Z';
}

async function discover(target: Target, depth: string): Promise<Response> {
  const response = await davRequest(target, 'PROPFIND', DISCOVERY, { Depth: depth });
  if (isFailure(response)) return response.failure;
  const named = authFailure(response);
  if (named) return named;
  const text = await readCapped(response);
  if (text === null) return fail(502, 'The calendar server sent more data than this app will read.');
  if (!response.ok && response.status !== 207) return fail(502, `The calendar server answered ${response.status}.`);
  return json(200, { calendars: calendarsFrom(text, target.url), xml: hasCalendarData(text) ? text : null });
}

/**
 * The calendar collections in a PROPFIND answer. The address itself counts when
 * it *is* a calendar (`resourcetype` contains `calendar`), even if a server is
 * stingy about listing its children — that is the common case for a URL pasted
 * from a calendar app's "caldav account" page.
 */
export function calendarsFrom(xml: string, base: URL): CalDavCalendar[] {
  const out: CalDavCalendar[] = [];
  const seen = new Set<string>();
  for (const item of parseDavResponses(xml)) {
    if (!item.href || !item.calendars.includes('calendar')) continue;
    let url: URL;
    try {
      url = new URL(item.href, base);
    } catch {
      continue;
    }
    if (!seen.has(url.toString())) {
      seen.add(url.toString());
      out.push({ url: url.toString(), name: item.displayName.slice(0, 120), readOnly: /read/i.test(item.status) });
    }
  }
  return out;
}

function hasCalendarData(xml: string): boolean {
  return /<[^>]*calendar-data/i.test(xml);
}

export interface CalDavBody {
  action?: unknown;
  url?: unknown;
  username?: unknown;
  password?: unknown;
  start?: unknown;
  end?: unknown;
  href?: unknown;
  etag?: unknown;
  data?: unknown;
  depth?: unknown;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function handleCalDav(request: Request, env: Record<string, string | undefined> = process.env): Promise<Response> {
  void env;
  if (request.method !== 'POST') return fail(405, 'Method not allowed.');
  if (!isSameOriginRequest(request)) return fail(403, 'Cross-origin calendar requests are not allowed.');
  const limited = rateLimitResponse(request, 'caldav', 120, 60_000);
  if (limited) return limited;

  let body: CalDavBody;
  try {
    body = JSON.parse(await readLimitedBody(request, MAX_BODY)) as CalDavBody;
  } catch (error) {
    if (error instanceof BodyTooLargeError) return fail(413, 'That request is too large.');
    return fail(400, 'Body must be JSON.');
  }

  const action = text(body.action, 20);
  const target = await resolveTarget(text(body.url, 2000), text(body.username, 200), text(body.password, 400));
  if (target instanceof Response) return target;

  try {
    if (action === 'discover') {
      // Depth 0 first: the address is very often the calendar itself, and a
      // server that forbids listing children still answers about itself.
      const probe = await davRequest(target, 'PROPFIND', DISCOVERY, { Depth: '0' });
      if (isFailure(probe)) return probe.failure;
      const named = authFailure(probe);
      if (named) return named;
      const probeText = await readCapped(probe);
      if (probeText === null) return fail(502, 'The calendar server sent more data than this app will read.');
      if (!probe.ok && probe.status !== 207) return fail(502, `The calendar server answered ${probe.status}.`);
      const own = calendarsFrom(probeText, target.url);
      if (own.length > 0) return json(200, { calendars: own });
      const deeper = await discover(target, '1');
      return deeper;
    }

    if (action === 'list') {
      const start = davStamp(text(body.start, 40) || new Date().toISOString());
      const end = davStamp(text(body.end, 40) || new Date(Date.now() + 180 * 86_400_000).toISOString());
      if (!/^\d{8}T\d{6}Z$/.test(start) || !/^\d{8}T\d{6}Z$/.test(end)) return fail(400, 'Expected start and end as ISO timestamps.');
      const response = await davRequest(target, 'REPORT', CALENDAR_QUERY(start, end), { Depth: '1' });
      if (isFailure(response)) return response.failure;
      const named = authFailure(response);
      if (named) return named;
      const text2 = await readCapped(response);
      if (text2 === null) return fail(502, 'The calendar server sent more data than this app will read.');
      if (!response.ok && response.status !== 207) return fail(502, `The calendar server answered ${response.status}.`);
      const items: CalDavItem[] = parseDavResponses(text2)
        .filter((item) => item.href && item.data && /BEGIN:VEVENT/i.test(item.data))
        .slice(0, 2000)
        .map((item) => ({ href: new URL(item.href, target.url).toString(), etag: item.etag, data: item.data.slice(0, 200_000) }));
      return json(200, { items });
    }

    if (action === 'push') {
      const href = text(body.href, 2000);
      const data = typeof body.data === 'string' ? body.data : '';
      if (!/BEGIN:VEVENT/i.test(data)) return fail(400, 'Expected an iCalendar event to upload.');
      if (data.length > 128 * 1024) return fail(413, 'That event is too large to upload.');
      const etag = text(body.etag, 200);
      let writeUrl: URL | null = null;
      if (href) {
        try {
          writeUrl = new URL(href, target.url);
        } catch {
          return fail(400, 'Expected a valid event address.');
        }
        if (writeUrl.origin !== target.url.origin) return fail(400, 'An event address must stay on the same calendar server.');
      }
      const writeTarget: Target = writeUrl ? { url: writeUrl, headers: target.headers } : target;
      const conditional: Record<string, string> = etag ? { 'If-Match': `"${etag}"` } : { 'If-None-Match': '*' };
      const response = await davRequest(writeTarget, 'PUT', data, {
        'Content-Type': 'text/calendar; charset=utf-8',
        ...conditional,
      });
      if (isFailure(response)) return response.failure;
      const named = authFailure(response);
      if (named) return named;
      void response.body?.cancel();
      if (!response.ok) return fail(502, `The calendar server refused the upload (${response.status}).`);
      const newEtag = (response.headers.get('etag') ?? '').replace(/^W\//i, '').replace(/^"|"$/g, '');
      return json(200, { etag: newEtag, href: writeTarget.url.toString() });
    }

    if (action === 'delete') {
      const href = text(body.href, 2000);
      if (!href) return fail(400, 'Expected an event address.');
      let url: URL;
      try {
        url = new URL(href, target.url);
      } catch {
        return fail(400, 'Expected a valid event address.');
      }
      if (url.origin !== target.url.origin) return fail(400, 'An event address must stay on the same calendar server.');
      const etag = text(body.etag, 200);
      const response = await davRequest({ url, headers: target.headers }, 'DELETE', null, etag ? { 'If-Match': `"${etag}"` } : {});
      if (isFailure(response)) return response.failure;
      void response.body?.cancel();
      // 404 means it is already gone, which is what the caller wanted.
      if (!response.ok && response.status !== 404 && response.status !== 204) {
        const named = authFailure(response);
        if (named) return named;
        return fail(502, `The calendar server refused the deletion (${response.status}).`);
      }
      return json(200, { ok: true });
    }

    return fail(400, 'Unknown action. Expected discover, list, push or delete.');
  } catch (error) {
    console.error(`[planner] caldav ${action} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    return fail(502, 'The calendar server could not be reached.');
  }
}
