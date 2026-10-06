import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarsFrom, decodeXmlText, davStamp, elements, handleCalDav, localName, parseDavResponses } from './calDav';

/*
 * The CalDAV handler is the one place in the app that holds somebody else's
 * password and speaks WebDAV with it. Two things therefore matter more than the
 * feature working: which hosts it will connect to at all, and that a failure
 * says something short and true instead of echoing the server's answer back.
 *
 * DNS is answered here, exactly as in the /api/ics tests: resolving a name is
 * the network, and a test that reaches the network fails on a plane.
 */
const dns = vi.hoisted(() => ({ addresses: ['93.184.216.34'] as string[], fails: false }));
vi.mock('node:dns/promises', () => ({
  lookup: async () => {
    if (dns.fails) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return dns.addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  },
}));

const APP = 'https://planner.test/api/caldav';

function dav(body: Record<string, unknown>, init: RequestInit = {}): Request {
  return new Request(APP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  });
}

function mockFetch(responses: Array<Response | (() => Response)>): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const mock = vi.fn(async () => {
    const next = queue.shift();
    if (!next) return new Response('', { status: 207 });
    return typeof next === 'function' ? next() : next;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const EVENT = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:abc@example.com',
  'DTSTAMP:20261001T100000Z',
  'DTSTART:20261005T090000Z',
  'DTEND:20261005T100000Z',
  'SUMMARY:Team standup',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebDAV XML, read the cheap way', () => {
  it('reads elements by local name, with nesting matched', () => {
    const xml = `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/a/</D:href>
      <D:propstat><D:prop><D:displayname>Work &amp; life</D:displayname></D:prop></D:propstat>
    </D:response><D:response><D:href>/b/</D:href></D:response></D:multistatus>`;
    const responses = elements(xml, 'response');
    expect(responses).toHaveLength(2);
    expect(responses[0]!.inner).toContain('Work &amp; life');
    expect(responses[0]!.inner).not.toContain('/b/');
    const parsed = parseDavResponses(xml);
    expect(parsed.map((item) => item.href)).toEqual(['/a/', '/b/']);
    expect(parsed[0]!.displayName).toBe('Work & life');
  });

  it('decodes entities, including numeric ones, and folds namespace prefixes', () => {
    expect(decodeXmlText('a &amp; b &#8212; c &#x2014; d')).toBe('a & b — c — d');
    expect(localName('C:calendar-data')).toBe('calendar-data');
    expect(localName('getetag')).toBe('getetag');
  });

  it('turns a date into the filter stamp a calendar server expects', () => {
    expect(davStamp('2026-10-05T09:00:00.000Z')).toBe('20261005T090000Z');
  });

  it('finds the calendar collections in a depth-1 listing, and only those', () => {
    const xml = `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
      <D:response><D:href>/cal/</D:href><D:propstat><D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>Work</D:displayname>
      </D:prop></D:propstat></D:response>
      <D:response><D:href>/inbox/</D:href><D:propstat><D:prop>
        <D:resourcetype><D:collection/></D:resourcetype><D:displayname>Inbox</D:displayname>
      </D:prop></D:propstat></D:response>
      <D:response><D:href>/cal/</D:href><D:propstat><D:prop>
        <D:resourcetype><C:calendar/></D:resourcetype>
      </D:prop></D:propstat></D:response>
    </D:multistatus>`;
    const found = calendarsFrom(xml, new URL('https://dav.example.com/principals/me/'));
    expect(found).toEqual([{ url: 'https://dav.example.com/cal/', name: 'Work', readOnly: false }]);
  });
});

