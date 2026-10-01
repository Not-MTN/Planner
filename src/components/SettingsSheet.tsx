import { ACCENT_CHOICES, type Accent } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { useImportFile } from '../hooks';
import { DownloadIcon, ExitIcon, SparklesIcon, UploadIcon, UserIcon } from '../icons';
import { Rich } from './Rich';
import { Modal } from './ui';
import { useEffect, useState } from 'react';
import { FeedsSection, SecuritySection, SharedSpaceSection, TaskImportSection, TemplatesSection, WeatherSection } from './SettingsExtras';
import { useSignOut } from './useSignOut';
import { accountUser, forgetAccountUser } from '../auth/vault';
import { deleteAccount, getActiveSession } from '../auth/session';
import { DATE_LANGUAGES, todayISO, type DateLanguage } from '../dates';
import { downloadBusyICS, downloadICS, parseICS } from '../ics';
import { canInstall, isInstalled, onInstallChange, promptInstall } from '../pwa';
import { requestTour } from '../tour';
import { requestAbout } from '../about';
import { LEAD_CHOICES } from '../reminders';
import { loadSpeechLocaleId, saveSpeechLocaleId, speechAvailable, SPEECH_LOCALES } from '../speech';
import { t, getLang, setLang, LANGUAGES, type Lang } from '../i18n';
import { loadNavigationPages, NAVIGATION_PAGES, saveNavigationPages, type NavigationPage } from '../navigationPrefs';
import { backgroundPushEnabled, configureBackgroundPush, refreshBackgroundPushSchedule } from '../push';

const NAV_LABELS: Record<NavigationPage, string> = {
  today: t("Today"), calendar: t("Calendar"), tasks: t("Tasks"), matrix: t("Matrix"), habits: t("Habits"),
  goals: t("Goals"), notes: t("Notes"), plans: t("Plans"), insights: t("Insights"), ai: t("AI coach"),
};

function NavigationSection() {
  const [pages, setPages] = useState(loadNavigationPages);
  const toggle = (page: NavigationPage, enabled: boolean) => {
    const next = enabled ? [...pages, page] : pages.filter((item) => item !== page);
    setPages(next);
    saveNavigationPages(next);
  };
  return (
    <section className="set-section">
      <h3 className="kicker">{t("Navigation")}</h3>
      <p className="set-hint">{t("Choose which sections stay in your desktop sidebar. Hidden sections remain available from search and the mobile More menu.")}</p>
      <div className="navigation-preferences">
        {NAVIGATION_PAGES.map((page) => (
          <label key={page} className="navigation-preference">
            <input type="checkbox" checked={pages.includes(page)} disabled={page === 'today'} onChange={(event) => toggle(page, event.target.checked)} />
            <span>{NAV_LABELS[page]}</span>
            {page === 'today' ? <small>{t("Always shown")}</small> : null}
          </label>
        ))}
      </div>
    </section>
  );
}

