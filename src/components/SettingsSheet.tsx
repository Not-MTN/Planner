import { ACCENT_CHOICES, type Accent } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { useImportFile } from '../hooks';
import { DownloadIcon, SparklesIcon, UploadIcon } from '../icons';
import { Modal } from './ui';
import { useEffect, useState } from 'react';
import { DATE_LANGUAGES, todayISO, type DateLanguage } from '../dates';
import { downloadBusyICS, downloadICS, parseICS } from '../ics';
import { canInstall, isInstalled, onInstallChange, promptInstall } from '../pwa';
import { LEAD_CHOICES } from '../reminders';
import { t, getLang, setLang, LANGUAGES, type Lang } from '../i18n';

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
          {t("Sync needs a database. Add")} <code>{t("DATABASE_URL")}</code> {t("(your Neon connection string) under Vercel → Environment Variables, or in")} <code>{t(".env.local")}</code>{t(", then restart.")}
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
    flash(t("Imported {0} events and {1} all-day items{2}.", { 0: result.events.length, 1: result.tasks.length, 2: result.skipped ? t(" ({0} skipped)", { 0: result.skipped }) : '' }), { label: t("Undo"), run: undo });
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

      <SyncSection />
      <RemindersSection />
      <CalendarSection />
      <InstallSection />

      <section className="set-section">
        <h3 className="kicker">{t("AI coach · xAI")}</h3>
        <p className="set-hint">{t("The planner uses a server-side proxy for xAI (Grok). Your API key stays out of the browser and planner backups.")}</p>
        <pre className="env-code"><code>{t("XAI_API_KEY=your_xai_api_key")}</code></pre>
        <p className="set-hint"><strong>{t("On Vercel:")}</strong> {t("Project Settings → Environment Variables → add")} <code>{t("XAI_API_KEY")}</code> {t("with your key as the value, then redeploy. Vercel Functions in")} <code>{t("api/xai")}</code> {t("handle the requests.")}</p>
        <p className="set-hint"><strong>{t("Locally:")}</strong> {t("put that line in")} <code>{t(".env.local")}</code> {t("at the project root, then restart the dev server.")}</p>
        <p className="ai-privacy-note">{t("Never use a")} <code>{t("VITE_")}</code> {t("prefix for the key. The AI sends your prompt and relevant schedule/check-in details to xAI; planner notes are not included.")}</p>
      </section>

      <section className="set-section">
        <h3 className="kicker">{t("Your data")}</h3>
        <p className="set-hint">{t("Planner data is saved in this browser. With sync on, an encrypted copy is kept in your database; AI requests pass through the server-side xAI proxy.")}</p>
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
