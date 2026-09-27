import { ACCENT_CHOICES, type Accent } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { useImportFile } from '../hooks';
import { DownloadIcon, SparklesIcon, UploadIcon } from '../icons';
import { Modal } from './ui';
import { useEffect, useState } from 'react';
import { DATE_LANGUAGES, todayISO, type DateLanguage } from '../dates';
import { downloadICS, parseICS } from '../ics';
import { canInstall, isInstalled, onInstallChange, promptInstall } from '../pwa';
import { LEAD_CHOICES } from '../reminders';

function SyncSection() {
  const { sync, syncStatus, syncMessage, syncAvailable, startSync, stopSync, syncNow, deleteCloudCopy, requestConfirm, flash } = usePlanner();
  const [linking, setLinking] = useState(false);
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  const statusText =
    syncStatus === 'syncing' ? 'Syncing…'
      : syncStatus === 'offline' ? 'Offline — changes will sync when you reconnect.'
        : syncStatus === 'error' ? syncMessage ?? 'Sync failed.'
          : sync.dirty ? 'Changes waiting to upload…'
            : sync.lastSyncedAt ? `Up to date · ${new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Connecting…';

  return (
    <section className="set-section">
      <h3 className="kicker">Sync across devices</h3>
      {syncAvailable === false ? (
        <p className="set-hint">
          Sync needs a database. Add <code>DATABASE_URL</code> (your Neon connection string) under Vercel → Environment Variables, or in <code>.env.local</code>, then restart.
        </p>
      ) : null}
      {sync.code ? (
        <>
          <div className="set-row">
            <div>
              <p className="set-label">Sync is on</p>
              <p className={cx('set-hint', syncStatus === 'error' && 'is-error')} role="status" aria-live="polite">{statusText}</p>
            </div>
            <button type="button" className="btn btn-soft" onClick={syncNow} disabled={syncStatus === 'syncing'}>Sync now</button>
          </div>
          <div className="sync-code-box">
            <p className="set-hint">Enter this code on another device to link it. Anyone with the code can read your planner, so keep it private.</p>
            <div className="sync-code-row">
              <code className="sync-code" aria-label="Sync code">{reveal ? sync.code : sync.code.replace(/[A-Z0-9]/g, '•')}</code>
              <button type="button" className="btn btn-tiny" onClick={() => setReveal((value) => !value)}>{reveal ? 'Hide' : 'Show'}</button>
              <button
                type="button"
                className="btn btn-tiny"
                onClick={() => {
                  void navigator.clipboard?.writeText(sync.code ?? '').then(() => flash('Sync code copied.'), () => setReveal(true));
                }}
              >
                Copy
              </button>
            </div>
          </div>
          <div className="set-actions">
            <button type="button" className="btn btn-ghost" onClick={stopSync}>Turn off on this device</button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() =>
                requestConfirm({
                  title: 'Delete the cloud copy?',
                  body: 'This removes the encrypted copy from the database and turns sync off. Every device keeps its own local planner.',
                  confirmLabel: 'Delete cloud copy',
                  onConfirm: () => void deleteCloudCopy(),
                })
              }
            >
              Delete cloud copy
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="set-hint">Keep your planner in step across your phone and computer. It's encrypted on this device before upload — the server only ever sees scrambled data.</p>
          {linking ? (
            <form
              className="sync-link"
              onSubmit={(event) => {
                event.preventDefault();
                const code = startSync(entry);
                if (!code) {
                  setEntryError('That code doesn’t look right — it has 20 letters and numbers.');
                  return;
                }
                flash('Device linked. Merging your planners…');
                setLinking(false);
              }}
            >
              <input
                value={entry}
                onChange={(event) => {
                  setEntry(event.target.value);
                  setEntryError(null);
                }}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                aria-label="Sync code from your other device"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn btn-primary">Link</button>
              <button type="button" className="btn btn-ghost" onClick={() => setLinking(false)}>Cancel</button>
              {entryError ? <p className="set-hint is-error">{entryError}</p> : null}
            </form>
          ) : (
            <div className="set-actions">
              <button type="button" className="btn btn-primary" disabled={syncAvailable === false} onClick={() => { startSync(); setReveal(true); }}>
                Turn on sync
              </button>
              <button type="button" className="btn btn-soft" disabled={syncAvailable === false} onClick={() => setLinking(true)}>
                I have a code
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
      if (result === 'denied') flash('Notifications are blocked — reminders will show inside the app instead.');
    }
    setReminders({ ...reminders, enabled: on });
  };

  return (
    <section className="set-section">
      <h3 className="kicker">Reminders</h3>
      <div className="set-row">
        <div>
          <p className="set-label">Remind me</p>
          <p className="set-hint">
            {!supported
              ? 'This browser has no notifications; reminders appear inside the app while it is open.'
              : permission === 'denied'
                ? 'Notifications are blocked in your browser. Reminders show inside the app while it is open.'
                : 'Before events and timed tasks. Works while Planner is open (or installed).'}
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Reminders">
          <button type="button" role="radio" aria-checked={!reminders.enabled} className={cx('seg', !reminders.enabled && 'on')} onClick={() => void enable(false)}>Off</button>
          <button type="button" role="radio" aria-checked={reminders.enabled} className={cx('seg', reminders.enabled && 'on')} onClick={() => void enable(true)}>On</button>
        </div>
      </div>
      {reminders.enabled ? (
        <>
          <div className="set-row">
            <div>
              <p className="set-label">How early</p>
            </div>
            <select
              aria-label="Minutes before"
              value={reminders.lead}
              onChange={(event) => setReminders({ ...reminders, lead: Number(event.target.value) })}
            >
              {LEAD_CHOICES.map((minutes) => (
                <option key={minutes} value={minutes}>{minutes === 0 ? 'At start time' : `${minutes} min before`}</option>
              ))}
            </select>
          </div>
          <div className="set-row">
            <div>
              <p className="set-label">Morning summary</p>
              <p className="set-hint">A short “here’s your day” note.</p>
            </div>
            <div className="set-inline">
              <input
                type="checkbox"
                aria-label="Morning summary"
                checked={reminders.digest}
                onChange={(event) => setReminders({ ...reminders, digest: event.target.checked })}
              />
              <input
                type="time"
                aria-label="Summary time"
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
      flash('No calendar events found in that file.');
      return;
    }
    importCalendar(result);
    flash(`Imported ${result.events.length} events and ${result.tasks.length} all-day items${result.skipped ? ` (${result.skipped} skipped)` : ''}.`, { label: 'Undo', run: undo });
  });
  return (
    <section className="set-section">
      <h3 className="kicker">Calendar, dates &amp; time</h3>
      <div className="set-row">
        <div>
          <p className="set-label">Week starts on</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Week starts on">
          {([[1, 'Mon'], [0, 'Sun'], [6, 'Sat']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={weekStart === value} className={cx('seg', weekStart === value && 'on')} onClick={() => setWeekStart(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <div>
          <p className="set-label">Clock</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Clock format">
          {(['24h', '12h'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={display.timeFormat === value} className={cx('seg', display.timeFormat === value && 'on')} onClick={() => setDisplay({ ...display, timeFormat: value })}>
              {value === '24h' ? '14:00' : '2 pm'}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <div>
          <p className="set-label">Date language</p>
          <p className="set-hint">Day and month names.</p>
        </div>
        <select aria-label="Date language" value={display.dateLanguage} onChange={(event) => setDisplay({ ...display, dateLanguage: event.target.value as DateLanguage })}>
          {DATE_LANGUAGES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>
      <p className="set-hint">Exchange plans with Google Calendar, Outlook or Apple Calendar using .ics files. Timed events come in as events; all-day ones become dated tasks.</p>
      <div className="set-actions">
        <button type="button" className="btn btn-soft" onClick={() => { downloadICS(state, todayISO()); flash('Calendar file downloaded.'); }}>
          <DownloadIcon size={16} /> Export .ics
        </button>
        <button type="button" className="btn btn-soft" onClick={icsFile.open}>
          <UploadIcon size={16} /> Import .ics
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
      <h3 className="kicker">App</h3>
      <div className="set-row">
        <div>
          <p className="set-label">{installed ? 'Installed' : 'Install Planner'}</p>
          <p className="set-hint">
            {installed
              ? 'Running as an app. It opens offline too.'
              : available
                ? 'Add Planner to your home screen or dock. It works offline.'
                : 'Use your browser’s “Install” or “Add to Home Screen” option. Planner works offline once loaded.'}
          </p>
        </div>
        {available && !installed ? (
          <button type="button" className="btn btn-soft" onClick={() => void promptInstall()}>Install</button>
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
    <Modal title="Settings" onClose={closeSettings} className="sheet-settings">
      <section className="set-section">
        <h3 className="kicker">Appearance</h3>
        <div className="set-row">
          <div>
            <p className="set-label">Theme</p>
            <p className="set-hint">Follows your device when set to System.</p>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={themeMode === mode}
                className={cx('seg', themeMode === mode && 'on')}
                onClick={() => setThemeMode(mode)}
              >
                {mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div>
            <p className="set-label">Accent</p>
            <p className="set-hint">Used for highlights and progress.</p>
          </div>
          <div className="swatches" role="radiogroup" aria-label="Accent colour">
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
        <h3 className="kicker">AI coach · xAI</h3>
        <p className="set-hint">The planner uses a server-side proxy for xAI (Grok). Your API key stays out of the browser and planner backups.</p>
        <pre className="env-code"><code>XAI_API_KEY=your_xai_api_key</code></pre>
        <p className="set-hint"><strong>On Vercel:</strong> Project Settings → Environment Variables → add <code>XAI_API_KEY</code> with your key as the value, then redeploy. Vercel Functions in <code>api/xai</code> handle the requests.</p>
        <p className="set-hint"><strong>Locally:</strong> put that line in <code>.env.local</code> at the project root, then restart the dev server.</p>
        <p className="ai-privacy-note">Never use a <code>VITE_</code> prefix for the key. The AI sends your prompt and relevant schedule/check-in details to xAI; planner notes are not included.</p>
      </section>

      <section className="set-section">
        <h3 className="kicker">Your data</h3>
        <p className="set-hint">Planner data is saved in this browser. With sync on, an encrypted copy is kept in your database; AI requests pass through the server-side xAI proxy.</p>
        <div className="set-actions">
          <button type="button" className="btn btn-soft" onClick={exportData}>
            <DownloadIcon size={16} /> Export backup
          </button>
          <button type="button" className="btn btn-soft" onClick={importFile.open}>
            <UploadIcon size={16} /> Import backup
          </button>
          <button type="button" className="btn btn-soft" onClick={loadSample}>
            <SparklesIcon size={16} /> Load sample day
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() =>
              requestConfirm({
                title: 'Start fresh?',
                body: 'This clears the planner in this browser. Export a backup first if you might want the old data.',
                confirmLabel: 'Start fresh',
                onConfirm: startFresh,
              })
            }
          >
            Start fresh
          </button>
        </div>
        <input ref={importFile.ref} className="visually-hidden" tabIndex={-1} aria-hidden="true" type="file" accept="application/json,.json" onChange={importFile.onChange} />
      </section>

      <section className="set-section">
        <h3 className="kicker">Shortcuts</h3>
        <ul className="shortcut-list">
          <li><span>Search &amp; quick add</span><span><kbd className="kbd">⌘</kbd><kbd className="kbd">K</kbd></span></li>
          <li><span>New task</span><span><kbd className="kbd">N</kbd></span></li>
          <li><span>Go to Today</span><span><kbd className="kbd">T</kbd></span></li>
          <li><span>Undo / redo</span><span><kbd className="kbd">⌘</kbd><kbd className="kbd">Z</kbd></span></li>
          <li><span>Close anything</span><span><kbd className="kbd">esc</kbd></span></li>
        </ul>
      </section>

      <p className="set-foot">Personal Planner · local-first · made for calm days</p>
    </Modal>
  );
}
