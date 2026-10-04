import { shellPlatform } from './nativeShell';
import {
  checkUpdateFromManifest,
  type AndroidInstalledAppInfo,
  type AndroidUpdateOffer,
  type PackagedUpdateCheckResult,
  type UpdateOffer,
  type WindowsUpdateOffer,
} from './updates';

interface ProgressEvent {
  bytesReceived: number;
  totalBytes: number;
}

interface NativeUpdateRequest {
  applicationId: string;
  version: string;
  versionCode: number;
  signingCertificateSha256: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string;
}

interface AndroidUpdaterPlugin {
  getInstallInfo(): Promise<AndroidInstalledAppInfo>;
  getUpdateManifest(): Promise<{ manifest: string }>;
  downloadUpdate(options: NativeUpdateRequest): Promise<{ ready: boolean }>;
  installUpdate(options: NativeUpdateRequest): Promise<{ installed: boolean; versionCode?: number }>;
  addListener(
    eventName: 'downloadProgress',
    listener: (event: ProgressEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

interface DesktopUpdaterBridge {
  platform: string;
  version: () => Promise<string>;
  getUpdateManifest: () => Promise<unknown>;
  downloadUpdate: (offer: WindowsUpdateOffer) => Promise<{ ready: boolean }>;
  installUpdate: (offer: WindowsUpdateOffer) => Promise<{ started: boolean }>;
  onUpdateProgress: (listener: (event: ProgressEvent) => void) => () => void;
}

function desktopBridge(): DesktopUpdaterBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { plannerDesktop?: DesktopUpdaterBridge }).plannerDesktop ?? null;
}

let nativeUpdaterPromise: Promise<AndroidUpdaterPlugin> | null = null;

async function androidUpdater(): Promise<AndroidUpdaterPlugin> {
  nativeUpdaterPromise ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<AndroidUpdaterPlugin>('PlannerUpdater'),
  );
  return nativeUpdaterPromise;
}

function parseNativeManifest(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return JSON.parse(value) as unknown;
}

/** True only for platforms with an implemented, data-preserving updater. */
export function supportsPackagedUpdates(): boolean {
  const platform = shellPlatform();
  if (platform === 'android') return true;
  if (platform === 'desktop') return desktopBridge()?.platform === 'win32';
  return false;
}

/**
 * Read the stable update feed through the platform's privileged network path,
 * then compare it with the actual installed package identity. Android and
 * Windows perform their own checks; no update service can block planner boot.
 */
export async function checkPackagedUpdate(options: { ignoreDismissal?: boolean } = {}): Promise<PackagedUpdateCheckResult> {
  try {
    const platform = shellPlatform();
    if (platform === 'android') {
      const updater = await androidUpdater();
      const [installedAndroid, response] = await Promise.all([
        updater.getInstallInfo(),
        updater.getUpdateManifest(),
      ]);
      return checkUpdateFromManifest({
        platform: 'android',
        installedVersion: installedAndroid.versionName,
        installedAndroid,
        manifest: parseNativeManifest(response.manifest),
        ignoreDismissal: options.ignoreDismissal,
      });
    }

    if (platform === 'desktop') {
      const desktop = desktopBridge();
      if (!desktop || desktop.platform !== 'win32') {
        return { status: 'not-applicable', version: null, offer: null, reason: 'unsupported-platform' };
      }
      const [installedVersion, manifest] = await Promise.all([
        desktop.version(),
        desktop.getUpdateManifest(),
      ]);
      return checkUpdateFromManifest({ platform: 'windows', installedVersion, manifest, ignoreDismissal: options.ignoreDismissal });
    }

    return { status: 'not-applicable', version: null, offer: null, reason: 'unsupported-platform' };
  } catch {
    // Offline, blocked or malformed feed: keep using the installed planner.
    return { status: 'unavailable', version: null, offer: null };
  }
}

function nativeRequest(offer: AndroidUpdateOffer): NativeUpdateRequest {
  return {
    applicationId: offer.applicationId,
    version: offer.version,
    versionCode: offer.versionCode,
    signingCertificateSha256: offer.signingCertificateSha256,
    fileName: offer.fileName,
    downloadUrl: offer.downloadUrl,
    sizeBytes: offer.sizeBytes,
    sha256: offer.sha256,
  };
}

/** Download and verify the exact asset named by the validated release feed. */
export async function downloadPackagedUpdate(
  offer: UpdateOffer,
  onProgress: (progress: ProgressEvent) => void,
): Promise<void> {
  if (offer.platform === 'android') {
    if (shellPlatform() !== 'android') throw new Error('This update is not for the installed platform.');
    const updater = await androidUpdater();
    const listener = await updater.addListener('downloadProgress', onProgress);
    try {
      const result = await updater.downloadUpdate(nativeRequest(offer));
      if (!result.ready) throw new Error('The update download could not be verified.');
    } finally {
      await listener.remove();
    }
    return;
  }

  const desktop = desktopBridge();
  if (shellPlatform() !== 'desktop' || desktop?.platform !== 'win32') {
    throw new Error('This update is not for the installed platform.');
  }
  const removeListener = desktop.onUpdateProgress(onProgress);
  try {
    const result = await desktop.downloadUpdate(offer);
    if (!result.ready) throw new Error('The update download could not be verified.');
  } finally {
    removeListener();
  }
}

/** Apply an already-downloaded update; the native installer preserves app data. */
export async function applyPackagedUpdate(offer: UpdateOffer): Promise<void> {
  if (offer.platform === 'android') {
    if (shellPlatform() !== 'android') throw new Error('This update is not for the installed platform.');
    const updater = await androidUpdater();
    const result = await updater.installUpdate(nativeRequest(offer));
    if (!result.installed) throw new Error('The Android installer did not confirm the update.');
    return;
  }

  const desktop = desktopBridge();
  if (shellPlatform() !== 'desktop' || desktop?.platform !== 'win32') {
    throw new Error('This update is not for the installed platform.');
  }
  const result = await desktop.installUpdate(offer as WindowsUpdateOffer);
  if (!result.started) throw new Error('The Windows installer could not be started.');
}
