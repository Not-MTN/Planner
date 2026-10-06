// @vitest-environment node
/**
 * A scanned invite is the one route that carries something with it: the code.
 * These checks are about that ride — that a code survives the trip through a
 * link, that it is taken back out of the address once it has been read, and
 * that the link we hand to a camera is one our own encoder can draw.
 */
import { describe, expect, it } from 'vitest';
import { appRouteFromHash, parseHash, toHash, inviteHash, inviteLink } from './route';
import { todayISO } from './dates';
import { encodeQr } from './qr';

const CODE = 'plnr-abcd-efgh-ijkl';

describe('an invite that arrives as a link', () => {
  it('carries the code through to the panels route', () => {
    expect(parseHash(inviteHash(CODE))).toEqual({ name: 'panels', invite: CODE });
  });

  it('leaves the route alone when there is no code', () => {
    expect(parseHash('#/panels')).toEqual({ name: 'panels' });
  });

  it('keeps other query parts from being read as the code', () => {
    expect(parseHash('#/panels?x=1')).toEqual({ name: 'panels' });
    const withCode = parseHash('#/panels?x=1&invite=plnr-abcd-efgh-ijkl');
    expect(withCode.name === 'panels' ? withCode.invite : undefined).toBe(CODE);
  });

  it('survives the address, so what is written is what comes back', () => {
    expect(toHash(parseHash(inviteHash(CODE)))).toBe(inviteHash(CODE));
  });

  it('drops the code from the address once the route is written back plain', () => {
    expect(toHash({ name: 'panels' })).toBe('#/panels');
  });
});

describe('telling an address that belongs to the app from one that does not', () => {
  it('answers with the route for every destination the app has', () => {
    expect(appRouteFromHash('#/today')).toEqual({ name: 'today' });
    expect(appRouteFromHash('#/habits')).toEqual({ name: 'habits' });
    expect(appRouteFromHash('#/ai/review')).toEqual({ name: 'ai', tab: 'review' });
    expect(appRouteFromHash('#/calendar/month/2026-10-01')).toEqual({ name: 'calendar', tab: 'month', date: '2026-10-01' });
    // The old names still count: a bookmark from an earlier version is a link
    // the app should follow, not a page it should leave to the website.
    expect(appRouteFromHash('#/progress')).toEqual({ name: 'insights' });
    expect(appRouteFromHash('#/future')).toEqual({ name: 'calendar', tab: 'agenda', date: todayISO() });
  });

  it('says no to everything else, rather than quietly answering "today"', () => {
    expect(appRouteFromHash('')).toBeNull();
    expect(appRouteFromHash('#')).toBeNull();
    expect(appRouteFromHash('#/')).toBeNull();
    expect(appRouteFromHash('#apps')).toBeNull();
    expect(appRouteFromHash('#/not-a-route')).toBeNull();
  });
});

describe('the link handed to a camera', () => {
  it('points at whichever copy of the app shows it', () => {
    expect(inviteLink(CODE, 'https://planner.example')).toBe(`https://planner.example/${inviteHash(CODE)}`);
    // A trailing slash must not become two.
    expect(inviteLink(CODE, 'https://planner.example/')).toBe(`https://planner.example/${inviteHash(CODE)}`);
  });

  it('fits in a symbol even behind a long address', () => {
    const long = inviteLink(CODE, 'https://planner-abcdefghijklmnop-1234.e2b.app');
    const symbol = encodeQr(long);
    expect(symbol.size).toBeLessThanOrEqual(45);
  });
});
