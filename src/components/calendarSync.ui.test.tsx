// @vitest-environment jsdom
/**
 * The two-way calendar screen, driven through the real app.
 *
 * The sync rules have their own tests; what this holds is the wiring — that
 * connecting an address asks the server what it has, that the events it answers
 * with actually land in the planner, that a local event goes up with the right
 * kind of write, and that the read-only switch is a real setting rather than a
 * label. The calendar server is a stub that answers the same four actions the
 * proxy speaks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { STORAGE_KEY, serialize } from '../storage';
import { addEvent } from '../mutate';
import { createEmptyState } from '../types';

const CALENDAR = 'https://dav.example.com/me/cal/';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function text(): string {
  return document.body.textContent ?? '';
}

function click(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`No element for ${selector}`);
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function clickByText(needle: string): void {
  const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes(needle));
  if (!button) throw new Error(`No button saying "${needle}"`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function setValue(field: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
  act(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function waitForText(needle: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!text().includes(needle)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for "${needle}"`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
}

function saved(): string {
  return window.localStorage.getItem(STORAGE_KEY) ?? '';
}

function mountApp(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}

/** One VEVENT, as a calendar server would hand it back inside calendar-data. */
function ics(uid: string, stamp: string, summary: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp.replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    'DTSTART:20261006T140000Z',
    'DTEND:20261006T150000Z',
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** The four actions of /api/caldav, answered without a network. */
function stubCalendarServer(options: { calendars?: { url: string; name: string }[]; events?: { href: string; data: string }[] } = {}) {
  const calls: { action: string; href?: string | null; etag?: string | null; data?: string }[] = [];
  const calendars = options.calendars ?? [{ url: CALENDAR, name: 'Work' }];
  const events = options.events ?? [{ href: `${CALENDAR}one.ics`, data: ics('abc@example.com', '2026-09-30T09:00:00.000Z', 'Team standup') }];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== '/api/caldav') {
      // Everything else behaves as if this device is offline, which is what the
      // app's other tests see: a rejected fetch, not a JSON 404 that a retry
      // loop would happily keep re-reading.
      throw new TypeError('Failed to fetch');
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const action = String(body.action ?? '');
    calls.push({ action, href: (body.href as string | null) ?? null, etag: (body.etag as string | null) ?? null, data: body.data as string | undefined });
    if (action === 'discover') return Response.json({ calendars });
    if (action === 'list') {
      return Response.json({ items: events.map((event) => ({ href: event.href, etag: 'e1', data: event.data })) });
    }
    if (action === 'push') return Response.json({ href: `${CALENDAR}pushed-${calls.length}.ics`, etag: 'e2' });
    if (action === 'delete') return Response.json({ ok: true });
    return Response.json({ error: { message: 'Unknown action.' } }, { status: 400 });
  });
  vi.stubGlobal('fetch', mock);
  return { mock, calls, calendars, events };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('planner-tour-done', '1');
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '#/today');
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollTo = () => undefined;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

async function openCalendarScreen(): Promise<void> {
  mountApp();
  await waitForText('Today');
  click('.side-tool[data-tour="settings"]');
  await waitForText('Connections');
  click('#set-tab-connections');
  await waitForText('Two-way calendars');
}

/**
 * The two-way section, on its own. The feed subscription above it renders the
 * same `form.sync-link` with the same field names, so every selector here has to
 * be scoped to this section or a test will quietly fill in the wrong form.
 */
function calendarSection(): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('section.set-section')].find((section) =>
    (section.querySelector('.kicker')?.textContent ?? '').includes('Two-way calendars'),
  );
  if (!found) throw new Error('No two-way calendar section');
  return found;
}

function fillCredentials(): void {
  const section = calendarSection();
  setValue(section.querySelector<HTMLInputElement>('input[inputmode="url"]')!, CALENDAR);
  setValue(section.querySelector<HTMLInputElement>('input[autocomplete="username"]')!, 'me');
  setValue(section.querySelector<HTMLInputElement>('input[type="password"]')!, 'secret');
}

