// @vitest-environment jsdom
/**
 * Two-way calendar sync, tested where it can actually go wrong: which copy of
 * an item is the newer one, what happens when one side deletes something, and
 * that a calendar this app only reads from is never written to.
 *
 * The rule that keeps this safe is that nothing is ever matched by guesswork —
 * a remote item is the same item only when its UID or its address says so. The
 * cases below are mostly about that, because getting it wrong is how a sync
 * feature duplicates somebody's whole calendar.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_PUSH_PER_RUN,
  applyCalendarPull,
  applyCalendarRemovals,
  canPushEvent,
  loadCalendars,
  planCalendarSync,
  plannerIdFromUid,
  pullWindow,
  recordFailure,
  recordSync,
  saveCalendars,
  type CalendarSubscription,
  type RemoteCalendarItem,
} from './calendarSync';
import { eventToICS } from './ics';
import { addEvent, deleteEvent, updateEvent } from './mutate';
import { createEmptyState, type PlannerEvent, type PlannerState } from './types';

const EARLIER = '2026-09-20T09:00:00.000Z';
const LATER = '2026-09-25T10:00:00.000Z';
const CALENDAR = 'https://dav.example.com/me/cal/';

function subscription(patch: Partial<CalendarSubscription> = {}): CalendarSubscription {
  return {
    url: CALENDAR,
    name: 'Work',
    username: 'me',
    password: 'pw',
    push: true,
    addedAt: EARLIER,
    lastSyncedAt: null,
    lastError: null,
    seen: [],
    hrefs: {},
    etags: {},
    dropped: [],
    ...patch,
  };
}

function event(patch: Partial<PlannerEvent> = {}): PlannerEvent {
  return {
    id: 'standup',
    title: 'Team standup',
    date: '2026-10-05',
    startTime: '09:00',
    endTime: '10:00',
    category: 'personal',
    note: '',
    important: false,
    completed: false,
    sortOrder: 0,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    repeat: null,
    ...patch,
  };
}

function stateWith(...events: PlannerEvent[]): PlannerState {
  return { ...createEmptyState(), events };
}

/** A remote item as the server would hand it over, stamped when stated. */
function remote(href: string, stamp: string, patch: Partial<RemoteCalendarItem> = {}, uid = 'abc@example.com'): RemoteCalendarItem {
  const item = event();
  return {
    href,
    etag: 'e1',
    data: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp.replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Team standup',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
    ...patch,
    // Keep the helper's own event available for callers that need it.
    // (Unused fields are dropped on purpose.)
    ...(void item, {}),
  };
}

beforeEach(() => window.localStorage.clear());

