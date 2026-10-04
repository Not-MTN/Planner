/**
 * Gate for /app: opens the encrypted vault before the planner is shown.
 *
 * No session        → the sign-in page.
 * Session, no key   → the unlock screen.
 * Key               → the planner, seeded with the decrypted state.
 * Offline           → the planner with the local copy, so the app still works.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { App } from '../App';
import { accountUser, bootAccount, signOut, unlockWithPassword, type AccountBoot } from './vault';
import { AuthError, getLastUserId } from './session';
import { isNativeShell } from '../shared/nativeShell';
import { currentVersion, type PackagedUpdateCheckResult } from '../shared/updates';
import { checkPackagedUpdate, supportsPackagedUpdates } from '../shared/updateRuntime';
import type { PlannerState } from '../types';
import {
  createStartupState,
  StartupProvider,
  withAccountCheck,
  withUpdateCheck,
  type StartupAccountStatus,
  type StartupConnectionStatus,
  type StartupState,
} from '../shared/startup';
// The planner's component styles, for the unlock screen and the app behind it.
// app-polish.css is the final layer: it ships in the same chunk and must load
// after styles.css so its rules carry the day on every device class.
import '../styles.css';
import '../app-polish.css';
import './gate.css';

type Boot = AccountBoot | { status: 'offline' } | { status: 'blocked'; error: AuthError } | null;

/**
 * One sentence per cause, in the reader's language. "Signed out" is wrong for
 * all of these: no password could get past a gate or a missing API, and saying
 * so is the difference between a fixable report and a loop.
 */
function blockedReason(error: AuthError): string {
  if (error.code === 'deployment_gate') {
    return t('This deployment is behind a hosting sign-in page. Turn off Vercel Authentication or password protection, then reload.');
  }
  if (error.code === 'api_missing') {
    return t('The accounts API is not answering at this address. Redeploy the app with its api/ functions, then reload.');
  }
  if (error.code === 'not_configured') {
    return t('Accounts are not set up on this server yet. Add DATABASE_URL to the deployment, then reload.');
  }
  if (error.code === 'local_only_build') {
    return t(
      'This copy of Planner was built for offline use, with no server address, so there is nothing to sign in to. Your planner still works on this device. Install a build made with PLANNER_API_ORIGIN or PLANNER_APP_URL to use accounts, sync and AI.',
    );
  }
  if (error.code === 'origin_refused') {
    return t(
      'This app reached the server, but the server refused the app’s own origin — so signing in, sync and AI are switched off. The server needs the packaged apps listed in PLANNER_APP_ORIGINS (docs/APPS.md, section 2); once it has them, this app signs in without reinstalling.',
    );
  }
  return t('Something went wrong while opening your planner.');
}

