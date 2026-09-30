/**
 * Gate for /app: opens the encrypted vault before the planner is shown.
 *
 * No session        → the sign-in page.
 * Session, no key   → the unlock screen.
 * Key               → the planner, seeded with the decrypted state.
 * Offline           → the planner with the local copy, so the app still works.
 */
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { App } from '../App';
import { bootAccount, signOut, unlockWithPassword, type AccountBoot } from './vault';
import { AuthError } from './session';
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

export function AccountGate() {
  const [boot, setBoot] = useState<Boot>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [caps, setCaps] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void bootAccount().then(
      (result) => !cancelled && setBoot(result),
      (err: unknown) => {
        if (cancelled) return;
        // Without a network we cannot read the vault, so keep working locally.
        if (err instanceof AuthError && err.code === 'network') {
          setBoot({ status: 'offline' });
          return;
        }
        // Everything else used to be treated as "signed out", which sent people
        // to a sign-in form that could not possibly work. Name the real cause.
        if (err instanceof AuthError) {
          setBoot({ status: 'blocked', error: err });
          return;
        }
        setBoot({ status: 'signed-out' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (boot?.status === 'ready') return <App initialState={boot.state} />;
  if (boot?.status === 'offline' || boot?.status === 'offline-trusted') return <App />;

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
            <button type="button" onClick={() => window.location.assign('/')}>
              {t('Back to the website')}
            </button>
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

  return (
    <GateFrame leaving={leaving}>
      {!locked ? (
        <p className="gate-loading">
          <span className="gate-spinner" aria-hidden="true" />
          {t('Checking your account…')}
        </p>
      ) : (
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
      )}
    </GateFrame>
  );
}
