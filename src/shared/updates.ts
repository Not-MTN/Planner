/**
 * "Is there a newer Planner than the one I am running?"
 *
 * The installed apps carry a copy of the planner inside them, so the service
 * worker update prompt the web app shows can never fire in a shell — the code
 * cannot change under it. The only honest thing to do is compare the version
 * this build was made from with the newest published release and, when the
 * release is newer, say so and offer the download.
 *
 * Everything here is deliberately quiet:
 *
 * - a failed check is not an error. No network, a blocked request, a rate
 *   limit, a malformed answer — all of them mean "we do not know", which is
 *   not something to interrupt anybody about. This app works offline; an
 *   update check that complains about the network when there is none would be
 *   worse than no check at all.
 * - the user is told once per version. Dismissing 1.2.0 keeps it quiet until
 *   1.3.0 exists, rather than on every launch.
 * - only a strictly newer release counts. A build made from a tag the release
 *   job has not published yet must not look like an update to itself.
 */

/** This build's version, defined by vite.config.ts from PLANNER_VERSION_NAME. */
declare const __APP_VERSION__: string;

export const RELEASES_API = 'https://api.github.com/repos/Not-MTN/Planner/releases/latest';
export const RELEASES_PAGE = 'https://github.com/Not-MTN/Planner/releases/latest';

/** Where "there is a newer version" was last dismissed. */
const DISMISSED_KEY = 'planner-update-dismissed';

/** `v1.2.3`, `1.2.3`, `1.2.3-beta.1` → `[1,2,3,'beta.1']`. Null if unusable. */
export function parseVersion(value: string | undefined | null): number[] | null {
  const cleaned = (value ?? '').trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const core = cleaned.split('+')[0];
  const [numbers, ...rest] = core.split('-');
  const parts = numbers.split('.');
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  const parsed = parts.map((part) => Number(part));
  // A hyphen means a pre-release, which sorts before the release it leads to:
  // 1.2.0-beta is older than 1.2.0, so it must not read as an update.
  return rest.length > 0 ? [...parsed, -1] : parsed;
}

/** Is `candidate` a newer release than `current`? False when either is unknown. */
export function isNewer(candidate: string | undefined | null, current: string | undefined | null): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) return false;
  const length = Math.max(next.length, now.length);
  for (let index = 0; index < length; index += 1) {
    // A missing part is zero: 1.2 and 1.2.0 are the same version.
    const a = next[index] ?? 0;
    const b = now[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

/** The version this build was made from. Empty when the build did not say. */
export function currentVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
}

/** The newest published release's version, or null when it cannot be read. */
export async function latestVersion(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
    // A draft or pre-release is not something to send people to.
    if (body.draft === true || body.prerelease === true) return null;
    if (typeof body.tag_name !== 'string') return null;
    return parseVersion(body.tag_name) ? body.tag_name.replace(/^v/i, '') : null;
  } catch {
    return null;
  }
}

/** The version the reader has already waved away, if any. */
export function dismissedVersion(storage: Pick<Storage, 'getItem'> = localStorage): string {
  try {
    return storage.getItem(DISMISSED_KEY) ?? '';
  } catch {
    return '';
  }
}

export function dismissVersion(version: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(DISMISSED_KEY, version);
  } catch {
    /* a browser that cannot remember is not a reason to fail */
  }
}

/**
 * The newer version to tell the user about, or null to stay silent.
 * Never throws: an update check that can break the app is not worth having.
 */
export type UpdateCheckResult =
  | { status: 'current'; version: null }
  | { status: 'available' | 'dismissed'; version: string }
  | { status: 'unavailable'; version: null };

/**
 * The richer result used by startup. Unlike `findUpdate`, it distinguishes a
 * quiet failed check from a confirmed up-to-date install, and keeps a
 * dismissed release identifiable without offering it again.
 */
export async function checkUpdate(options: { fetcher?: typeof fetch; storage?: Storage } = {}): Promise<UpdateCheckResult> {
  const current = currentVersion();
  if (!current) return { status: 'unavailable', version: null };

  const latest = await latestVersion(options.fetcher ?? fetch);
  if (!latest) return { status: 'unavailable', version: null };
  if (!isNewer(latest, current)) return { status: 'current', version: null };
  if (dismissedVersion(options.storage ?? localStorage) === latest) return { status: 'dismissed', version: latest };
  return { status: 'available', version: latest };
}

