import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { PackagedUpdateCheckResult, UpdateCheckResult, UpdateNotApplicableReason, UpdateOffer } from './updates';

/** The account side of the first app boot. */
export type StartupAccountStatus =
  | 'checking'
  | 'ready'
  | 'locked'
  | 'signed-out'
  | 'offline'
  | 'offline-trusted'
  | 'blocked';

/** What the account request tells us about the connection at startup. */
export type StartupConnectionStatus = 'checking' | 'connected' | 'offline' | 'unknown' | 'not-applicable';

/**
 * Shared updater lifecycle. The later platform-specific flows extend the same
 * state through download, verification, apply and relaunch; none of those
 * phases should be inferred from a toast or a component's local state.
 */
export type StartupUpdatePhase =
  | 'not-applicable'
  | 'checking'
  | 'current'
  | 'available'
  | 'dismissed'
  | 'downloading'
  | 'verifying'
  | 'ready-to-apply'
  | 'applying'
  | 'complete'
  | 'unavailable'
  | 'error';

export interface UpdateProgress {
  bytesReceived: number;
  totalBytes: number | null;
}

export interface StartupUpdateState {
  phase: StartupUpdatePhase;
  availableVersion: string | null;
  offer: UpdateOffer | null;
  progress: UpdateProgress | null;
  error: string | null;
  notApplicableReason: UpdateNotApplicableReason | null;
}

/**
 * One state shared by the account gate and the mounted planner. Keeping the
 * installed version separate from the target version makes the state usable
 * for future download/apply steps without replacing the version the app is
 * actually running.
 */
export interface StartupState {
  account: StartupAccountStatus;
  connection: StartupConnectionStatus;
  installedVersion: string;
  update: StartupUpdateState;
}

export function createStartupState(installedVersion: string, updateChecksEnabled: boolean): StartupState {
  return {
    account: 'checking',
    connection: 'checking',
    installedVersion,
    update: {
      phase: updateChecksEnabled ? 'checking' : 'not-applicable',
      availableVersion: null,
      offer: null,
      progress: null,
      error: null,
      notApplicableReason: null,
    },
  };
}

/** Apply the version check without disturbing account boot or download state. */
export function withUpdateCheck(
  state: StartupState,
  result: UpdateCheckResult | PackagedUpdateCheckResult,
): StartupState {
  return {
    ...state,
    update: {
      phase: result.status,
      availableVersion: result.version,
      offer: 'offer' in result ? result.offer : null,
      progress: null,
      error: null,
      notApplicableReason: 'reason' in result ? result.reason : null,
    },
  };
}

export function withUpdateProgress(
  state: StartupState,
  phase: StartupUpdatePhase,
  progress: UpdateProgress | null,
  error: string | null = null,
): StartupState {
  return {
    ...state,
    update: { ...state.update, phase, progress, error, notApplicableReason: null },
  };
}

export function withAccountCheck(
  state: StartupState,
  account: Exclude<StartupAccountStatus, 'checking'>,
  connection: Exclude<StartupConnectionStatus, 'checking'>,
): StartupState {
  return { ...state, account, connection };
}

export function dismissStartupUpdate(state: StartupState): StartupState {
  if (!state.update.availableVersion || !['available', 'ready-to-apply', 'error'].includes(state.update.phase)) return state;
  return {
    ...state,
    update: { ...state.update, phase: 'dismissed', progress: null, error: null },
  };
}

interface StartupContextValue {
  state: StartupState;
  setState: Dispatch<SetStateAction<StartupState>>;
}

const StartupContext = createContext<StartupContextValue | null>(null);

/** Keeps startup/update information alive as AccountGate hands off to the app. */
export function StartupProvider({
  state,
  setState,
  children,
}: StartupContextValue & { children: ReactNode }) {
  return <StartupContext.Provider value={{ state, setState }}>{children}</StartupContext.Provider>;
}

/** Null when the planner is mounted directly (for example, in isolated tests). */
export function useStartupState(): StartupContextValue | null {
  return useContext(StartupContext);
}
