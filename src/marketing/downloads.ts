/**
 * Where each kind of device gets Planner.
 *
 * The installers and app bundles are real: every release attaches them (see
 * .github/workflows/apps.yml), so `RELEASES_PAGE` always has the newest
 * Windows, macOS and Linux builds, and the Android APK.
 *
 * Store listings are not live yet. Their constants below stay empty and the
 * page says so, rather than pointing at a page that does not exist — fill one
 * in when the listing is published and that platform starts offering it.
 * The web app is the fallback everywhere; it needs no listing at all.
 */

export const RELEASES_PAGE = 'https://github.com/Not-MTN/Planner/releases/latest';
export const SOURCE_PAGE = 'https://github.com/Not-MTN/Planner';

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

/**
 * The platform this browser is running on, as far as it can be told. Only ever
 * used to highlight the reader's own card — never to hide the others.
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
