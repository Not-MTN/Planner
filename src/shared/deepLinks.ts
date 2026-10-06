/**
 * Links that open the installed app.
 *
 * A guardian hands a student a QR code whose payload is an ordinary web
 * address — `https://your-app.example.com/#/panels?invite=plnr-…` — because
 * that link has to work for someone who has not installed anything yet. When
 * the app *is* installed, the same link should open it. Two mechanisms do that,
 * and they need nothing from this module to be configured in advance:
 *
 *   https App Links / Universal Links
 *     Android and iOS check `/.well-known/assetlinks.json` and
 *     `/.well-known/apple-app-site-association` on the link's domain, find this
 *     app named there, and hand the whole address over. The address is delivered
 *     while the app runs (`appUrlOpen`), or, when the link is what started the
 *     app, before any of this code has run (`getLaunchUrl`).
 *
 *   planner://
 *     A custom scheme, for a build with no domain of its own — an offline copy
 *     served from the device. Nothing to verify, and nothing to configure.
 *
 * What both have in common is that the link is a *route*: the app is already
 * showing something, and this says show something else. So the work here is to
 * turn a delivered address into a route and let the ordinary hash router do the
 * rest. Nothing is granted by arriving this way — an invite code merely fills a
 * field the student still has to confirm.
 */
import { appRouteFromHash, toHash, type Route } from '../route';
import { isNativeShell, shellPlatform } from './nativeShell';

/**
 * The scheme this app answers to on its own, without a domain or a server.
 * The `.invalid` top level domain in the Android filter is intentional: it can
 * never resolve, so an unconfigured build is simply never chosen.
 */
export const DEEP_LINK_SCHEME = 'planner';

/**
 * The route an address asks for, or null when it asks for nothing of ours.
 *
 * Deliberately narrow. `planner://panels?invite=…` and the app's own https
 * addresses are links to this app; every other address on the same domain
 * (the marketing site, a note someone shared, a typo) is not, and must not
 * drag an open planner somewhere it did not ask to go.
 */
export function deepLinkRoute(raw: string): Route | null {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }

  if (url.protocol === `${DEEP_LINK_SCHEME}:`) {
    // planner://panels?invite=X and planner:///panels?invite=X are the same
    // request; the scheme swallows the slashes differently in each.
    const path = `${url.hostname}${url.pathname}`.replace(/\/+$/, '');
    if (!path) return null;
    return appRouteFromHash(`#/${path}${url.search}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // Only the two addresses the app is served from. A link may point at "/" (the
  // website's address, which is what goes in a QR code) or at "/app".
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && path !== '/app') return null;
  return appRouteFromHash(url.hash);
}

export interface DeepLinkOptions {
  /** What to do with a route a link asked for. The shell's own router by default. */
  go?: (route: Route) => void;
}

/**
 * Listen for links while the app runs, and read the one that launched it.
 *
 * Returns the undo function, so tests and a hot-reloaded page do not stack
 * listeners. Nothing here runs in a browser tab: a plain page never receives
 * `appUrlOpen`, and a custom scheme in a browser is just another URL.
 */
export async function installDeepLinkHandler(options: DeepLinkOptions = {}): Promise<() => void> {
  const go = options.go ?? ((route: Route) => { window.location.hash = toHash(route); });
  if (!isNativeShell() || shellPlatform() === 'desktop') return () => undefined;

  let App: typeof import('@capacitor/app').App;
  try {
    ({ App } = await import('@capacitor/app'));
  } catch {
    return () => undefined;
  }

  const handle = (url: string | null | undefined) => {
    if (!url) return;
    const route = deepLinkRoute(url);
    if (route) go(route);
  };

  // Subscribed before the launch address is read: a link that arrives while the
  // app is opening is the one case where the two can be the same event, and the
  // listener has to exist first or the route is lost.
  const listener = await App.addListener('appUrlOpen', ({ url }) => handle(url));
  const launch = await App.getLaunchUrl().catch(() => undefined);
  handle(launch?.url);

  return () => {
    void listener.remove();
  };
}