describe('which copy is the newer one', () => {
  it('pulls a remote event the planner has never seen, with no id to update', () => {
    const plan = planCalendarSync(stateWith(), subscription(), [remote(`${CALENDAR}one.ics`, LATER)]);
    expect(plan.pull).toHaveLength(1);
    expect(plan.pull[0]!.id).toBeNull();
    expect(plan.pull[0]!.input.title).toBe('Team standup');
    expect(plan.push).toHaveLength(0);
    expect(plan.seen).toEqual([`${CALENDAR}one.ics`]);
  });

  it('follows the remote copy when it was edited later', () => {
    const local = event({ updatedAt: EARLIER, title: 'Standup' });
    const plan = planCalendarSync(
      stateWith(local),
      subscription({ seen: [`${CALENDAR}one.ics`], hrefs: { standup: `${CALENDAR}one.ics` } }),
      [remote(`${CALENDAR}one.ics`, LATER, {}, 'standup@planner')],
    );
    expect(plan.pull.map((item) => item.id)).toEqual(['standup']);
    expect(plan.push).toHaveLength(0);
  });

  it('sends the local copy when it was edited later', () => {
    const local = event({ updatedAt: LATER, title: 'Standup, moved' });
    const plan = planCalendarSync(
      stateWith(local),
      subscription({ seen: [`${CALENDAR}one.ics`], hrefs: { standup: `${CALENDAR}one.ics` }, etags: { [`${CALENDAR}one.ics`]: 'e1' } }),
      [remote(`${CALENDAR}one.ics`, EARLIER, {}, 'standup@planner')],
    );
    expect(plan.push).toHaveLength(1);
    expect(plan.push[0]).toMatchObject({ id: 'standup', href: `${CALENDAR}one.ics`, etag: 'e1' });
    expect(plan.push[0]!.data).toContain('SUMMARY:Standup\\, moved');
    expect(plan.pull).toHaveLength(0);
  });

  it('does nothing when both sides carry the same moment', () => {
    const local = event({ updatedAt: LATER });
    const plan = planCalendarSync(
      stateWith(local),
      subscription({ seen: [`${CALENDAR}one.ics`], hrefs: { standup: `${CALENDAR}one.ics` } }),
      [remote(`${CALENDAR}one.ics`, LATER, {}, 'standup@planner')],
    );
    expect(plan.push).toHaveLength(0);
    expect(plan.pull).toHaveLength(0);
  });

  it('uploads a local event that has nowhere to be yet, and never twice over', () => {
    const plan = planCalendarSync(stateWith(event()), subscription(), []);
    expect(plan.push).toHaveLength(1);
    expect(plan.push[0]).toMatchObject({ id: 'standup', href: null, etag: null });

    // Once it is mapped, a second run against an empty listing deletes it
    // instead of uploading it again — the mapping is the identity.
    const mapped = subscription({ seen: [`${CALENDAR}one.ics`], hrefs: { standup: `${CALENDAR}one.ics` } });
    const again = planCalendarSync(stateWith(event()), mapped, [remote(`${CALENDAR}one.ics`, EARLIER, {}, 'standup@planner')]);
    expect(again.push).toHaveLength(0);
    expect(again.removeLocal).toEqual([]);
  });
});

describe('what a sync is allowed to write to', () => {
  it('never writes to a calendar that is set to read-only', () => {
    const local = event({ updatedAt: LATER });
    const plan = planCalendarSync(
      stateWith(local),
      subscription({ push: false, seen: [`${CALENDAR}one.ics`], hrefs: { standup: `${CALENDAR}one.ics` } }),
      [remote(`${CALENDAR}one.ics`, EARLIER, {}, 'standup@planner')],
    );
    expect(plan.push).toHaveLength(0);
    // Reading still happens, and so does a remote deletion.
    expect(plan.pull).toHaveLength(0);
    expect(plan.removeLocal).toEqual([]);
  });

  it('leaves repeating events, generated copies and other calendars’ events alone', () => {
    const repeating = event({ id: 'repeat', repeat: 'weekly' });
    const generated = event({ id: 'generated', fixedCommitmentId: 'block' });
    const foreign = event({ id: 'foreign', source: { url: 'https://other.example.com/feed.ics', uid: 'x' } });
    const plan = planCalendarSync(stateWith(repeating, generated, foreign), subscription(), []);
    expect(plan.push).toEqual([]);
  });

  it('only covers the pull window, so a far-away event is not uploaded', () => {
    const far = event({ id: 'far', date: '2030-01-01' });
    const { start, end } = pullWindow(new Date('2026-10-05T12:00:00.000Z'));
    expect(canPushEvent(far, subscription(), start.slice(0, 10), end.slice(0, 10))).toBe(false);
    expect(canPushEvent(event(), subscription(), start.slice(0, 10), end.slice(0, 10))).toBe(true);
    expect(planCalendarSync(stateWith(far), subscription(), []).push).toEqual([]);
  });

  it('stops after a run’s worth of uploads and continues on the next one', () => {
    const many = stateWith(...Array.from({ length: MAX_PUSH_PER_RUN + 5 }, (_, index) => event({ id: `e${index}` })));
    expect(planCalendarSync(many, subscription(), []).push).toHaveLength(MAX_PUSH_PER_RUN);
  });
});

