/**
 * Where each kind of device gets Planner, and the file it comes from.
 *
 * People download from this website: the buttons in `Platforms.tsx` point
 * straight at the installers, so a click saves the file instead of sending the
 * reader off to a page of links.
 *
 * The bytes still live on GitHub Releases (they are 100–200 MB each, far too
 * large to ship inside the deployment), and the URL is the one GitHub keeps for
 * "the newest release that has this file":
 *
 *     https://github.com/Not-MTN/Planner/releases/latest/download/<file>
 *
 * That URL is written once and works for every future release — but only while
 * `file` never changes. So the build names its artifacts without a version
 * number in them (desktop/electron-builder.yml, and the Gradle/collect steps in
 * .github/workflows/apps.yml), and `npm run check:downloads` asks the live
 * release whether every name below still exists. Rename an artifact and that
 * check fails here, before a visitor finds a dead button.
 *
 * Store listings are not live yet. Their constants stay empty and the page says
 * so, rather than pointing at a listing that does not exist — fill one in when
 * it is published and that platform starts offering it. The web app is the
 * fallback everywhere; it needs no listing at all.
 */
import type { CopyKey } from './copy';

export const RELEASES_PAGE = 'https://github.com/Not-MTN/Planner/releases/latest';
export const SOURCE_PAGE = 'https://github.com/Not-MTN/Planner';
export const RELEASE_DOWNLOAD_BASE = 'https://github.com/Not-MTN/Planner/releases/latest/download';

/** App Store (iOS, iPadOS). */
export const APP_STORE_URL = '';
/** Google Play. */
export const PLAY_STORE_URL = '';
/** Xiaomi GetApps — one listing reaches most Xiaomi, Redmi and POCO phones. */
export const XIAOMI_STORE_URL = '';
/** Samsung Galaxy Store. */
export const SAMSUNG_STORE_URL = '';
/** Huawei AppGallery — for Huawei and Honor phones with no Play services. */
export const HUAWEI_STORE_URL = '';

export type Platform = 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'other';

export interface Download {
  /** The exact asset name in the release. `npm run check:downloads` checks it. */
  file: string;
  /** Built from the file name, so the two can never drift apart. */
  url: string;
  labelKey: CopyKey;
  /** The one to offer first on this platform; rendered as the solid button. */
  primary?: boolean;
}

function download(file: string, labelKey: CopyKey, primary = false): Download {
  return { file, url: `${RELEASE_DOWNLOAD_BASE}/${file}`, labelKey, primary };
}

/**
 * The files each platform can download.
 *
 * Windows is one installer for both architectures — electron-builder only
 * builds a separate installer per architecture when the artifact name asks for
 * one, and a visitor has no reliable way to know which PC they are on.
 *
 * macOS cannot be solved that way: an Apple-silicon Mac runs an Intel build
 * only through Rosetta, and an Intel Mac cannot run an Apple-silicon build at
 * all, so guessing wrong is worse than asking. Both are offered, named after
 * the chip, and neither is hidden.
 */
export const DOWNLOADS: Record<'android' | 'windows' | 'macos' | 'linux', Download[]> = {
  android: [download('app-release.apk', 'platformsDownloadApk', true)],
  windows: [download('Planner-windows.exe', 'platformsDownloadWindows', true)],
  macos: [
    download('Planner-macos-arm64.dmg', 'platformsDownloadMacArm', true),
    download('Planner-macos-x64.dmg', 'platformsDownloadMacIntel'),
  ],
  linux: [
    download('Planner-linux-x86_64.AppImage', 'platformsDownloadLinuxAppImage', true),
    download('Planner-linux-amd64.deb', 'platformsDownloadLinuxDeb'),
    download('Planner-linux-x86_64.rpm', 'platformsDownloadLinuxRpm'),
    download('Planner-linux-arm64.AppImage', 'platformsDownloadLinuxArmImage'),
    download('Planner-linux-arm64.deb', 'platformsDownloadLinuxArmDeb'),
  ],
};

/** The downloads for a platform, in the order they should be offered. */
export function downloadsFor(platform: Platform): Download[] {
  if (platform === 'android' || platform === 'windows' || platform === 'macos' || platform === 'linux') {
    return DOWNLOADS[platform];
  }
  // iOS has no downloadable build yet: the archive CI produces is unsigned and
  // cannot be installed by anyone, so that card offers the web app instead.
  return [];
}

export interface DeviceInstallAction {
  href: string;
  labelKey: CopyKey;
  /** External release assets open separately; an in-page choice stays here. */
  external: boolean;
}

/**
 * The landing-page action for the device someone is using. Only send them
 * straight to a file when there is a single safe choice: Android's universal
 * APK or the Windows installer. macOS/Linux have architecture-specific builds,
 * and iOS uses the web app, so those visitors go to the platform cards to choose
 * the right install method instead of receiving a guessed, possibly unusable
 * file.
 */
export function deviceInstallActionFor(platform: Platform): DeviceInstallAction {
  if (platform === 'android' || platform === 'windows') {
    const item = DOWNLOADS[platform].find((download) => download.primary);
    if (item) return { href: item.url, labelKey: item.labelKey, external: true };
  }
  return { href: '#apps', labelKey: 'platformsSeeOptions', external: false };
}

/**
 * The platform this browser is running on, as far as it can be told. Used to
 * highlight the reader's card and choose a safe hero action — never to hide
 * other platform options.
 */
export function detectPlatform(userAgent: string | undefined): Platform {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return 'other';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  if (/macintosh/.test(ua) && /mobile/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/windows/.test(ua)) return 'windows';
  if (/mac os x|macintosh/.test(ua)) return 'macos';
  if (/linux|x11|cros/.test(ua)) return 'linux';
  return 'other';
}

/** The current platform, or `other` outside a browser. */
export function currentPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  return detectPlatform(navigator.userAgent);
}

/** Android stores other than Google Play, in the order they are offered. */
export const ANDROID_STORES: { name: string; url: string }[] = [
  { name: 'Google Play', url: PLAY_STORE_URL },
  { name: 'Xiaomi GetApps', url: XIAOMI_STORE_URL },
  { name: 'Samsung Galaxy Store', url: SAMSUNG_STORE_URL },
  { name: 'Huawei AppGallery', url: HUAWEI_STORE_URL },
];

/** Is any store listing published yet? Drives the "coming soon" wording. */
export function anyStoreListingLive(): boolean {
  return Boolean(APP_STORE_URL || PLAY_STORE_URL || XIAOMI_STORE_URL || SAMSUNG_STORE_URL || HUAWEI_STORE_URL);
}
