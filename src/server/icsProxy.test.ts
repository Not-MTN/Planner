import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleICS } from './icsProxy';

const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:1', 'DTSTART:20260928T090000Z', 'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

function feedRequest(feedUrl: string): Request {
  return new Request(`https://planner.test/api/ics?url=${encodeURIComponent(feedUrl)}`);
}

/** Stand in for the network: a calendar that answers once, or a redirect first. */
function mockFetch(responses: Response[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const mock = vi.fn(async () => queue.shift() ?? new Response(ICS, { status: 200 }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('calendar feed proxy', () => {
  it('refuses loopback, private, link-local and metadata addresses in every spelling', async () => {
    const blocked = [
      'http://localhost/feed.ics',
      'https://localhost./feed.ics',            // trailing dot used to slip past
      'https://LOCALHOST/feed.ics',
      'http://127.0.0.1/feed.ics',
      'http://127.1/feed.ics',                  // shortened
      'http://0177.0.0.1/feed.ics',             // octal
      'http://0x7f.0.0.1/feed.ics',             // hex
      'http://2130706433/feed.ics',             // one 32-bit integer
      'http://127.0.0.1./feed.ics',
      'http://10.0.0.5/feed.ics',
      'http://192.168.1.1/feed.ics',
      'http://172.16.0.1/feed.ics',
      'http://169.254.169.254/latest/meta-data/',  // cloud metadata
      'http://100.100.100.200/feed.ics',           // some clouds' metadata address
      'http://metadata.google.internal/feed.ics',
      'http://printer.local/feed.ics',
      'http://nas.lan/feed.ics',
      'http://[::1]/feed.ics',
      'http://[::ffff:127.0.0.1]/feed.ics',     // IPv4-mapped, arrives as ::ffff:7f00:1
      'http://[::ffff:7f00:1]/feed.ics',
      'http://[fd00::1]/feed.ics',
      'http://[fe80::1]/feed.ics',
      'http://[::]/feed.ics',
    ];
    for (const url of blocked) {
      const response = await handleICS(feedRequest(url));
      expect(response.status, `${url} should be refused`).toBe(400);
    }
  });

  it('never opens a connection to a refused address', async () => {
    const mock = mockFetch([new Response(ICS, { status: 200 })]);
    await handleICS(feedRequest('http://169.254.169.254/latest/meta-data/'));
    expect(mock).not.toHaveBeenCalled();
  });

  it('refuses non-http schemes and addresses with credentials', async () => {
    const mock = mockFetch([]);
    expect((await handleICS(feedRequest('file:///etc/passwd'))).status).toBe(400);
    expect((await handleICS(feedRequest('http://user:pass@calendar.example.com/f.ics'))).status).toBe(400);
    expect((await handleICS(new Request('https://planner.test/api/ics'))).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });

  it('re-checks every redirect hop, so an allowed host cannot bounce us inside', async () => {
    const mock = mockFetch([new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })]);
    const response = await handleICS(feedRequest('https://calendar.example.com/feed.ics'));
    expect(response.status).toBe(400);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('refuses when a redirect chain runs too long', async () => {
    const hops = Array.from({ length: 8 }, (_, index) =>
      new Response(null, { status: 302, headers: { location: `https://calendar.example.com/hop-${index}.ics` } }),
    );
    const mock = mockFetch(hops);
    const response = await handleICS(feedRequest('https://calendar.example.com/feed.ics'));
    expect(response.status).toBe(502);
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it('follows a legitimate redirect and returns the calendar', async () => {
    mockFetch([
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/real.ics' } }),
      new Response(ICS, { status: 200 }),
    ]);
    const response = await handleICS(feedRequest('https://calendar.example.com/feed.ics'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('BEGIN:VCALENDAR');
  });

  it('passes a public feed through, root dot and all', async () => {
    mockFetch([new Response(ICS, { status: 200 })]);
    const response = await handleICS(feedRequest('https://calendar.example.com./feed.ics'));
    expect(response.status).toBe(200);
  });

  it('rejects a response that is not a calendar', async () => {
    mockFetch([new Response('<html>nope</html>', { status: 200 })]);
    expect((await handleICS(feedRequest('https://calendar.example.com/feed.ics'))).status).toBe(422);
  });

  it('caps the body at 2 MB', async () => {
    const huge = `BEGIN:VCALENDAR\r\n${'X'.repeat(3 * 1024 * 1024)}\r\nEND:VCALENDAR`;
    mockFetch([new Response(huge, { status: 200 })]);
    const response = await handleICS(feedRequest('https://calendar.example.com/feed.ics'));
    expect(response.status).toBe(413);
  });

  it('reports an upstream error without leaking the body', async () => {
    mockFetch([new Response('internal boom', { status: 500 })]);
    const response = await handleICS(feedRequest('https://calendar.example.com/feed.ics'));
    expect(await response.text()).not.toContain('internal boom');
  });
});