/**
 * The newer version to tell the user about, or null to stay silent.
 * Never throws: an update check that can break the app is not worth having.
 */
export async function findUpdate(options: { fetcher?: typeof fetch; storage?: Storage } = {}): Promise<string | null> {
  const result = await checkUpdate(options);
  return result.status === 'available' ? result.version : null;
}

// ── Packaged Android and Windows update feed ───────────────────────────────

export const UPDATE_MANIFEST_URL = 'https://github.com/Not-MTN/Planner/releases/latest/download/planner-update.json';
export const ANDROID_APPLICATION_ID = 'com.notmtn.planner';
export const WINDOWS_APP_ID = 'com.notmtn.planner';
export const ANDROID_APK_NAME = 'app-release.apk';
export const WINDOWS_INSTALLER_NAME = 'Planner-windows.exe';
const MAX_ANDROID_APK_BYTES = 512 * 1024 * 1024;
const MAX_WINDOWS_INSTALLER_BYTES = 1024 * 1024 * 1024;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface AndroidUpdateOffer {
  platform: 'android';
  version: string;
  applicationId: typeof ANDROID_APPLICATION_ID;
  versionCode: number;
  signingCertificateSha256: string;
  fileName: typeof ANDROID_APK_NAME;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string;
}

export interface WindowsUpdateOffer {
  platform: 'windows';
  version: string;
  appId: typeof WINDOWS_APP_ID;
  fileName: typeof WINDOWS_INSTALLER_NAME;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string;
}

export type UpdateOffer = AndroidUpdateOffer | WindowsUpdateOffer;
export type UpdateNotApplicableReason = 'store-managed' | 'signing-mismatch' | 'package-mismatch' | 'unsupported-platform';

export type PackagedUpdateCheckResult =
  | { status: 'current'; version: null; offer: null }
  | { status: 'available' | 'dismissed'; version: string; offer: UpdateOffer }
  | { status: 'unavailable'; version: null; offer: null }
  | { status: 'not-applicable'; version: null; offer: null; reason: UpdateNotApplicableReason };

export interface AndroidInstalledAppInfo {
  applicationId: string;
  versionName: string;
  versionCode: number;
  signingCertificateSha256: string | null;
  installerPackageName: string | null;
}

interface ParsedUpdateManifest {
  version: string;
  android: AndroidUpdateOffer;
  windows: WindowsUpdateOffer;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\s:]/g, '').toLowerCase();
  return SHA256.test(normalized) ? normalized : null;
}

function validAsset<TFileName extends string>(
  value: unknown,
  expectedFileName: TFileName,
  tag: string,
  maxBytes: number,
): { fileName: TFileName; downloadUrl: string; sizeBytes: number; sha256: string } | null {
  const asset = record(value);
  if (!asset || asset.fileName !== expectedFileName) return null;
  if (typeof asset.downloadUrl !== 'string') return null;
  let url: URL;
  try {
    url = new URL(asset.downloadUrl);
  } catch {
    return null;
  }
  const expectedPath = `/Not-MTN/Planner/releases/download/${tag}/${expectedFileName}`;
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname !== expectedPath || url.search || url.hash) return null;
  if (!Number.isSafeInteger(asset.sizeBytes) || (asset.sizeBytes as number) < 1 || (asset.sizeBytes as number) > maxBytes) return null;
  if (typeof asset.sha256 !== 'string' || !SHA256.test(asset.sha256.toLowerCase())) return null;
  return {
    fileName: expectedFileName,
    downloadUrl: url.toString(),
    sizeBytes: asset.sizeBytes as number,
    sha256: asset.sha256.toLowerCase(),
  };
}

/**
 * Validate the versioned feed before trusting an asset URL or starting a
 * download. A release-page response is public input, even though it arrived
 * over HTTPS.
 */
