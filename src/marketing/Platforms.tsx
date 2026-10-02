/**
 * "Get the app" — one card per kind of device, with the honest state of each.
 *
 * Nothing here invents a download: the installers come from the release page
 * this repository publishes, the Android card offers the APK until the store
 * listings are live (see downloads.ts), and the iPhone card points at the web
 * app installing to the home screen, because that is what works today.
 */
import { COPY, type CopyKey, type Lang } from './copy';
import { APP_STORE_URL, ANDROID_STORES, PLAY_STORE_URL, RELEASES_PAGE, SOURCE_PAGE, currentPlatform, type Platform } from './downloads';
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

function actionsFor(platform: Platform, c: Record<CopyKey, string>): Action[] {
  const releases = { label: c.platformsDownload, href: RELEASES_PAGE, external: true };
  const source = { label: c.platformsSource, href: SOURCE_PAGE, external: true };
  if (platform === 'ios') {
    return APP_STORE_URL
      ? [{ label: c.platformsAppStore, href: APP_STORE_URL, external: true }, { label: c.platformsWebInstead, href: '/app', external: false }]
      : [{ label: c.platformsWebInstead, href: '/app', external: false }, source];
  }
  if (platform === 'android') {
    const play = PLAY_STORE_URL ? [{ label: c.platformsPlayStore, href: PLAY_STORE_URL, external: true }] : [];
    return [...play, releases, source];
  }
  return [releases, source];
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
          {CARDS.map((card, index) => (
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
                {actionsFor(card.platform, c).map((action) => (
                  <a
                    key={action.label + action.href}
                    className="btn btn-outline btn-sm"
                    href={action.href}
                    {...(action.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                  >
                    {action.label}
                  </a>
                ))}
              </div>
              {card.platform === here ? <p className="platform-here">{c.platformsHere}</p> : null}
              {card.platform === 'android' && androidStores.length > 0 ? (
                <p className="platform-note platform-stores">
                  {c.platformsAlsoOn} {androidStores.map((store) => store.name).join(' · ')}
                </p>
              ) : null}
            </article>
          ))}
        </div>

        <p className="platforms-foot">{c.platformsFoot}</p>
      </div>
    </section>
  );
}