describe('the CalDAV proxy', () => {
  it('refuses loopback and metadata addresses before it connects to anything', async () => {
    const mock = mockFetch([]);
    for (const url of ['http://127.0.0.1/cal/', 'https://localhost/cal/', 'http://169.254.169.254/cal/', 'http://10.0.0.2/cal/']) {
      const response = await handleCalDav(dav({ action: 'list', url }));
      expect(response.status, url).toBe(400);
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it('accepts the address itself when it is the calendar, without listing children', async () => {
    const mock = mockFetch([
      new Response(
        `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/me/cal/</D:href>
         <D:propstat><D:prop><D:resourcetype><C:calendar/></D:resourcetype><D:displayname>Home</D:displayname></D:prop></D:propstat>
         </D:response></D:multistatus>`,
        { status: 207 },
      ),
    ]);
    const response = await handleCalDav(dav({ action: 'discover', url: 'https://dav.example.com/me/cal/' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ calendars: [{ url: 'https://dav.example.com/me/cal/', name: 'Home', readOnly: false }] });
    expect(mock).toHaveBeenCalledTimes(1);
    const [, init] = mock.mock.calls[0]! as [URL, RequestInit];
    expect(init.method).toBe('PROPFIND');
    expect((init.headers as Record<string, string>).Depth).toBe('0');
  });

  it('lists events in a time range, absolutising hrefs and ignoring non-events', async () => {
    const mock = mockFetch([
      new Response(
        `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
          <D:response><D:href>/me/cal/one.ics</D:href><D:propstat><D:prop>
            <D:getetag>"abc"</D:getetag><C:calendar-data>${EVENT.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r\n/g, '&#13;')}</C:calendar-data>
          </D:prop></D:propstat></D:response>
          <D:response><D:href>/me/cal/broken.ics</D:href><D:propstat><D:prop><D:getetag>"d"</D:getetag></D:prop></D:propstat></D:response>
        </D:multistatus>`,
        { status: 207 },
      ),
    ]);
    const response = await handleCalDav(
      dav({ action: 'list', url: 'https://dav.example.com/me/cal/', username: 'me', password: 'pw', start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { href: string; etag: string; data: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.href).toBe('https://dav.example.com/me/cal/one.ics');
    expect(body.items[0]!.etag).toBe('abc');
    expect(body.items[0]!.data).toContain('BEGIN:VCALENDAR');
    const [, init] = mock.mock.calls[0]! as [URL, RequestInit];
    expect(init.method).toBe('REPORT');
    expect(String(init.body)).toContain('20261001T000000Z');
    expect(String(init.body)).toContain('20261101T000000Z');
    // The password travels as a Basic header and nowhere else.
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('me:pw')}`);
  });

  it('creates with If-None-Match and updates with If-Match, and reads the new etag back', async () => {
    const mock = mockFetch([
      new Response('', { status: 201, headers: { ETag: 'W/"v2"' } }),
      new Response(null, { status: 204, headers: { ETag: '"v3"' } }),
    ]);
    const created = await handleCalDav(dav({ action: 'push', url: 'https://dav.example.com/me/cal/', data: EVENT }));
    await expect(created.json()).resolves.toEqual({ etag: 'v2', href: 'https://dav.example.com/me/cal/' });
    const updated = await handleCalDav(
      dav({ action: 'push', url: 'https://dav.example.com/me/cal/', href: 'https://dav.example.com/me/cal/one.ics', etag: 'v2', data: EVENT }),
    );
    await expect(updated.json()).resolves.toEqual({ etag: 'v3', href: 'https://dav.example.com/me/cal/one.ics' });
    const first = mock.mock.calls[0]! as [URL, RequestInit];
    const second = mock.mock.calls[1]! as [URL, RequestInit];
    expect((first[1].headers as Record<string, string>)['If-None-Match']).toBe('*');
    expect((second[1].headers as Record<string, string>)['If-Match']).toBe('"v2"');
    expect(second[0].toString()).toBe('https://dav.example.com/me/cal/one.ics');
  });

  it('reports a lost race as a conflict, and a rejection as a plain failure', async () => {
    mockFetch([new Response('', { status: 412 })]);
    const conflict = await handleCalDav(dav({ action: 'push', url: 'https://dav.example.com/me/cal/', href: 'https://dav.example.com/me/cal/one.ics', etag: 'old', data: EVENT }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ error: { code: 'conflict' } });

    mockFetch([new Response('', { status: 507 })]);
    const refused = await handleCalDav(dav({ action: 'push', url: 'https://dav.example.com/me/cal/', data: EVENT }));
    expect(refused.status).toBe(502);
    await expect(refused.json()).resolves.toMatchObject({ error: { message: expect.stringContaining('507') } });
  });

  it('names bad credentials, and never repeats what the server said', async () => {
    mockFetch([new Response('<html>please log in</html>', { status: 401 })]);
    const unauthorized = await handleCalDav(dav({ action: 'list', url: 'https://dav.example.com/me/cal/', username: 'me', password: 'wrong' }));
    expect(unauthorized.status).toBe(401);
    const body = (await unauthorized.json()) as { error: { code?: string; message: string } };
    expect(body.error.code).toBe('unauthorized');
    expect(JSON.stringify(body)).not.toContain('please log in');
    expect(JSON.stringify(body)).not.toContain('wrong');

    mockFetch([new Response('', { status: 403 })]);
    const forbidden = await handleCalDav(dav({ action: 'delete', url: 'https://dav.example.com/me/cal/', href: 'https://dav.example.com/me/cal/one.ics' }));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ error: { code: 'forbidden' } });
  });

  it('treats an already-deleted event as deleted', async () => {
    mockFetch([new Response('', { status: 404 })]);
    const response = await handleCalDav(dav({ action: 'delete', url: 'https://dav.example.com/me/cal/', href: 'https://dav.example.com/me/cal/gone.ics', etag: 'x' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('will not be pointed at another server mid-flight', async () => {
    const mock = mockFetch([]);
    const response = await handleCalDav(
      dav({ action: 'push', url: 'https://dav.example.com/me/cal/', href: 'https://evil.example.com/steal.ics', data: EVENT }),
    );
    expect(response.status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });

  it('guards its own surface: POST, same origin, known action, no URL credentials', async () => {
    mockFetch([]);
    const target = { url: 'https://dav.example.com/me/cal/' };
    expect((await handleCalDav(new Request(APP, { method: 'GET' }))).status).toBe(405);
    expect((await handleCalDav(dav({ action: 'list', ...target }, { headers: { Origin: 'https://evil.test', Host: 'planner.test' } }))).status).toBe(403);
    expect((await handleCalDav(dav({ action: 'wipe', ...target }))).status).toBe(400);
    expect((await handleCalDav(dav({ action: 'list', url: 'https://me:pw@dav.example.com/cal/' }))).status).toBe(400);
    expect((await handleCalDav(dav({ action: 'list' }))).status).toBe(400);
  });
});
