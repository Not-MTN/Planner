import type { Dispatch, SetStateAction } from 'react';
import { t } from '../i18n';
import {
  applyPackagedUpdate,
  cancelPackagedDownload,
  checkPackagedUpdate,
  downloadPackagedUpdate,
  pausePackagedDownload,
} from './updateRuntime';
import { withUpdateCheck, withUpdateProgress, type StartupState } from './startup';
import type { PackagedUpdateCheckResult, UpdateOffer } from './updates';

export type StartupStateSetter = Dispatch<SetStateAction<StartupState>>;

let activeCheck: Promise<PackagedUpdateCheckResult> | null = null;
const activeUpdates = new Map<string, Promise<void>>();

/**
 * Recheck the packaged release feed on an explicit user action. A manual
 * check intentionally ignores a previous “Later” dismissal; when a new
 * release is found its verified package download starts in the app straight
 * away instead of sending the user to a browser or leaving a stale notice.
 */
export function checkAndStartPackagedUpdate(setState: StartupStateSetter): Promise<PackagedUpdateCheckResult> {
  if (activeCheck) return activeCheck;

  const pending = (async () => {
    setState((current) => withUpdateProgress(current, 'checking', null));

    let result: PackagedUpdateCheckResult;
    try {
      result = await checkPackagedUpdate({ ignoreDismissal: true });
    } catch {
      result = { status: 'unavailable', version: null, offer: null };
    }

    setState((current) => withUpdateCheck(current, result));
    if (result.status === 'available' && result.offer) {
      // The action is user-initiated. Download and verify in Planner, then
      // hand the verified package to the platform installer for confirmation.
      void startPackagedUpdate(result.offer, setState);
    }
    return result;
  })();

  activeCheck = pending;
  return pending.finally(() => {
    if (activeCheck === pending) activeCheck = null;
  });
}

function createSpeedTracker() {
  let lastBytes = 0;
  let lastTime = Date.now();
  let speedBps: number | null = null;
  return (bytesReceived: number, nativeSpeed?: number | null): number | null => {
    if (typeof nativeSpeed === 'number' && Number.isFinite(nativeSpeed) && nativeSpeed >= 0) {
      speedBps = nativeSpeed;
      lastBytes = bytesReceived;
      lastTime = Date.now();
      return speedBps;
    }
    const now = Date.now();
    const elapsed = (now - lastTime) / 1000;
    if (elapsed < 0.25) return speedBps;
    const delta = bytesReceived - lastBytes;
    if (delta < 0) {
      lastBytes = bytesReceived;
      lastTime = now;
      return speedBps;
    }
    const instant = elapsed > 0 ? delta / elapsed : 0;
    // simple EWMA to smooth spikes
    if (speedBps == null) speedBps = instant;
    else speedBps = speedBps * 0.6 + instant * 0.4;
    lastBytes = bytesReceived;
    lastTime = now;
    return speedBps;
  };
}

