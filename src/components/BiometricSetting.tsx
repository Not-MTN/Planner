/**
 * The settings row for unlocking the planner with a face or a fingerprint.
 *
 * Shown only in the phone apps, and only on a device that has the hardware and
 * somebody enrolled in it — everywhere else the row would be a promise the
 * platform cannot keep. Turning it on hands the vault key to the operating
 * system's protected storage, and turns *off* the other fast way in: the silent
 * "keep this device signed in" copy. Leaving that armed would open the planner
 * without the check, which is the opposite of what the row says it does.
 */
import { useEffect, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { t } from '../i18n';
import {
  BiometricError,
  biometricAvailability,
  biometricEnrolled,
  biometricKindLabel,
  biometricShell,
  forgetBiometricKey,
  saveBiometricKey,
  type BiometricKind,
} from '../auth/biometric';
import { forgetDevice } from '../auth/device';
import { accountUser } from '../auth/vault';
import { getActiveSession } from '../auth/session';

export function BiometricSetting() {
  const { flash } = usePlanner();
  const [state, setState] = useState<{ available: boolean; kind: BiometricKind; enrolled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!biometricShell()) return;
    let live = true;
    void (async () => {
      const availability = await biometricAvailability();
      const enrolled = availability.available ? await biometricEnrolled() : false;
      if (live) setState({ ...availability, enrolled });
    })();
    return () => {
      live = false;
    };
  }, []);

  // No hardware, nobody enrolled, or an older app without the plugin: the
  // section simply is not there, rather than explaining a feature the device
  // cannot have.
  if (!state?.available) return null;

  const label = biometricKindLabel(state.kind);

  const turnOn = async () => {
    if (busy) return;
    const raw = getActiveSession()?.dekRaw;
    if (!raw) {
      // No vault key in memory to hand over: the app was opened from the local
      // copy, so there is nothing yet to put behind the check. Unlocking with
      // the password once puts it back within reach.
      flash(t('Unlock with your password once, then turn this on.'));
      return;
    }
    setBusy(true);
    try {
      await saveBiometricKey(raw, t('Confirm it is you'));
      // The silent copy is what this replaces. Leaving it armed would keep
      // opening the planner without asking, which is what the person just
      // chose to stop.
      const user = accountUser();
      if (user) await forgetDevice(user.id);
      setState((current) => (current ? { ...current, enrolled: true } : current));
      flash(t('Turned on for this device.'));
    } catch (caught) {
      flash(caught instanceof BiometricError ? caught.message : t('That could not be turned on just now.'));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await forgetBiometricKey();
      setState((current) => (current ? { ...current, enrolled: false } : current));
      flash(t('Turned off for this device.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="set-section">
      <h3 className="kicker">{t('Unlock your planner')}</h3>
      <div className="set-row">
        <div>
          <p className="set-label">{t('Unlock with {0}', { 0: label })}</p>
          <p className="set-hint">
            {state.enrolled
              ? t('On for this device. Your password still works, and signing out removes it.')
              : t('Open your planner with {0} instead of typing your password each time.', { 0: label })}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.enrolled}
          aria-label={t('Unlock with {0}', { 0: label })}
          className={cx('btn', 'btn-soft', state.enrolled && 'btn-primary')}
          disabled={busy}
          onClick={() => (state.enrolled ? void turnOff() : void turnOn())}
        >
          {state.enrolled ? t('On') : t('Off')}
        </button>
      </div>
    </section>
  );
}