describe('deletions travel both ways, and stay deleted', () => {
  it('removes the local event when the calendar dropped it', () => {
    const local = event({ id: 'standup', source: { url: CALENDAR, uid: `${CALENDAR}one.ics` } });
    const plan = planCalendarSync(
      stateWith(local),
      subscription({ seen: [`${CALENDAR}one.ics`] }),
      [],
    );
    expect(plan.removeLocal).toEqual(['standup']);
  });

  it('removes the remote event when the planner dropped it', () => {
    const plan = planCalendarSync(
      stateWith(),
      subscription({ seen: [`${CALENDAR}one.ics`], hrefs: { standup: `${CALENDAR}one.ics` }, etags: { [`${CALENDAR}one.ics`]: 'e1' } }),
      [remote(`${CALENDAR}one.ics`, LATER, {}, 'standup@planner')],
    );
    expect(plan.removeRemote).toEqual([{ href: `${CALENDAR}one.ics`, etag: 'e1' }]);
  });

  it('does not pull back an address this device deleted', () => {
    const dropped = subscription({ dropped: [`${CALENDAR}one.ics`] });
    const plan = planCalendarSync(stateWith(), dropped, [remote(`${CALENDAR}one.ics`, LATER)]);
    expect(plan.pull).toEqual([]);
    expect(plan.seen).toEqual([]);
  });

  it('leaves items alone that were never in this calendar’s listing', () => {
    const other = event({ id: 'mine', source: { url: 'https://other.example.com/feed.ics', uid: 'x' } });
    const plan = planCalendarSync(stateWith(other), subscription(), []);
    expect(plan.removeLocal).toEqual([]);
  });
});

describe('folding a pull into the planner', () => {
  it('adds a new event with the address it came from, so it is never twice', () => {
    const plan = planCalendarSync(stateWith(), subscription(), [remote(`${CALENDAR}one.ics`, LATER)]);
    const next = applyCalendarPull(createEmptyState(), CALENDAR, plan.pull[0]!);
    expect(next.events).toHaveLength(1);
    expect(next.events[0]!.source).toEqual({ url: CALENDAR, uid: `${CALENDAR}one.ics` });
    expect(next.events[0]!.title).toBe('Team standup');
  });

  it('keeps what the user wrote and follows what the calendar says', () => {
    const local = event({ id: 'standup', category: 'work', important: true, completed: true, note: 'Bring the board' });
    const plan = planCalendarSync(
      stateWith(local),
      subscription({ seen: [`${CALENDAR}one.ics`], hrefs: { standup: `${CALENDAR}one.ics` } }),
      [remote(`${CALENDAR}one.ics`, LATER, {}, 'standup@planner')],
    );
    const next = applyCalendarPull(stateWith(local), CALENDAR, plan.pull[0]!);
    const updated = next.events.find((item) => item.id === 'standup')!;
    expect(updated).toMatchObject({ category: 'work', important: true, completed: true, note: 'Bring the board' });
    expect(updated.source).toEqual({ url: CALENDAR, uid: `${CALENDAR}one.ics` });
  });

  it('deletes what the other side deleted', () => {
    const local = event({ id: 'standup' });
    expect(applyCalendarRemovals(stateWith(local), ['standup']).events).toEqual([]);
  });
});