function SyncSection() {
  const { sync, syncStatus, syncMessage, syncAvailable, startSync, stopSync, syncNow, deleteCloudCopy, requestConfirm, flash } = usePlanner();
  const [linking, setLinking] = useState(false);
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  const statusText =
    syncStatus === 'syncing' ? t("Syncing…")
      : syncStatus === 'offline' ? t("Offline — changes will sync when you reconnect.")
        : syncStatus === 'error' ? syncMessage ?? t("Sync failed.")
          : sync.dirty ? t("Changes waiting to upload…")
            : sync.lastSyncedAt ? t("Up to date · {0}", { 0: new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
              : t("Connecting…");

  return (
    <section className="set-section">
      <h3 className="kicker">{t("Sync across devices")}</h3>
      {syncAvailable === false ? (
        <p className="set-hint">
          <Rich
            text={t("Sync needs a database. Add {name} (your Neon connection string) under Vercel → Environment Variables, or in {file}, then restart.")}
            values={{ name: <code>{t("DATABASE_URL")}</code>, file: <code>{t(".env.local")}</code> }}
          />
        </p>
      ) : null}
      {sync.code ? (
        <>
          <div className="set-row">
            <div>
              <p className="set-label">{t("Sync is on")}</p>
              <p className={cx('set-hint', syncStatus === 'error' && 'is-error')} role="status" aria-live="polite">{statusText}</p>
            </div>
            <button type="button" className="btn btn-soft" onClick={syncNow} disabled={syncStatus === 'syncing'}>{t("Sync now")}</button>
          </div>
          <div className="sync-code-box">
            <p className="set-hint">{t("Enter this code on another device to link it. Anyone with the code can read your planner, so keep it private.")}</p>
            <div className="sync-code-row">
              <code className="sync-code" aria-label={t("Sync code")}>{reveal ? sync.code : sync.code.replace(/[A-Z0-9]/g, '•')}</code>
              <button type="button" className="btn btn-tiny" onClick={() => setReveal((value) => !value)}>{reveal ? t("Hide") : t("Show")}</button>
              <button
                type="button"
                className="btn btn-tiny"
                onClick={() => {
                  void navigator.clipboard?.writeText(sync.code ?? '').then(() => flash(t("Sync code copied.")), () => setReveal(true));
                }}
              >
                {t("Copy")}
              </button>
            </div>
          </div>
          <div className="set-actions">
            <button type="button" className="btn btn-ghost" onClick={stopSync}>{t("Turn off on this device")}</button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() =>
                requestConfirm({
                  title: t("Delete the cloud copy?"),
                  body: t("This removes the encrypted copy from the database and turns sync off. Every device keeps its own local planner."),
                  confirmLabel: t("Delete cloud copy"),
                  onConfirm: () => void deleteCloudCopy(),
                })
              }
            >
              {t("Delete cloud copy")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="set-hint">{t("Keep your planner in step across your phone and computer. It's encrypted on this device before upload — the server only ever sees scrambled data.")}</p>
          {linking ? (
            <form
              className="sync-link"
              onSubmit={(event) => {
                event.preventDefault();
                const code = startSync(entry);
                if (!code) {
                  setEntryError(t("That code doesn’t look right — it has 20 letters and numbers."));
                  return;
                }
                flash(t("Device linked. Merging your planners…"));
                setLinking(false);
              }}
            >
              <input
                value={entry}
                onChange={(event) => {
                  setEntry(event.target.value);
                  setEntryError(null);
                }}
                placeholder={t("XXXX-XXXX-XXXX-XXXX-XXXX")}
                aria-label={t("Sync code from your other device")}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn btn-primary">{t("Link")}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setLinking(false)}>{t("Cancel")}</button>
              {entryError ? <p className="set-hint is-error">{entryError}</p> : null}
            </form>
          ) : (
            <div className="set-actions">
              <button type="button" className="btn btn-primary" disabled={syncAvailable === false} onClick={() => { startSync(); setReveal(true); }}>
                {t("Turn on sync")}
              </button>
              <button type="button" className="btn btn-soft" disabled={syncAvailable === false} onClick={() => setLinking(true)}>
                {t("I have a code")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RemindersSection() {
  const { reminders, setReminders, flash } = usePlanner();
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');

  const enable = async (on: boolean) => {
    if (on && supported && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'denied') flash(t("Notifications are blocked — reminders will show inside the app instead."));
    }
    setReminders({ ...reminders, enabled: on });
  };

  return (
    <section className="set-section">
      <h3 className="kicker">{t("Reminders")}</h3>
      <div className="set-row">
        <div>
          <p className="set-label">{t("Remind me")}</p>
          <p className="set-hint">
            {!supported
              ? t("This browser has no notifications; reminders appear inside the app while it is open.")
              : permission === 'denied'
                ? t("Notifications are blocked in your browser. Reminders show inside the app while it is open.")
                : t("Before events and timed tasks. Works while Planner is open (or installed).")}
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("Reminders")}>
          <button type="button" role="radio" aria-checked={!reminders.enabled} className={cx('seg', !reminders.enabled && 'on')} onClick={() => void enable(false)}>{t("Off")}</button>
          <button type="button" role="radio" aria-checked={reminders.enabled} className={cx('seg', reminders.enabled && 'on')} onClick={() => void enable(true)}>{t("On")}</button>
        </div>
      </div>
      {reminders.enabled ? (
        <>
          <div className="set-row">
            <div>
              <p className="set-label">{t("How early")}</p>
            </div>
            <select
              aria-label={t("Minutes before")}
              value={reminders.lead}
              onChange={(event) => setReminders({ ...reminders, lead: Number(event.target.value) })}
            >
              {LEAD_CHOICES.map((minutes) => (
                <option key={minutes} value={minutes}>{minutes === 0 ? t("At start time") : t("{0} min before", { 0: minutes })}</option>
              ))}
            </select>
          </div>
          <div className="set-row">
            <div>
              <p className="set-label">{t("Morning summary")}</p>
              <p className="set-hint">{t("A short “here’s your day” note.")}</p>
            </div>
            <div className="set-inline">
              <input
                type="checkbox"
                aria-label={t("Morning summary")}
                checked={reminders.digest}
                onChange={(event) => setReminders({ ...reminders, digest: event.target.checked })}
              />
              <input
                type="time"
                aria-label={t("Summary time")}
                value={reminders.digestTime}
                disabled={!reminders.digest}
                onChange={(event) => event.target.value && setReminders({ ...reminders, digestTime: event.target.value.slice(0, 5) })}
              />
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function BackgroundPushSection() {
  const { state, reminders, flash } = usePlanner();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(backgroundPushEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  useEffect(() => {
    let live = true;
    void fetch('/api/push/config', { cache: 'no-store' }).then((response) => response.json()).then((body: { configured?: boolean }) => { if (live) setConfigured(body.configured === true); }).catch(() => { if (live) setConfigured(false); });
    return () => { live = false; };
  }, []);
  const toggle = async () => {
    setBusy(true); setMessage(null);
    try {
      await configureBackgroundPush(!enabled);
      if (!enabled) await refreshBackgroundPushSchedule(state, reminders);
      setEnabled(!enabled);
      if (enabled) flash(t("Background reminders turned off."));
      else flash(t("Background reminders enabled."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Could not configure background reminders."));
    } finally { setBusy(false); }
  };
  return (
    <section className="set-section">
      <h3 className="kicker">{t("Background notifications")}</h3>
      <div className="set-row">
        <div>
          <p className="set-label">{enabled ? t("Background reminders are on") : t("Remind me while Planner is closed")}</p>
          <p className="set-hint">{!supported ? t("This browser does not support push notifications.") : configured === false ? t("This server needs push keys, a database, and a scheduled delivery job before background reminders can be enabled.") : t("Sends a generic alert at scheduled times. Reminder times are uploaded; task and event titles stay on this device.")}</p>
        </div>
        <button type="button" className={cx('btn', enabled ? 'btn-soft' : 'btn-primary')} disabled={!supported || configured !== true || busy} onClick={() => void toggle()}>
          {busy ? t("Working…") : enabled ? t("Turn off") : t("Enable")}
        </button>
      </div>
      {message ? <p className="set-hint is-error" role="alert">{message}</p> : null}
      {enabled && reminders.enabled ? <p className="set-hint">{t("Your upcoming reminders are refreshed when your planner changes.")}</p> : null}
    </section>
  );
}

function VoiceSection() {
  const { flash } = usePlanner();
  const [localeId, setLocaleId] = useState(() => loadSpeechLocaleId());
  const available = speechAvailable();
  const choose = (id: string) => {
    setLocaleId(id);
    saveSpeechLocaleId(id);
    flash(t("Voice listening updated."));
  };
  return (
    <section className="set-section">
      <h3 className="kicker">{t("Voice")}</h3>
      <div className="set-row">
        <div>
          <p className="set-label">{t("Listening accent")}</p>
          <p className="set-hint">
            {available
              ? t("Pick the accent that sounds most like you. Speech is understood much better when the listener expects it — any accent is welcome.")
              : t("This browser has no speech service, so voice input is unavailable. Typing still works everywhere.")}
          </p>
        </div>
        <label className="field set-select">
          <span className="visually-hidden">{t("Listening accent")}</span>
          <select value={localeId} disabled={!available} onChange={(event) => choose(event.target.value)}>
            {SPEECH_LOCALES.map((locale) => (
              <option key={locale.id} value={locale.id}>{locale.label}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function CalendarSection() {
  const { state, importCalendar, flash, undo, weekStart, setWeekStart, display, setDisplay } = usePlanner();
  const icsFile = useImportFile((text) => {
    const result = parseICS(text);
    const count = result.events.length + result.tasks.length;
    if (count === 0) {
      flash(t("No calendar events found in that file."));
      return;
    }
    importCalendar(result);
    flash(
      result.skipped
        ? t("Imported {0} events and {1} all-day items, skipping {2}.", { 0: result.events.length, 1: result.tasks.length, 2: result.skipped })
        : t("Imported {0} events and {1} all-day items.", { 0: result.events.length, 1: result.tasks.length }),
      { label: t("Undo"), run: undo },
    );
  });
  return (
    <section className="set-section">
      <h3 className="kicker">{t("Calendar, dates & time")}</h3>
      <div className="set-row">
        <div>
          <p className="set-label">{t("Week starts on")}</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("Week starts on")}>
          {([[1, 'Mon'], [0, t("Sun")], [6, t("Sat")]] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={weekStart === value} className={cx('seg', weekStart === value && 'on')} onClick={() => setWeekStart(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <div>
          <p className="set-label">{t("Clock")}</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("Clock format")}>
          {(['24h', '12h'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={display.timeFormat === value} className={cx('seg', display.timeFormat === value && 'on')} onClick={() => setDisplay({ ...display, timeFormat: value })}>
              {value === '24h' ? '14:00' : t("2 pm")}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <div>
          <p className="set-label">{t("Language")}</p>
          <p className="set-hint">{t("Interface language. The page reloads to apply it.")}</p>
        </div>
        <select aria-label={t("Language")} value={getLang()} onChange={(event) => {
          const next = event.target.value as Lang;
          if (next === getLang()) return;
          if (next === 'fa') {
            setDisplay({ ...display, dateLanguage: 'fa' });
            setWeekStart(6);
          } else if (display.dateLanguage === 'fa') {
            setDisplay({ ...display, dateLanguage: 'en-GB' });
          }
          setLang(next);
          window.setTimeout(() => window.location.reload(), 50);
        }}>
          {LANGUAGES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>
      <div className="set-row">
        <div>
          <p className="set-label">{t("Date language")}</p>
          <p className="set-hint">{t("Day and month names.")}</p>
        </div>
        <select aria-label={t("Date language")} value={display.dateLanguage} onChange={(event) => setDisplay({ ...display, dateLanguage: event.target.value as DateLanguage })}>
          {DATE_LANGUAGES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>
      <div className="set-row">
        <div>
          <p className="set-label">{t("Show Jalali dates")}</p>
          <p className="set-hint">{t("Adds the Persian (Jalali) date alongside Gregorian dates.")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(display.jalali)}
          className={cx('btn', 'btn-soft', display.jalali && 'btn-primary')}
          onClick={() => setDisplay({ ...display, jalali: !display.jalali })}
        >
          {display.jalali ? t("On") : t("Off")}
        </button>
      </div>
      <p className="set-hint">{t("Exchange plans with Google Calendar, Outlook or Apple Calendar using .ics files. Timed events come in as events; all-day ones become dated tasks.")}</p>
      <div className="set-actions">
        <button type="button" className="btn btn-soft" onClick={() => { downloadICS(state, todayISO()); flash(t("Calendar file downloaded.")); }}>
          <DownloadIcon size={16} /> {t("Export .ics")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => { downloadBusyICS(state, todayISO()); flash(t("Busy calendar downloaded.")); }}>
          <DownloadIcon size={16} /> {t("Export busy times")}
        </button>
        <button type="button" className="btn btn-soft" onClick={icsFile.open}>
          <UploadIcon size={16} /> {t("Import .ics")}
        </button>
      </div>
      <input ref={icsFile.ref} className="visually-hidden" tabIndex={-1} aria-hidden="true" type="file" accept="text/calendar,.ics" onChange={icsFile.onChange} />
    </section>
  );
}

function InstallSection() {
  const [available, setAvailable] = useState(canInstall());
  useEffect(() => onInstallChange(() => setAvailable(canInstall())), []);
  const installed = isInstalled();
  return (
    <section className="set-section">
      <h3 className="kicker">{t("App")}</h3>
      <div className="set-row">
        <div>
          <p className="set-label">{installed ? t("Installed") : t("Install Planner")}</p>
          <p className="set-hint">
            {installed
              ? t("Running as an app. It opens offline too.")
              : available
                ? t("Add Planner to your home screen or dock. It works offline.")
                : t("Use your browser’s “Install” or “Add to Home Screen” option. Planner works offline once loaded.")}
          </p>
        </div>
        {available && !installed ? (
          <button type="button" className="btn btn-soft" onClick={() => void promptInstall()}>{t("Install")}</button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Who is signed in on this device, and the way out. People look for sign-out
 * in Settings first, so it lives here as well as in the side and More panels.
 * Falls back to the last signed-in user when the vault came from the trusted
 * device cache (offline boots), so the way out never vanishes.
 */
function AccountSection() {
  const user = accountUser();
  const requestSignOut = useSignOut();
  const { requestConfirm, flash } = usePlanner();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleted, setDeleted] = useState(false);

  const requestDelete = () => {
    if (busy || confirmation.trim().toUpperCase() !== 'DELETE' || !password) return;
    requestConfirm({
      title: t("Permanently delete your account?"),
      body: t("This permanently deletes your Planner account, encrypted vault, passkeys, sessions, and guardian links. The planner currently on this device and separate sync-code copies are not deleted. This cannot be undone."),
      confirmLabel: t("Delete account permanently"),
      onConfirm: () => {
        setBusy(true);
        setDeleteError('');
        void deleteAccount(password)
          .then(() => {
            forgetAccountUser();
            setDeleted(true);
            setDeleting(false);
            setPassword('');
            setConfirmation('');
            flash(t("Account deleted. The planner on this device was kept as a local copy."));
          })
          .catch((error: unknown) => setDeleteError(error instanceof Error ? error.message : t("The account could not be deleted.")))
          .finally(() => setBusy(false));
      },
    });
  };

  return (
    <section className="set-section">
      <h3 className="kicker">{t("Account")}</h3>
      {user && !deleted ? (
        <>
          <div className="set-row account-row">
            <span className="account-mark" aria-hidden="true">
              <UserIcon size={17} />
            </span>
            <div>
              <p className="set-label">{user.displayName || user.username}</p>
              <p className="set-hint">{t("Signed in · your planner syncs through its encrypted vault")}</p>
            </div>
            <button type="button" className="btn btn-ghost account-signout" onClick={requestSignOut}>
              <ExitIcon size={15} /> {t("Sign out")}
            </button>
          </div>
          {getActiveSession() ? (
            <div className="set-actions account-delete-actions">
              {!deleting ? (
                <button type="button" className="btn btn-danger" onClick={() => { setDeleting(true); setDeleteError(''); }}>
                  {t("Delete account")}
                </button>
              ) : (
                <div className="account-delete-form">
                  <p className="set-hint">{t("Account deletion is permanent. Your device’s planner stays here as a local copy; export it first if you need a backup.")}</p>
                  <label className="field">
                    <span>{t("Current password")}</span>
                    <input className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>{t("Type DELETE to continue")}</span>
                    <input className="input" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                  </label>
                  {deleteError ? <p className="set-hint is-error" role="alert">{deleteError}</p> : null}
                  <div className="set-actions">
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setDeleting(false); setPassword(''); setConfirmation(''); }}>{t("Cancel")}</button>
                    <button type="button" className="btn btn-danger" disabled={busy || !password || confirmation.trim().toUpperCase() !== 'DELETE'} onClick={requestDelete}>
                      {busy ? t("Deleting…") : t("Delete account permanently")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : user ? (
        <p className="set-hint">{t("Your account has been deleted. The planner on this device remains available as a local copy.")}</p>
      ) : (
        <p className="set-hint">
          {t("No account on this device. Your planner is saved in this browser only; an account keeps it in an encrypted vault you can open anywhere.")}
        </p>
      )}
    </section>
  );
}

export function SettingsSheet() {
  const planner = usePlanner();
  const {
    settingsOpen,
    closeSettings,
    themeMode,
    setThemeMode,
    accent,
    setAccent,
    exportData,
    importText,
    loadSample,
    startFresh,
    requestConfirm,
  } = planner;
  const importFile = useImportFile(importText);
  if (!settingsOpen) return null;

  return (
    <Modal title={t("Settings")} onClose={closeSettings} className="sheet-settings">
      <AccountSection />
      <section className="set-section">
        <h3 className="kicker">{t("Appearance")}</h3>
        <div className="set-row">
          <div>
            <p className="set-label">{t("Theme")}</p>
            <p className="set-hint">{t("Follows your device when set to System.")}</p>
          </div>
          <div className="segmented" role="radiogroup" aria-label={t("Theme")}>
            {(['system', 'light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={themeMode === mode}
                className={cx('seg', themeMode === mode && 'on')}
                onClick={() => setThemeMode(mode)}
              >
                {mode === 'system' ? t("System") : mode === 'light' ? t("Light") : t("Dark")}
              </button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div>
            <p className="set-label">{t("Accent")}</p>
            <p className="set-hint">{t("Used for highlights and progress.")}</p>
          </div>
          <div className="swatches" role="radiogroup" aria-label={t("Accent colour")}>
            {ACCENT_CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={cx('swatch', `accent-${choice.id}`, accent === choice.id && 'on')}
                aria-label={choice.label}
                aria-checked={accent === (choice.id as Accent)}
                role="radio"
                onClick={() => setAccent(choice.id)}
              />
            ))}
          </div>
        </div>
      </section>

      <NavigationSection />
      <SyncSection />
      <SharedSpaceSection />
      <RemindersSection />
      <BackgroundPushSection />
      <VoiceSection />
      <CalendarSection />
      <FeedsSection />
      <TaskImportSection />
      <WeatherSection />
      <TemplatesSection />
      <InstallSection />
      <SecuritySection />
      <section className="set-section">
        <h3 className="kicker">{t("New here?")}</h3>
        <div className="set-row">
          <div>
            <p className="set-label">{t("The two-minute tour")}</p>
            <p className="set-hint">{t("Walks through quick add, planning, habits, mood and notes — with the language picker first.")}</p>
          </div>
          <span className="set-actions">
            <button type="button" className="btn btn-soft" onClick={() => { closeSettings(); window.setTimeout(requestAbout, 60); }}>
              {t("Why Planner?")}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => { closeSettings(); window.setTimeout(requestTour, 60); }}>
              {t("Show me around")}
            </button>
          </span>
        </div>
      </section>

      <section className="set-section">
        <h3 className="kicker">{t("AI coach · Groq")}</h3>
        <p className="set-hint">{t("The planner uses a server-side proxy for Groq. Your API key stays out of the browser and planner backups.")}</p>
        <pre className="env-code"><code>{t("GROQ_API_KEY=your_groq_api_key")}</code></pre>
        <p className="set-hint">
          <Rich
            text={t("On Vercel: Project Settings → Environment Variables → add {name} with your key as the value, then redeploy. Vercel Functions in {path} handle the requests.")}
            values={{ name: <code>{t("GROQ_API_KEY")}</code>, path: <code>{t("api/groq")}</code> }}
          />
        </p>
        <p className="set-hint">
          <Rich
            text={t("Locally: put that line in {file} at the project root, then restart the dev server.")}
            values={{ file: <code>{t(".env.local")}</code> }}
          />
        </p>
        <p className="ai-privacy-note">
          <Rich
            text={t("Never use a {prefix} prefix for the key. The AI sends your prompt, saved AI memory, and relevant schedule/check-in details to Groq; planner notes are not included. Forget memory from the AI coach at any time.")}
            values={{ prefix: <code>{t("VITE_")}</code> }}
          />
        </p>
      </section>

      <section className="set-section">
        <h3 className="kicker">{t("Your data")}</h3>
        <p className="set-hint">{t("Planner data is saved in this browser. With sync on, an encrypted copy is kept in your database; AI requests pass through the server-side Groq proxy.")}</p>
        <div className="set-actions">
          <button type="button" className="btn btn-soft" onClick={exportData}>
            <DownloadIcon size={16} /> {t("Export backup")}
          </button>
          <button type="button" className="btn btn-soft" onClick={importFile.open}>
            <UploadIcon size={16} /> {t("Import backup")}
          </button>
          <button type="button" className="btn btn-soft" onClick={loadSample}>
            <SparklesIcon size={16} /> {t("Load sample day")}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() =>
              requestConfirm({
                title: t("Start fresh?"),
                body: t("This clears the planner in this browser. Export a backup first if you might want the old data."),
                confirmLabel: t("Start fresh"),
                onConfirm: startFresh,
              })
            }
          >
            {t("Start fresh")}
          </button>
        </div>
        <input ref={importFile.ref} className="visually-hidden" tabIndex={-1} aria-hidden="true" type="file" accept="application/json,.json" onChange={importFile.onChange} />
      </section>

      <section className="set-section">
        <h3 className="kicker">{t("Shortcuts")}</h3>
        <ul className="shortcut-list">
          <li><span>{t("Search & quick add")}</span><span><kbd className="kbd">⌘</kbd><kbd className="kbd">K</kbd></span></li>
          <li><span>{t("New task")}</span><span><kbd className="kbd">N</kbd></span></li>
          <li><span>{t("Go to Today")}</span><span><kbd className="kbd">T</kbd></span></li>
          <li><span>{t("Undo / redo")}</span><span><kbd className="kbd">⌘</kbd><kbd className="kbd">Z</kbd></span></li>
          <li><span>{t("Close anything")}</span><span><kbd className="kbd">{t('esc')}</kbd></span></li>
          <li><span>{t("Open shortcuts")}</span><span><kbd className="kbd">?</kbd></span></li>
        </ul>
      </section>

      <p className="set-foot">{t("Personal Planner · local-first · made for calm days")}</p>
    </Modal>
  );
}
