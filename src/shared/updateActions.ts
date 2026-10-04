import type { Dispatch, SetStateAction } from 'react';
import { t } from '../i18n';
import { applyPackagedUpdate, checkPackagedUpdate, downloadPackagedUpdate } from './updateRuntime';
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

/** Download, verify and start the platform's in-place installer for an offer. */
export function startPackagedUpdate(offer: UpdateOffer, setState: StartupStateSetter): Promise<void> {
  const key = `${offer.platform}:${offer.version}`;
  const existing = activeUpdates.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const completeProgress = { bytesReceived: offer.sizeBytes, totalBytes: offer.sizeBytes };
    setState((current) => withUpdateProgress(current, 'downloading', { bytesReceived: 0, totalBytes: offer.sizeBytes }));

    try {
      await downloadPackagedUpdate(offer, (progress) => {
        const phase = progress.totalBytes > 0 && progress.bytesReceived >= progress.totalBytes
          ? 'verifying'
          : 'downloading';
        setState((current) => withUpdateProgress(current, phase, progress));
      });

      setState((current) => withUpdateProgress(current, 'ready-to-apply', completeProgress));
      await installPackagedUpdate(offer, setState);
    } catch (error) {
      setState((current) => withUpdateProgress(
        current,
        'error',
        current.update.progress,
        error instanceof Error && error.message ? error.message : t('The update could not be downloaded or installed.'),
      ));
    }
  })();

  activeUpdates.set(key, pending);
  return pending.finally(() => {
    if (activeUpdates.get(key) === pending) activeUpdates.delete(key);
  });
}

/** Apply a package which has already been downloaded and verified. */
export async function installPackagedUpdate(offer: UpdateOffer, setState: StartupStateSetter): Promise<void> {
  const completeProgress = { bytesReceived: offer.sizeBytes, totalBytes: offer.sizeBytes };
  setState((current) => withUpdateProgress(current, 'applying', completeProgress));
  try {
    await applyPackagedUpdate(offer);
    setState((current) => withUpdateProgress(current, 'complete', completeProgress));
  } catch (error) {
    setState((current) => withUpdateProgress(
      current,
      'error',
      current.update.progress,
      error instanceof Error && error.message ? error.message : t('The update could not be installed.'),
    ));
  }
}