export function parseUpdateManifest(value: unknown): ParsedUpdateManifest | null {
  const manifest = record(value);
  if (!manifest || manifest.schemaVersion !== 1 || manifest.product !== 'Planner') return null;
  if (typeof manifest.version !== 'string' || !STABLE_VERSION.test(manifest.version)) return null;
  const tag = `v${manifest.version}`;
  if (manifest.tag !== tag) return null;
  const platforms = record(manifest.platforms);
  const android = record(platforms?.android);
  const windows = record(platforms?.windows);
  if (!android || !windows) return null;
  if (android.channel !== 'direct-apk' || android.applicationId !== ANDROID_APPLICATION_ID || android.versionName !== manifest.version) return null;
  if (!Number.isSafeInteger(android.versionCode) || (android.versionCode as number) < 1 || (android.versionCode as number) > 2_100_000_000) return null;
  const signer = normalizeFingerprint(android.signingCertificateSha256);
  const androidAsset = validAsset(android.asset, ANDROID_APK_NAME, tag, MAX_ANDROID_APK_BYTES);
  if (!signer || !androidAsset) return null;
  if (windows.appId !== WINDOWS_APP_ID || windows.version !== manifest.version) return null;
  const windowsInstaller = validAsset(windows.installer, WINDOWS_INSTALLER_NAME, tag, MAX_WINDOWS_INSTALLER_BYTES);
  if (!windowsInstaller) return null;

  return {
    version: manifest.version,
    android: {
      platform: 'android',
      version: manifest.version,
      applicationId: ANDROID_APPLICATION_ID,
      versionCode: android.versionCode as number,
      signingCertificateSha256: signer,
      ...androidAsset,
    },
    windows: {
      platform: 'windows',
      version: manifest.version,
      appId: WINDOWS_APP_ID,
      ...windowsInstaller,
    },
  };
}

export interface PackagedUpdateCheckOptions {
  platform: 'android' | 'windows';
  installedVersion: string;
  installedAndroid?: AndroidInstalledAppInfo;
  manifest: unknown;
  storage?: Storage;
  /** An explicit user check should be able to find a release they dismissed earlier. */
  ignoreDismissal?: boolean;
}

/** Compare a validated release feed against the actual installed app identity. */
export function checkUpdateFromManifest(options: PackagedUpdateCheckOptions): PackagedUpdateCheckResult {
  const manifest = parseUpdateManifest(options.manifest);
  if (!manifest) return { status: 'unavailable', version: null, offer: null };

  let offer: UpdateOffer;
  if (options.platform === 'android') {
    const installed = options.installedAndroid;
    if (!installed) return { status: 'unavailable', version: null, offer: null };
    if (installed.installerPackageName === 'com.android.vending') {
      return { status: 'not-applicable', version: null, offer: null, reason: 'store-managed' };
    }
    if (installed.applicationId !== ANDROID_APPLICATION_ID) {
      return { status: 'not-applicable', version: null, offer: null, reason: 'package-mismatch' };
    }
    const installedSigner = normalizeFingerprint(installed.signingCertificateSha256);
    if (!installedSigner || installedSigner !== manifest.android.signingCertificateSha256) {
      return { status: 'not-applicable', version: null, offer: null, reason: 'signing-mismatch' };
    }
    if (!isNewer(manifest.version, installed.versionName)) {
      if (manifest.version === installed.versionName && manifest.android.versionCode === installed.versionCode) {
        return { status: 'current', version: null, offer: null };
      }
      // A feed that regresses either Android's semver or its monotonically
      // increasing package versionCode is malformed; do not offer it.
      return { status: 'unavailable', version: null, offer: null };
    }
    if (manifest.android.versionCode <= installed.versionCode) return { status: 'unavailable', version: null, offer: null };
    offer = manifest.android;
  } else {
    if (!isNewer(manifest.version, options.installedVersion)) {
      return manifest.version === options.installedVersion
        ? { status: 'current', version: null, offer: null }
        : { status: 'unavailable', version: null, offer: null };
    }
    offer = manifest.windows;
  }

  const storage = options.storage ?? localStorage;
  if (!options.ignoreDismissal && dismissedVersion(storage) === offer.version) {
    return { status: 'dismissed', version: offer.version, offer };
  }
  return { status: 'available', version: offer.version, offer };
}
