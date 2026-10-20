import { shellPlatform } from './nativeShell';
import {
  checkUpdateFromManifest,
  type AndroidInstalledAppInfo,
  type AndroidUpdateOffer,
  type PackagedUpdateCheckResult,
  type UpdateOffer,
  type WindowsUpdateOffer,
} from './updates';

export interface ProgressEvent {
  bytesReceived: number;
  totalBytes: number;
  speedBps?: number | null;
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
  downloadUpdate: (offer: WindowsUpdateOffer) => Promise<{ ready: boolean; resumed?: boolean; paused?: boolean; canceled?: boolean }>;
  installUpdate: (offer: WindowsUpdateOffer) => Promise<{ started: boolean }>;
  pauseUpdate: () => Promise<{ paused: boolean }>;
  resumeUpdate: () => Promise<{ resumed: boolean }>;
  cancelUpdate: () => Promise<{ canceled: boolean }>;
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

/** How long a packaged check may block boot — after this we are offline/unavailable and the planner opens. */
const CHECK_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Read the stable update feed through the platform's privileged network path,
 * then compare it with the actual installed package identity. Android and
 * Windows perform their own checks; no update service can block planner boot.
 */
export async function checkPackagedUpdate(options: { ignoreDismissal?: boolean } = {}): Promise<PackagedUpdateCheckResult> {
  const unavailable: PackagedUpdateCheckResult = { status: 'unavailable', version: null, offer: null };
  try {
    const platform = shellPlatform();
    if (platform === 'android') {
      const updater = await androidUpdater();
      // Race the manifest against a boot timeout — github offline must not hang the gate.
      const installedPromise = updater.getInstallInfo();
      const manifestPromise = updater.getUpdateManifest().then((r) => parseNativeManifest(r.manifest));
      // Use timeout fallback to avoid hanging forever on a dead network.
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('check timeout')), CHECK_TIMEOUT_MS),
      );
      const [installedAndroid, manifest] = (await Promise.race([
        Promise.all([installedPromise, manifestPromise]),
        timeoutPromise,
      ])) as [AndroidInstalledAppInfo, unknown];
      return checkUpdateFromManifest({
        platform: 'android',
        installedVersion: installedAndroid.versionName,
        installedAndroid,
        manifest,
        ignoreDismissal: options.ignoreDismissal,
      });
    }

    if (platform === 'desktop') {
      const desktop = desktopBridge();
      if (!desktop || desktop.platform !== 'win32') {
        return { status: 'not-applicable', version: null, offer: null, reason: 'unsupported-platform' };
      }
      const installedVersion = await withTimeout(Promise.resolve(desktop.version()), CHECK_TIMEOUT_MS, '' as unknown as string);
      const manifest = await withTimeout(Promise.resolve(desktop.getUpdateManifest()), CHECK_TIMEOUT_MS, null as unknown);
      if (!installedVersion || !manifest) return unavailable;
      return checkUpdateFromManifest({ platform: 'windows', installedVersion: installedVersion as string, manifest: manifest as unknown, ignoreDismissal: options.ignoreDismissal });
    }

    return { status: 'not-applicable', version: null, offer: null, reason: 'unsupported-platform' };
  } catch {
    // Offline, blocked or malformed feed: keep using the installed planner.
    return unavailable;
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
    const result = await desktop.downloadUpdate(offer) as { ready?: boolean; paused?: boolean; canceled?: boolean };
    if (result?.paused) {
      const err = new Error('paused') as Error & { code?: string };
      err.code = 'PAUSED';
      throw err;
    }
    if (result?.canceled) {
      const err = new Error('canceled') as Error & { code?: string };
      err.code = 'CANCELED';
      throw err;
    }
    if (!result?.ready) throw new Error('The update download could not be verified.');
  } finally {
    removeListener();
  }
}

export function canPausePackagedDownload(): boolean {
  const desktop = desktopBridge();
  return Boolean(desktop && desktop.platform === 'win32' && typeof desktop.pauseUpdate === 'function');
}
export function canCancelPackagedDownload(): boolean {
  const desktop = desktopBridge();
  // Desktop can cancel a resumable download; Android's native downloader handles its own lifecycle.
  if (desktop && desktop.platform === 'win32' && typeof desktop.cancelUpdate === 'function') return true;
  return false;
}

export async function pausePackagedDownload(): Promise<void> {
  const desktop = desktopBridge();
  if (!desktop || desktop.platform !== 'win32' || typeof desktop.pauseUpdate !== 'function') {
    throw new Error('Pause is not available on this platform.');
  }
  await desktop.pauseUpdate();
}

export async function resumePackagedDownload(offer: UpdateOffer, onProgress: (progress: ProgressEvent) => void): Promise<void> {
  const desktop = desktopBridge();
  if (desktop && desktop.platform === 'win32' && typeof desktop.resumeUpdate === 'function') {
    // Desktop resume keeps the partial file and continues with Range; fall
    // back to a fresh download if the bridge does not support resume.
    try {
      const resumed = await desktop.resumeUpdate();
      if (resumed?.resumed) {
        // The main process resumed the fetch; progress will arrive via the
        // existing listener. Re-enter the download path so verification still
        // happens and the promise resolves only when the file is ready.
        return downloadPackagedUpdate(offer, onProgress);
      }
    } catch {
      // resumeUpdate may throw if there is nothing to resume — fall through to a normal download
    }
  }
  return downloadPackagedUpdate(offer, onProgress);
}

export async function cancelPackagedDownload(): Promise<void> {
  const desktop = desktopBridge();
  if (desktop && desktop.platform === 'win32' && typeof desktop.cancelUpdate === 'function') {
    await desktop.cancelUpdate();
    return;
  }
  // No native cancel on this platform — the caller will reset UI state.
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