/** Download, verify and start the platform's in-place installer for an offer. */
export function startPackagedUpdate(offer: UpdateOffer, setState: StartupStateSetter): Promise<void> {
  const key = `${offer.platform}:${offer.version}`;
  const existing = activeUpdates.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const completeProgress = { bytesReceived: offer.sizeBytes, totalBytes: offer.sizeBytes, speedBps: null as number | null };
    // Keep any existing progress for resume (e.g. after a connection loss)
    let initialProgress: { bytesReceived: number; totalBytes: number | null; speedBps?: number | null } | null = null;
    setState((current) => {
      const prev = current.update.progress;
      if (
        prev &&
        current.update.offer &&
        current.update.offer.version === offer.version &&
        current.update.offer.platform === offer.platform &&
        (current.update.phase === 'error' || current.update.phase === 'paused' || current.update.phase === 'downloading')
      ) {
        initialProgress = prev;
        return withUpdateProgress(current, 'downloading', { ...prev, speedBps: prev.speedBps ?? null });
      }
      initialProgress = { bytesReceived: 0, totalBytes: offer.sizeBytes, speedBps: null };
      return withUpdateProgress(current, 'downloading', initialProgress);
    });

    const trackSpeed = createSpeedTracker();
    // seed tracker with initial bytes so speed doesn't spike from 0 after resume
    if (initialProgress != null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackSpeed((initialProgress as any).bytesReceived, (initialProgress as any).speedBps ?? null);
    }

    try {
      await downloadPackagedUpdate(offer, (progress) => {
        const speed = trackSpeed(progress.bytesReceived, (progress as { speedBps?: number | null }).speedBps ?? null);
        const enriched = { bytesReceived: progress.bytesReceived, totalBytes: progress.totalBytes, speedBps: speed };
        const phase = progress.totalBytes > 0 && progress.bytesReceived >= progress.totalBytes ? 'verifying' : 'downloading';
        setState((current) => withUpdateProgress(current, phase, enriched));
      });

      setState((current) => withUpdateProgress(current, 'ready-to-apply', completeProgress));
      await installPackagedUpdate(offer, setState);
    } catch (error) {
      const code = (error as Error & { code?: string })?.code;
      if (code === 'PAUSED') {
        setState((current) => {
          const prev = current.update.progress;
          return withUpdateProgress(current, 'paused', prev ? { ...prev, speedBps: null } : { bytesReceived: 0, totalBytes: offer.sizeBytes, speedBps: null });
        });
        return;
      }
      if (code === 'CANCELED') {
        setState((current) => withUpdateProgress(current, 'available', null));
        return;
      }
      setState((current) =>
        withUpdateProgress(
          current,
          'error',
          // keep bytes on network errors so the next “Try again” can resume
          current.update.progress ?? { bytesReceived: 0, totalBytes: offer.sizeBytes, speedBps: null },
          error instanceof Error && error.message ? error.message : t('The update could not be downloaded or installed.'),
        ),
      );
    }
  })();

  activeUpdates.set(key, pending);
  return pending.finally(() => {
    if (activeUpdates.get(key) === pending) activeUpdates.delete(key);
  });
}

/** Pause the current download — the partial file is kept for resume. */
export async function pausePackagedUpdate(setState: StartupStateSetter): Promise<void> {
  try {
    await pausePackagedDownload();
    setState((current) => {
      if (current.update.phase !== 'downloading' && current.update.phase !== 'verifying') return current;
      const prev = current.update.progress;
      return withUpdateProgress(current, 'paused', prev ? { ...prev, speedBps: null } : prev);
    });
  } catch (error) {
    setState((current) =>
      withUpdateProgress(
        current,
        'error',
        current.update.progress,
        error instanceof Error && error.message ? error.message : t('Could not pause the download.'),
      ),
    );
  }
}

/** Resume a paused or failed download from where it left off (Range). */
export async function resumePackagedUpdate(offer: UpdateOffer, setState: StartupStateSetter): Promise<void> {
  // resume is just a fresh start that will detect the .part file and send Range
  return startPackagedUpdate(offer, setState);
}

/** Cancel and discard the partial download. */
export async function cancelPackagedUpdate(setState: StartupStateSetter): Promise<void> {
  try {
    await cancelPackagedDownload();
  } catch {
    // cancel is best-effort — even if the bridge has no handler, clear UI state
  }
  setState((current) => {
    // back to available so “Update now” is shown again; keep the offer so the card stays
    if (['downloading', 'verifying', 'paused', 'error'].includes(current.update.phase)) {
      return withUpdateProgress(current, 'available', null);
    }
    return current;
  });
}

/** Apply a package which has already been downloaded and verified. */
export async function installPackagedUpdate(offer: UpdateOffer, setState: StartupStateSetter): Promise<void> {
  const completeProgress = { bytesReceived: offer.sizeBytes, totalBytes: offer.sizeBytes, speedBps: null as number | null };
  setState((current) => withUpdateProgress(current, 'applying', completeProgress));
  try {
    await applyPackagedUpdate(offer);
    setState((current) => withUpdateProgress(current, 'complete', completeProgress));
  } catch (error) {
    setState((current) =>
      withUpdateProgress(
        current,
        'error',
        current.update.progress,
        error instanceof Error && error.message ? error.message : t('The update could not be installed.'),
      ),
    );
  }
}