/** Drifting leaves that echo the sprout logo; pure decoration. */
function GateLeaves() {
  return (
    <div className="gate-leaves" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

/**
 * True when this device has nothing to unlock and nothing to show: a packaged
 * app (where accounts are the point of the download) that has never signed in,
 * with the server out of reach. The planner without an account is a real, good
 * product — but it is a choice someone makes, not a screen they fall into.
 */
function hasNothingToUnlock(): boolean {
  return isNativeShell() && !accountUser() && !getLastUserId();
}

/**
 * The first screen of a downloaded app whose server cannot be reached. Without
 * it the app opened an anonymous local planner and never mentioned accounts —
 * the "there is no login page" report this exists to answer.
 */
function OfflineStart({ onOffline }: { onOffline: () => void }) {
  return (
    <GateFrame>
      <img className="gate-logo" src="/logo.svg" alt="" width="56" height="56" />
      <h1 className="gate-title">{t('Sign in to Planner')}</h1>
      <p className="gate-sub">
        {t(
          'This app cannot reach its server right now, so signing in has nowhere to go. Your planner still works on this device, and everything you write is saved here.',
        )}
      </p>
      <div className="gate-actions">
        <button className="btn btn-primary" type="button" onClick={() => window.location.assign('/login')}>
          {t('Sign in')}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onOffline}>
          {t('Use Planner offline')}
        </button>
      </div>
      <div className="gate-links">
        <button type="button" onClick={() => window.location.reload()}>
          {t('Retry')}
        </button>
      </div>
    </GateFrame>
  );
}

/**
 * The shared look of every gate screen: the morning-sprout photograph on one
 * side, drifting leaves, and the card slot on the other.
 */
function GateFrame({ leaving = false, children }: { leaving?: boolean; children: React.ReactNode }) {
  return (
    <div className={leaving ? 'gate gate-leaving' : 'gate'}>
      <div className="gate-art" aria-hidden="true">
        <img src="/img/auth-gate.jpg" alt="" width="1024" height="1536" loading="eager" decoding="async" />
        <div className="gate-art-veil" />
      </div>
      <GateLeaves />
      <div className="gate-card">{children}</div>
    </div>
  );
}

function accountStatusForBoot(boot: AccountBoot): Exclude<StartupAccountStatus, 'checking'> {
  switch (boot.status) {
    case 'ready':
      return 'ready';
    case 'locked':
      return 'locked';
    case 'offline-trusted':
      return 'offline-trusted';
    case 'signed-out':
      return 'signed-out';
  }
}

function connectionStatusForBoot(boot: AccountBoot): Exclude<StartupConnectionStatus, 'checking'> {
  // A trusted local copy can be reached after either a genuinely offline boot
  // or an expired server session, so do not claim that the network is down.
  return boot.status === 'offline-trusted' ? 'unknown' : 'connected';
}

function accountStatusText(status: StartupAccountStatus): string {
  switch (status) {
    case 'checking':
      return t('Checking your account…');
    case 'ready':
      return t('Signed in');
    case 'locked':
      return t('Unlock your planner');
    case 'signed-out':
      return t('Sign in to Planner');
    case 'offline':
    case 'offline-trusted':
      return t('Offline · saved here');
    case 'blocked':
      return t("Can't open your planner");
  }
}

function connectionStatusText(status: StartupConnectionStatus): string {
  switch (status) {
    case 'checking':
      return t('Checking your connection…');
    case 'connected':
      return t('Connected');
    case 'offline':
      return t('Offline');
    case 'unknown':
      return t('Couldn’t confirm connection');
    case 'not-applicable':
      return t('Not applicable');
  }
}

function updateStatusText(state: StartupState): string {
  switch (state.update.phase) {
    case 'checking':
      return t('Checking for updates…');
    case 'current':
      return t('Up to date · {0}', { 0: state.installedVersion });
    case 'available':
    case 'dismissed':
      return t('Update available · {0}', { 0: state.update.availableVersion ?? '' });
    case 'downloading': {
      const { bytesReceived, totalBytes } = state.update.progress ?? { bytesReceived: 0, totalBytes: null };
      if (totalBytes && totalBytes > 0) {
        const percent = Math.min(100, Math.floor((bytesReceived / totalBytes) * 100));
        return t('Downloading update · {0}%', { 0: percent });
      }
      return t('Downloading update…');
    }
    case 'verifying':
      return t('Verifying update…');
    case 'ready-to-apply':
      return t('Update ready to install');
    case 'applying':
      return t('Installing update…');
    case 'complete':
      return t('Update complete');
    case 'unavailable':
      return t('Couldn’t check for updates');
    case 'error':
      return state.update.error || t('Couldn’t check for updates');
    case 'not-applicable':
      if (state.update.notApplicableReason === 'store-managed') return t('Updates are managed by Google Play');
      if (state.update.notApplicableReason === 'signing-mismatch') return t('This install cannot be safely updated in-app');
      if (state.update.notApplicableReason === 'package-mismatch') return t('This package is not eligible for in-app updates');
      return t('Not applicable');
  }
}

function StartupCheckRow({
  label,
  detail,
  checking = false,
  attention = false,
}: {
  label: string;
  detail: string;
  checking?: boolean;
  attention?: boolean;
}) {
  const indicatorClass = `gate-startup-indicator${checking ? ' is-checking' : ''}${attention ? ' is-attention' : ''}`;
  return (
    <li className="gate-startup-row">
      <span className={indicatorClass} aria-hidden="true">
        {checking ? <span className="gate-spinner" /> : attention ? '!' : '✓'}
      </span>
      <span className="gate-startup-label">{label}</span>
      <span className="gate-startup-value">{detail}</span>
    </li>
  );
}

function StartupScreen({ state }: { state: StartupState }) {
  return (
    <GateFrame>
      <section
        className="gate-startup"
        aria-busy={state.account === 'checking' || state.connection === 'checking' || state.update.phase === 'checking'}
        aria-live="polite"
        aria-labelledby="startup-title"
      >
        <img className="gate-logo" src="/logo.svg" alt="" width="56" height="56" />
        <h1 id="startup-title" className="gate-title">
          {t('Opening your planner…')}
        </h1>
        <p className="gate-sub">{t('Your planner is getting things ready.')}</p>
        <ul className="gate-startup-list">
          <StartupCheckRow
            label={t('Account')}
            detail={accountStatusText(state.account)}
            checking={state.account === 'checking'}
            attention={state.account === 'offline' || state.account === 'offline-trusted' || state.account === 'blocked'}
          />
          <StartupCheckRow
            label={t('Connection')}
            detail={connectionStatusText(state.connection)}
            checking={state.connection === 'checking'}
            attention={state.connection === 'offline' || state.connection === 'unknown' || state.connection === 'not-applicable'}
          />
          <StartupCheckRow
            label={t('Installed version')}
            detail={state.installedVersion ? t('Version {0}', { 0: state.installedVersion }) : t('Unknown')}
            attention={!state.installedVersion}
          />
          {state.update.phase !== 'not-applicable' ? (
            <StartupCheckRow
              label={t('Software update')}
              detail={updateStatusText(state)}
              checking={state.update.phase === 'checking'}
              attention={state.update.phase === 'unavailable' || state.update.phase === 'error'}
            />
          ) : null}
        </ul>
      </section>
    </GateFrame>
  );
}

export function AccountGate() {
  const [boot, setBoot] = useState<Boot>(null);
  const updatesEnabled = supportsPackagedUpdates();
  const [startup, setStartup] = useState(() => createStartupState(currentVersion(), updatesEnabled));
  const updateCheck = useRef<Promise<PackagedUpdateCheckResult> | null>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [caps, setCaps] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Set when someone chooses the local planner from an offline or blocked
  // first screen. The planner is local-first; refusing to open it because the
  // account API is unavailable would punish the wrong thing.
  const [offlineChoice, setOfflineChoice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void bootAccount().then(
      (result) => {
        if (cancelled) return;
        setStartup((current) => withAccountCheck(current, accountStatusForBoot(result), connectionStatusForBoot(result)));
        setBoot(result);
      },
      (err: unknown) => {
        if (cancelled) return;
        // Without a network we cannot read the vault, so keep working locally.
        if (err instanceof AuthError && err.code === 'network') {
          setStartup((current) => withAccountCheck(current, 'offline', 'offline'));
          setBoot({ status: 'offline' });
          return;
        }
        // Everything else used to be treated as "signed out", which sent people
        // to a sign-in form that could not possibly work. Name the real cause.
        if (err instanceof AuthError) {
          const connection = err.code === 'local_only_build'
            ? 'not-applicable'
            : err.code === 'origin_refused' || err.code === 'deployment_gate' || err.code === 'api_missing' || err.code === 'not_configured'
              ? 'connected'
              : 'unknown';
          setStartup((current) => withAccountCheck(current, 'blocked', connection));
          setBoot({ status: 'blocked', error: err });
          return;
        }
        setStartup((current) => withAccountCheck(current, 'signed-out', 'unknown'));
        setBoot({ status: 'signed-out' });
      },
    );

    if (updatesEnabled) {
      // The ref also deduplicates React Strict Mode's development-only effect
      // replay. The result remains useful after AccountGate hands off to App.
      updateCheck.current ??= checkPackagedUpdate();
      void updateCheck.current.then(
        (result) => {
          if (!cancelled) setStartup((current) => withUpdateCheck(current, result));
        },
        () => {
          if (!cancelled) setStartup((current) => withUpdateCheck(current, { status: 'unavailable', version: null, offer: null }));
        },
      );
    }

    return () => {
      cancelled = true;
    };
  }, [updatesEnabled]);

  // The planner is for people who are signed in.
  useEffect(() => {
    if (boot?.status === 'signed-out') window.location.assign('/login');
  }, [boot]);

  // Back online after an offline boot? Reload so the vault can take over.
  useEffect(() => {
    if (boot?.status !== 'offline' && boot?.status !== 'offline-trusted') return;
    const retry = () => window.location.reload();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [boot]);

  const renderPlanner = (initialState?: PlannerState | null) => (
    <StartupProvider state={startup} setState={setStartup}>
      <App initialState={initialState} />
    </StartupProvider>
  );

  if (boot?.status === 'ready') return renderPlanner(boot.state);
  if (offlineChoice) return renderPlanner();
  // A device that signed in before opens its own copy offline, as it always
  // has. One that never did gets the choice below instead of an anonymous
  // planner with no way to sign in.
  if (boot?.status === 'offline-trusted') return renderPlanner();
  if (boot?.status === 'offline') {
    return hasNothingToUnlock() ? <OfflineStart onOffline={() => setOfflineChoice(true)} /> : renderPlanner();
  }

  if (boot?.status === 'blocked') {
    const { error } = boot;
    return (
      <GateFrame>
        <div className="gate-mark" aria-hidden="true">
          ⚠️
        </div>
          <h1 className="gate-title">{t("Can't open your planner")}</h1>
          <p className="gate-sub">{blockedReason(error)}</p>
          {error.detail ? (
            <code className="gate-detail" dir="ltr">
              {error.detail}
            </code>
          ) : null}
          <div className="gate-actions">
            <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
              {t('Retry')}
            </button>
          </div>
          <div className="gate-links">
            {/* Both of these say, in their own sentence, that the planner on
                this device still works. Saying that and then refusing to open
                it is the kind of screen people describe as "the app is broken",
                so the way in is a button. A hosted-gate or missing-API failure
                keeps blocking, because that is where somebody's data lives. */}
            {error.code === 'origin_refused' || error.code === 'local_only_build' ? (
              <button type="button" onClick={() => setOfflineChoice(true)}>
                {t('Use Planner offline')}
              </button>
            ) : null}
            {/* A packaged app boots into the planner from every path, so the
                landing page is not reachable there and the link would bounce
                back to this screen. */}
            {isNativeShell() ? null : (
              <button type="button" onClick={() => window.location.assign('/')}>
                {t('Back to the website')}
              </button>
            )}
          </div>
      </GateFrame>
    );
  }

  const locked = boot?.status === 'locked' ? boot.user : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    void unlockWithPassword(password, remember).then(
      (result) => {
        setStartup((current) => withAccountCheck(current, accountStatusForBoot(result), connectionStatusForBoot(result)));
        // A short goodbye: the gate fades out instead of snapping to the app.
        if (result.status === 'ready') {
          setLeaving(true);
          window.setTimeout(() => setBoot(result), 240);
          return;
        }
        setBoot(result);
      },
      (err: unknown) => {
        setBusy(false);
        setError(
          err instanceof Error && err.message
            ? err.message
            : t('That password did not unlock this planner.'),
        );
      },
    );
  };

  const leave = () => {
    setBusy(true);
    void signOut().then(
      () => window.location.assign('/'),
      () => window.location.assign('/'),
    );
  };

  if (!locked) return <StartupScreen state={startup} />;

  return (
    <GateFrame leaving={leaving}>
      <>
          <img className="gate-logo" src="/logo.svg" alt="" width="56" height="56" />
          <h1 className="gate-title">{t('Unlock your planner')}</h1>
            <p className="gate-sub">
              {t('Welcome back')}, {locked.displayName || locked.username}.{' '}
              {t('Enter your password to open your planner on this device.')}
            </p>

            <form className="gate-form" onSubmit={submit}>
              <label className="gate-label">
                {t('Password')}
                <span className="gate-input-wrap">
                  <input
                    className="gate-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    autoComplete="current-password"
                    autoFocus
                    required
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyUp={(event) => setCaps(event.getModifierState('CapsLock'))}
                    onKeyDown={(event) => setCaps(event.getModifierState('CapsLock'))}
                  />
                  <button
                    type="button"
                    className="gate-field-toggle"
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? t('Hide password') : t('Show password')}
                  </button>
                </span>
              </label>
              {caps && !showPassword ? <p className="gate-caps">{t('Caps Lock is on.')}</p> : null}

              <label className="gate-check">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                {t('Keep this device signed in')}
              </label>

              {error && <p className="gate-error">{error}</p>}

              <div className="gate-actions">
                <button className="btn btn-primary" type="submit" disabled={busy || !password}>
                  {busy ? (
                    <>
                      <span className="gate-spinner" aria-hidden="true" />
                      {t('Unlocking…')}
                    </>
                  ) : (
                    t('Unlock')
                  )}
                </button>
              </div>

              <div className="gate-links">
                <button type="button" onClick={() => window.location.assign('/recover')}>
                  {t('Forgot your password?')}
                </button>
                <button type="button" onClick={leave} disabled={busy}>
                  {t('Not you? Sign out')}
                </button>
              </div>

              <p className="gate-note">
                {t(
                  'Your planner is encrypted, so we cannot reset it for you. Use the recovery key you saved when you signed up.',
                )}
              </p>
            </form>
      </>
    </GateFrame>
  );
}
