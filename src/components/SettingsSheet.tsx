import { ACCENT_CHOICES, type Accent } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { useImportFile } from '../hooks';
import { DownloadIcon, SparklesIcon, UploadIcon } from '../icons';
import { Modal } from './ui';
import { useEffect, useState } from 'react';
import { todayISO } from '../dates';
import { downloadICS, parseICS } from '../ics';
import { canInstall, isInstalled, onInstallChange, promptInstall } from '../pwa';
import { LEAD_CHOICES } from '../reminders';

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
  const { state, importCalendar, flash, undo, weekStart, setWeekStart } = usePlanner();
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
      <h3 className="kicker">Calendar</h3>
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
        <p className="set-hint">Planner data stays in this browser. Only AI requests pass through the server-side xAI proxy.</p>
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