async function submit(): Promise<void> {
  fillCredentials();
  const form = calendarSection().querySelector<HTMLFormElement>('form.sync-link');
  if (!form) throw new Error('No connect form');
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('connecting a calendar that can be written to', () => {
  it('asks the server for its calendars, then syncs the one it finds', async () => {
    const server = stubCalendarServer();
    await openCalendarScreen();
    await submit();

    await waitForText('Synced');
    expect(server.calls.map((call) => call.action)).toEqual(['discover', 'list']);
    // The pulled event is in the planner, tagged with where it came from.
    const state = JSON.parse(saved()) as { events: { title: string; source?: { url: string; uid: string } | null }[] };
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ title: 'Team standup', source: { url: CALENDAR, uid: `${CALENDAR}one.ics` } });
    // A new event in the calendar needs no upload.
    expect(server.calls.some((call) => call.action === 'push')).toBe(false);
  });

  it('offers a choice when one address holds several calendars', async () => {
    const server = stubCalendarServer({
      calendars: [
        { url: `${CALENDAR}work/`, name: 'Work' },
        { url: `${CALENDAR}home/`, name: 'Home' },
      ],
      events: [],
    });
    await openCalendarScreen();
    await submit();
    await waitForText('Which calendar?');
    expect(text()).toContain('Home');
    clickByText('Use this one');
    await waitForText('Synced');
    const connected = JSON.parse(window.localStorage.getItem('planner-calendars') ?? '[]') as { url: string; name: string }[];
    // The first choice is the one used; the listing happened only once.
    expect(connected).toEqual([expect.objectContaining({ url: `${CALENDAR}work/`, name: 'Work' })]);
    expect(server.calls.filter((call) => call.action === 'discover')).toHaveLength(1);
  });

  it('uploads an event the planner already had, and remembers where it went', async () => {
    const seeded = addEvent(
      createEmptyState(),
      { title: 'Dentist', date: '2026-10-07', startTime: '08:00', endTime: '08:30', category: 'personal', note: 'Bring the card', important: false, source: null },
      'dentist',
      '2026-09-29T09:00:00.000Z',
    );
    window.localStorage.setItem(STORAGE_KEY, serialize(seeded));
    const server = stubCalendarServer({ events: [] });
    await openCalendarScreen();
    await submit();

    await waitForText('Synced');
    const push = server.calls.find((call) => call.action === 'push');
    expect(push).toBeTruthy();
    // A create (no href) rather than an update, and the event travels with it.
    expect(push!.href).toBeNull();
    expect(push!.data).toContain('UID:dentist@planner');
    const connected = JSON.parse(window.localStorage.getItem('planner-calendars') ?? '[]') as { hrefs: Record<string, string> }[];
    expect(Object.keys(connected[0]!.hrefs)).toEqual(['dentist']);
  });

  it('keeps the password on this device, and remembers a read-only choice', async () => {
    stubCalendarServer({ events: [] });
    await openCalendarScreen();
    await submit();
    await waitForText('Synced');

    // The switch is a setting, not a label: turning it off is stored.
    clickByText('Sending my events');
    await waitForText('Read-only');
    const connected = JSON.parse(window.localStorage.getItem('planner-calendars') ?? '[]') as { push: boolean; url: string }[];
    expect(connected[0]).toMatchObject({ push: false, url: CALENDAR });
    // …and it stays on this device: the planner's own sync never sees it.
    expect(window.localStorage.getItem(STORAGE_KEY) ?? '').not.toContain('secret');

    clickByText('Remove');
    expect(window.localStorage.getItem('planner-calendars')).toBeNull();
  });

  it('says so when the address answers with nothing, instead of pretending to sync', async () => {
    stubCalendarServer({ calendars: [], events: [] });
    await openCalendarScreen();
    await submit();
    await waitForText('No calendar was found at that address');
    expect(window.localStorage.getItem('planner-calendars')).toBeNull();
  });
});
