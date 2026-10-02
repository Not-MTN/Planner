/**
 * "Get the app" — one card per kind of device, with the honest state of each.
 *
 * Clicking a download here saves the file: the link is the release asset
 * itself (see downloads.ts), so nobody has to find the right file on a release
 * page. The iPhone card offers the web app instead, because the only iOS build
 * that exists is unsigned and would not install on anyone's phone.
 */
import { COPY, type CopyKey, type Lang } from './copy';
import {
  APP_STORE_URL,
  ANDROID_STORES,
  PLAY_STORE_URL,
  RELEASES_PAGE,
  SOURCE_PAGE,
  currentPlatform,
  downloadsFor,
  type Download,
  type Platform,
} from './downloads';
import { pointerLeave, pointerMove } from './effects';

const SPOT = {
  onMouseMove: (event: React.MouseEvent<HTMLElement>) => pointerMove(event, { tilt: 2 }),
  onMouseLeave: pointerLeave,
};

type Action = { label: string; href: string; external: boolean };

interface Card {
  platform: Platform;
  icon: string;
  titleKey: CopyKey;
  noteKey: CopyKey;
}

const CARDS: Card[] = [
  { platform: 'ios', icon: '', titleKey: 'platformsIphone', noteKey: 'platformsIphoneNote' },
  { platform: 'android', icon: '', titleKey: 'platformsAndroid', noteKey: 'platformsAndroidNote' },
  { platform: 'windows', icon: '🪟', titleKey: 'platformsWindows', noteKey: 'platformsWindowsNote' },
  { platform: 'macos', icon: '🍎', titleKey: 'platformsMac', noteKey: 'platformsMacNote' },
  { platform: 'linux', icon: '🐧', titleKey: 'platformsLinux', noteKey: 'platformsLinuxNote' },
];

/**
 * The buttons under a card: the downloads this platform really has, then the
 * always-available ways to get it. Nothing appears here that does not work —
 * `downloadsFor` returns an empty list rather than a link to a guess.
 */
function actionsFor(platform: Platform, c: Record<CopyKey, string>): { downloads: Download[]; actions: Action[] } {
  const downloads = downloadsFor(platform);
  const releases = { label: c.platformsAllReleases, href: RELEASES_PAGE, external: true };
  const source = { label: c.platformsSource, href: SOURCE_PAGE, external: true };
  if (platform === 'ios') {
    const webApp = { label: c.platformsWebInstead, href: '/app', external: false };
    return APP_STORE_URL
      ? { downloads, actions: [{ label: c.platformsAppStore, href: APP_STORE_URL, external: true }, webApp] }
      : { downloads, actions: [webApp, source] };
  }
  if (platform === 'android') {
    const play = PLAY_STORE_URL ? [{ label: c.platformsPlayStore, href: PLAY_STORE_URL, external: true }] : [];
    return { downloads, actions: [...play, releases, source] };
  }
  // Downloads are the point of these cards, so the releases page is only a
  // footnote: everything on it is reachable from the buttons above.
  return { downloads, actions: [releases, source] };
}

export function Platforms({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const here = currentPlatform();
  const androidStores = ANDROID_STORES.filter((store) => store.url);

  return (
    <section className="section" id="apps">
      <div className="wrap">
        <header className="section-head center reveal" data-reveal>
          <p className="kicker">{c.platformsKicker}</p>
          <h2>{c.platformsTitle}</h2>
          <p className="lede">{c.platformsSub}</p>
        </header>

        <div className="platforms">
          {CARDS.map((card, index) => {
            const { downloads, actions } = actionsFor(card.platform, c);
            return (
              <article
                key={card.platform}
                className={`platform-card spot reveal ${card.platform === here ? 'is-here' : ''}`}
                data-reveal
                style={{ transitionDelay: `${index * 70}ms` }}
                {...SPOT}
              >
                <span className="platform-icon" aria-hidden="true">
                  {card.icon}
                </span>
                <h3>{c[card.titleKey]}</h3>
                <p className="platform-note">{c[card.noteKey]}</p>
                <div className="platform-actions">
                  {downloads.map((item) => (
                    <a
                      key={item.file}
                      className={`btn btn-sm ${item.primary ? 'btn-primary' : 'btn-outline'}`}
                      href={item.url}
                      // A cross-origin link: the file is served by GitHub with
                      // `Content-Disposition: attachment`, so it saves rather
                      // than navigating. `download` would be ignored here.
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c[item.labelKey]}
                    </a>
                  ))}
                </div>
                {actions.length > 0 ? (
                  <div className="platform-actions platform-actions-quiet">
                    {actions.map((action) => (
                      <a
                        key={action.label + action.href}
                        className="btn btn-quiet btn-sm"
                        href={action.href}
                        {...(action.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                      >
                        {action.label}
                      </a>
                    ))}
                  </div>
                ) : null}
                {card.platform === here ? <p className="platform-here">{c.platformsHere}</p> : null}
                {card.platform === 'android' && androidStores.length > 0 ? (
                  <p className="platform-note platform-stores">
                    {c.platformsAlsoOn} {androidStores.map((store) => store.name).join(' · ')}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>

        <p className="platforms-foot">{c.platformsFoot}</p>
        {CARDS.some((card) => downloadsFor(card.platform).length > 0) ? (
          <p className="platforms-foot platforms-foot-quiet">{c.platformsDownloadFoot}</p>
        ) : null}
      </div>
    </section>
  );
}
