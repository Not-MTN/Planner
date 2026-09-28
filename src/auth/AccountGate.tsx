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
import '../styles.css';
import './gate.css';

type Boot = AccountBoot | { status: 'offline' } | null;

export function AccountGate() {
  const [boot, setBoot] = useState<Boot>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bootAccount().then(
      (result) => !cancelled && setBoot(result),
      (err: unknown) => {
        if (cancelled) return;
        // Without a network we cannot read the vault, so keep working locally.
        setBoot(err instanceof AuthError && err.code === 'network' ? { status: 'offline' } : { status: 'signed-out' });
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
    if (boot?.status !== 'offline') return;
    const retry = () => window.location.reload();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [boot]);

  if (boot?.status === 'ready') return <App initialState={boot.state} />;
  if (boot?.status === 'offline') return <App />;

  const locked = boot?.status === 'locked' ? boot.user : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    void unlockWithPassword(password, remember).then(
      (result) => setBoot(result),
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
    <div className="gate">
      <div className="gate-card">
        {!locked ? (
          <p className="gate-loading">
            <span className="gate-spinner" aria-hidden="true" />
            {t('Checking your account…')}
          </p>
        ) : (
          <>
            <div className="gate-mark" aria-hidden="true">
              🔐
            </div>
            <h1 className="gate-title">{t('Unlock your planner')}</h1>
            <p className="gate-sub">
              {t('Welcome back')}, {locked.displayName || locked.username}.{' '}
              {t('Enter your password to open your planner on this device.')}
            </p>

            <form className="gate-form" onSubmit={submit}>
              <label className="gate-label">
                {t('Password')}
                <input
                  className="gate-input"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  autoFocus
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

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
      </div>
    </div>
  );
}
