// @vitest-environment jsdom
/**
 * A link that opens the app.
 *
 * The address a guardian's QR code carries is an ordinary web address, so the
 * same string has two jobs: it has to be safe to *not* act on (any other page
 * on the domain is not a route), and it has to be exact when it is acted on
 * (the code inside it survives the trip, and nothing else is picked up).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deepLinkRoute, installDeepLinkHandler } from './deepLinks';

const CODE = 'plnr-abcd-efgh-ijkl';

const capacitor = vi.hoisted(() => ({
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: capacitor.addListener,
    getLaunchUrl: capacitor.getLaunchUrl,
  },
}));

type ShellWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
const shell = window as ShellWindow;

beforeEach(() => {
  capacitor.addListener.mockReset().mockResolvedValue({ remove: capacitor.remove });
  capacitor.getLaunchUrl.mockReset().mockResolvedValue(undefined);
  capacitor.remove.mockReset();
  shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
});

afterEach(() => {
  delete shell.Capacitor;
});

describe('an address that asks the app to open something', () => {
  it('reads an invite out of the link that a QR code carries', () => {
    expect(deepLinkRoute(`https://planner.example/#/panels?invite=${CODE}`)).toEqual({ name: 'panels', invite: CODE });
  });

  it('accepts the same link at /app, the address the planner is served from', () => {
    expect(deepLinkRoute(`https://planner.example/app#/panels?invite=${CODE}`)).toEqual({ name: 'panels', invite: CODE });
  });

  it('reads the custom scheme, in both spellings', () => {
    expect(deepLinkRoute(`planner://panels?invite=${CODE}`)).toEqual({ name: 'panels', invite: CODE });
    expect(deepLinkRoute(`planner:///student`)).toEqual({ name: 'student' });
  });

  it('follows an ordinary route, so a shared bookmark opens where it points', () => {
    expect(deepLinkRoute('https://planner.example/#/habits')).toEqual({ name: 'habits' });
  });

  it('stays out of the way of addresses that are not the app', () => {
    // The landing page, a marketing anchor, a page on the same domain, a
    // half-typed address: none of these is a route to be followed.
    expect(deepLinkRoute('https://planner.example/')).toBeNull();
    expect(deepLinkRoute('https://planner.example/#apps')).toBeNull();
    expect(deepLinkRoute('https://planner.example/#/not-a-route')).toBeNull();
    expect(deepLinkRoute('https://planner.example/blog#/today')).toBeNull();
    expect(deepLinkRoute('mailto:someone@example.com')).toBeNull();
    expect(deepLinkRoute('not a url')).toBeNull();
    expect(deepLinkRoute('')).toBeNull();
  });

  it('does not treat another app’s scheme as its own', () => {
    expect(deepLinkRoute('other://panels?invite=x')).toBeNull();
  });
});

describe('living with the shell', () => {
  it('does nothing in a browser tab', async () => {
    delete shell.Capacitor;
    const go = vi.fn();
    const stop = await installDeepLinkHandler({ go });
    expect(capacitor.addListener).not.toHaveBeenCalled();
    expect(typeof stop).toBe('function');
  });

  it('hands a link that arrives while the app runs to the router', async () => {
    const go = vi.fn();
    await installDeepLinkHandler({ go });
    expect(capacitor.addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));

    const handler = capacitor.addListener.mock.calls[0][1] as (event: { url: string }) => void;
    handler({ url: `https://planner.example/#/panels?invite=${CODE}` });
    expect(go).toHaveBeenCalledWith({ name: 'panels', invite: CODE });
  });

  it('reads the link that started the app, which arrives before any listener exists', async () => {
    capacitor.getLaunchUrl.mockResolvedValue({ url: `planner://panels?invite=${CODE}` });
    const go = vi.fn();
    await installDeepLinkHandler({ go });
    expect(go).toHaveBeenCalledWith({ name: 'panels', invite: CODE });
  });

  it('ignores a link it cannot use, and removes the listener on the way out', async () => {
    const go = vi.fn();
    const stop = await installDeepLinkHandler({ go });
    const handler = capacitor.addListener.mock.calls[0][1] as (event: { url: string }) => void;
    handler({ url: 'https://planner.example/' });
    expect(go).not.toHaveBeenCalled();

    stop();
    expect(capacitor.remove).toHaveBeenCalled();
  });

  it('keeps a link that arrives while the app is already open', async () => {
    const go = vi.fn();
    await installDeepLinkHandler({ go });
    const handler = capacitor.addListener.mock.calls[0][1] as (event: { url: string }) => void;
    handler({ url: 'planner://student' });
    handler({ url: 'planner://guardian' });
    expect(go.mock.calls.map(([route]) => route.name)).toEqual(['student', 'guardian']);
  });
});
