/**
 * The one way to leave a signed-in planner from inside the app.
 *
 * Sign-out used to exist only on the unlock screen ("Not you? Sign out"), so
 * once the vault was open there was no way out short of clearing the browser.
 * The side panel, the mobile "More" panel and Settings all call this hook, so
 * the button is wherever people look for it — and every path does the same
 * three things: flush the pending encrypted save, end the session, go home.
 */
import { useCallback } from 'react';
import { usePlanner } from '../context';
import { t } from '../i18n';
import { flushVaultPush, signOut } from '../auth/vault';

export function useSignOut() {
  const { requestConfirm } = usePlanner();

  return useCallback(() => {
    requestConfirm({
      title: t('Sign out of Planner?'),
      body: t('Your planner stays in its encrypted vault and on this device. Sign in again any time to pick up where you left off.'),
      confirmLabel: t('Sign out'),
      onConfirm: () => {
        void (async () => {
          // Never leave a debounced save behind: the vault push is queued for
          // up to 2.5s after the last edit, and sign-out drops the key for it.
          try {
            await flushVaultPush();
          } catch {
            /* offline or already gone — the local copy is still safe */
          }
          try {
            await signOut();
          } catch {
            /* the server session may already be dead; leave either way */
          }
          window.location.assign('/');
        })();
      },
    });
  }, [requestConfirm]);
}