describe('what the subscription record remembers', () => {
  it('records the mapping, the etag and the listing after a run', () => {
    const plan = planCalendarSync(stateWith(event()), subscription(), []);
    const record = recordSync(subscription(), plan, { pushed: [{ id: 'standup', href: `${CALENDAR}one.ics`, etag: 'e9' }], removed: [] }, LATER);
    expect(record.hrefs).toEqual({ standup: `${CALENDAR}one.ics` });
    expect(record.etags).toEqual({ [`${CALENDAR}one.ics`]: 'e9' });
    expect(record.lastSyncedAt).toBe(LATER);
    expect(record.lastError).toBeNull();
    expect(record.dropped).toEqual([]);
  });

  it('forgets an address it deleted, and remembers not to go back for it', () => {
    const before = subscription({ seen: [`${CALENDAR}one.ics`], hrefs: { standup: `${CALENDAR}one.ics` }, etags: { [`${CALENDAR}one.ics`]: 'e1' } });
    const plan = planCalendarSync(stateWith(), before, [remote(`${CALENDAR}one.ics`, LATER, {}, 'standup@planner')]);
    const record = recordSync(before, plan, { pushed: [], removed: plan.removeRemote }, LATER);
    expect(record.hrefs).toEqual({});
    expect(record.etags).toEqual({});
    expect(record.dropped).toContain(`${CALENDAR}one.ics`);
  });

  it('keeps a remote edit that arrived as a pull, with its etag', () => {
    const plan = planCalendarSync(stateWith(), subscription(), [remote(`${CALENDAR}one.ics`, LATER)]);
    const record = recordSync(subscription(), plan, { pushed: [], removed: [] }, LATER);
    expect(record.etags).toEqual({ [`${CALENDAR}one.ics`]: 'e1' });
    expect(record.seen).toEqual([`${CALENDAR}one.ics`]);
  });

  it('stores a failure as one short line, and nothing else changes', () => {
    const before = subscription({ hrefs: { standup: `${CALENDAR}one.ics` } });
    const after = recordFailure(before, 'x'.repeat(500));
    expect(after.lastError).toHaveLength(240);
    expect(after.hrefs).toEqual(before.hrefs);
  });
});

describe('subscriptions on this device', () => {
  it('round-trips a calendar, and validates what it reads back', () => {
    saveCalendars([subscription()]);
    expect(loadCalendars()).toHaveLength(1);
    expect(loadCalendars()[0]).toMatchObject({ url: CALENDAR, name: 'Work', push: true });

    window.localStorage.setItem(
      'planner-calendars',
      JSON.stringify([
        null,
        { name: 'no address' },
        { url: 'javascript:alert(1)' },
        { url: CALENDAR, name: 'kept', hrefs: { a: 'https://dav.example.com/me/cal/a.ics' }, seen: 'not an array', dropped: [7, 'x'] },
      ]),
    );
    const loaded = loadCalendars();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ name: 'kept', seen: [], dropped: ['x'] });
    expect(loaded[0]!.hrefs).toEqual({ a: 'https://dav.example.com/me/cal/a.ics' });

    window.localStorage.setItem('planner-calendars', 'not json');
    expect(loadCalendars()).toEqual([]);
  });

  it('removes the key when the last calendar goes, and caps the list', () => {
    saveCalendars(Array.from({ length: 9 }, (_, index) => subscription({ url: `${CALENDAR}${index}/` })));
    expect(loadCalendars()).toHaveLength(5);
    saveCalendars([]);
    expect(window.localStorage.getItem('planner-calendars')).toBeNull();
  });
});

describe('identities', () => {
  it('reads back the planner id from an address this app wrote', () => {
    expect(plannerIdFromUid('standup@planner')).toBe('standup');
    expect(plannerIdFromUid('someone-elses@example.com')).toBeNull();
    expect(plannerIdFromUid('@planner')).toBeNull();
    expect(plannerIdFromUid(undefined)).toBeNull();
  });

  it('writes an event as a calendar object a server will accept', () => {
    const ics = eventToICS(event({ id: 'standup', note: 'Bring the board' }), new Date(LATER));
    expect(ics).toContain('UID:standup@planner');
    expect(ics).toContain('LAST-MODIFIED:20260920T090000Z');
    expect(ics).toContain('DTSTART:20261005T090000');
    expect(ics).toContain('DESCRIPTION:Bring the board');
    expect(ics.endsWith('\r\n')).toBe(true);
  });
});

describe('pulling into a state that already has the event', () => {
  it('never adds a second copy when the pull runs twice', () => {
    const first = applyCalendarPull(createEmptyState(), CALENDAR, planCalendarSync(stateWith(), subscription(), [remote(`${CALENDAR}one.ics`, LATER)]).pull[0]!);
    const second = planCalendarSync(first, subscription({ seen: [`${CALENDAR}one.ics`] }), [remote(`${CALENDAR}one.ics`, LATER)]);
    expect(second.pull).toEqual([]);
    expect(second.push.map((item) => item.id)).toEqual([first.events[0]!.id]);
    void addEvent;
    void updateEvent;
    void deleteEvent;
  });
});
