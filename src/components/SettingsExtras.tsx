import { useRef, useState } from 'react';
import { cx } from '../cx';
import { usePlanner } from '../context';
import { UploadIcon } from '../icons';
import { parseTaskCSV } from '../importers';
import { displayTime, formatEdited } from '../dates';
import { geocode } from '../weather';
import { loadTemplates, removeTemplate, saveTemplates, type PlannerTemplate } from '../templates';
import { t } from '../i18n';

/**
 * The smaller settings sections: shared space, calendar feeds, weather,
 * task import and templates. Split out of SettingsSheet to keep it readable;
 * all the heavy lifting lives in context actions and the feature modules.
 */

// ── Shared space ────────────────────────────────────────────────────────

export function SharedSpaceSection() {
  const { shared, sharedStatus, sharedMessage, startShared, stopShared, syncSharedNow, flash } = usePlanner();
  const [linking, setLinking] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const linked = shared.code !== null;

  const statusText =
    sharedStatus === 'syncing'
      ? t("Syncing…")
      : sharedStatus === 'offline'
        ? t("Offline — changes will sync when you reconnect.")
        : sharedStatus === 'error'
          ? sharedMessage ?? t("Sync failed.")
          : shared.lastSyncedAt
            ? t("Up to date · {0}", { 0: formatEdited(shared.lastSyncedAt) })
            : t("Ready — waiting for the first sync.");

  const sharedCode = shared.code ?? '';
  const copy = async () => {
    if (!sharedCode) return;
    try {
      await navigator.clipboard.writeText(sharedCode);
      flash(t("Code copied. Keep it private."));
    } catch {
      flash(t("Couldn't copy"));
    }
  };

  return (
    <section className="set-section">
      <h3 className="kicker">{t("Shared space")}</h3>
      <p className="set-hint">
        {t("A second, separate sync room just for the Shared category. Put a task, event or note in the Shared category and it appears on every device that knows this room's code — perfect for a grocery list or a household plan. Same end-to-end encryption: the code never leaves your devices.")}
      </p>
      {linked ? (
        <>
          <div className="set-row">
            <div>
              <p className="set-label">{t("Shared space is on")}</p>
              <p className={cx('set-hint', sharedStatus === 'error' && 'is-error')} role="status" aria-live="polite">
                {statusText}
              </p>
            </div>
            <button type="button" className="btn btn-soft" onClick={syncSharedNow} disabled={sharedStatus === 'syncing'}>
              {t("Sync now")}
            </button>
          </div>
          <div className="sync-code-box">
            <p className="set-hint">{t("Enter this shared code on the other devices. Anyone with it can read and change the shared items — share it only with your people.")}</p>
            <div className="sync-code-row">
              <code className="sync-code" aria-label={t("Shared code")}>{reveal ? sharedCode : sharedCode.replace(/[A-Z0-9]/g, '•')}</code>
              <button type="button" className="btn btn-tiny" onClick={() => setReveal((value) => !value)}>
                {reveal ? t("Hide") : t("Show")}
              </button>
              <button type="button" className="btn btn-tiny" onClick={() => void copy()}>
                {t("Copy")}
              </button>
            </div>
          </div>
          <div className="set-actions">
            <button type="button" className="btn btn-ghost" onClick={stopShared}>
              {t("Leave shared space")}
            </button>
          </div>
        </>
      ) : linking ? (
        <form
          className="sync-link"
          onSubmit={(event) => {
            event.preventDefault();
            const created = startShared(code);
            if (created) {
              setCode('');
              setLinking(false);
              setError(null);
              flash(t("Shared space linked."));
            } else {
              setError(t("That code doesn't look right — it should be the 24-letter code from the other device."));
            }
          }}
        >
          <label>
            <span className="visually-hidden">{t("Shared code")}</span>
            <input
              value={code}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={t("Paste the shared code here")}
              onChange={(event) => {
                setCode(event.target.value);
                setError(null);
              }}
            />
          </label>
          {error ? (
            <p className="set-hint is-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="set-actions">
            <button type="submit" className="btn btn-primary" disabled={!code.trim()}>
              {t("Link")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setLinking(false); setCode(''); setError(null); }}>
              {t("Cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="set-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const created = startShared();
              if (created) {
                setReveal(true);
                // Clipboard can be missing entirely (older browsers, embedded
                // webviews, test engines) — fall back to the reveal instead of crashing.
                const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
                if (clipboard?.writeText) {
                  void clipboard.writeText(created).then(
                    () => flash(t("Shared space created — code copied to your clipboard.")),
                    () => flash(t("Shared space created. Tap Show to see the code.")),
                  );
                } else {
                  flash(t("Shared space created. Tap Show to see the code."));
                }
              }
            }}
          >
            {t("Create a shared space")}
          </button>
          <button type="button" className="btn btn-soft" onClick={() => setLinking(true)}>
            {t("Join with a code")}
          </button>
        </div>
      )}
    </section>
  );
}

// ── Calendar feeds ──────────────────────────────────────────────────────

export function FeedsSection() {
  const { feeds, addFeed, removeFeed, refreshFeeds, flash } = usePlanner();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="set-section">
      <h3 className="kicker">{t("Calendar feeds")}</h3>
      <p className="set-hint">
        {t("Subscribe to an iCalendar (.ics) URL — Google Calendar's secret address, an Outlook published calendar, a school or team schedule. Events are mirrored read-only and refreshed automatically; your own categories and notes on them stay yours.")}
      </p>
      {feeds.length < 10 ? (
        <form
          className="sync-link"
          onSubmit={(event) => {
            event.preventDefault();
            if (!url.trim()) return;
            setBusy(true);
            setError(null);
            void addFeed(url.trim())
              .then((failure) => {
                if (failure) {
                  setError(failure);
                } else {
                  setUrl('');
                  flash(t("Feed added — first events are on your calendar."));
                }
              })
              .finally(() => setBusy(false));
          }}
        >
          <label>
            <span className="visually-hidden">{t("Feed URL")}</span>
            <input
              value={url}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("https://calendar.example.com/feed.ics")}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
            />
          </label>
          {error ? (
            <p className="set-hint is-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="set-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
              {busy ? t("Adding…") : t("Add feed")}
            </button>
          </div>
        </form>
      ) : null}
      {feeds.length > 0 ? (
        <ul className="feed-list">
          {feeds.map((feed) => (
            <li key={feed.url} className="feed-item">
              <div className="feed-copy">
                <strong className="feed-url" title={feed.url}>{feed.url.replace(/^https?:\/\//i, '')}</strong>
                <small className={cx('set-hint', feed.lastError && 'is-error')}>
                  {feed.lastError
                    ? feed.lastError
                    : t("{0} {1}{2}", {
                        0: feed.count,
                        1: feed.count === 1 ? t("event") : t("events"),
                        2: feed.lastFetchedAt ? ` · ${displayTime(feed.lastFetchedAt.slice(11, 16))}` : '',
                      })}
                </small>
              </div>
              <button type="button" className="btn btn-tiny" onClick={() => refreshFeeds(true)}>
                {t("Refresh")}
              </button>
              <button
                type="button"
                className="btn btn-tiny danger"
                onClick={() => {
                  removeFeed(feed.url);
                  flash(t("Feed removed — its events left the calendar."));
                }}
              >
                {t("Remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ── Weather on Today ────────────────────────────────────────────────────

export function WeatherSection() {
  const { weather, setWeather, flash } = usePlanner();
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    const query = place.trim();
    if (!query) return;
    setBusy(true);
    setError(null);
    try {
      const hit = await geocode(query);
      if (!hit) {
        setError(t("No place found with that name."));
        return;
      }
      setWeather({ enabled: true, lat: hit.lat, lon: hit.lon, place: hit.label });
      setPlace('');
      flash(t("Weather on — {0} appears on Today.", { 0: hit.label }));
    } catch {
      setError(t("Couldn't look up places right now."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="set-section">
      <h3 className="kicker">{t("Weather on Today")}</h3>
      <p className="set-hint">
        {t("A small forecast line on the Today page, powered by Open-Meteo — free, no account, no key. Pick a place once; Planner only ever loads the weather, never your location history.")}
      </p>
      <div className="set-row">
        <div>
          <p className="set-label">{t("Show weather")}</p>
          {weather.place ? <p className="set-hint">{t("Place: {0}", { 0: weather.place })}</p> : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={weather.enabled}
          className={cx('btn', 'btn-soft', weather.enabled && 'btn-primary')}
          onClick={() => setWeather({ ...weather, enabled: !weather.enabled })}
        >
          {weather.enabled ? t("On") : t("Off")}
        </button>
      </div>
      <form
        className="sync-link"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup();
        }}
      >
        <label>
          <span className="visually-hidden">{t("Town or city")}</span>
          <input
            value={place}
            placeholder={t("Town or city — e.g. Helsinki")}
            onChange={(event) => {
              setPlace(event.target.value);
              setError(null);
            }}
          />
        </label>
        {error ? (
          <p className="set-hint is-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="set-actions">
          <button type="submit" className="btn btn-soft" disabled={busy || !place.trim()}>
            {busy ? t("Looking…") : t("Use this place")}
          </button>
          {weather.place ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setWeather({ enabled: false, lat: null, lon: null, place: '' });
                flash(t("Weather cleared."));
              }}
            >
              {t("Clear place")}
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

// ── Import tasks (CSV) ──────────────────────────────────────────────────

export function TaskImportSection() {
  const { importTaskList, flash } = usePlanner();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="set-section">
      <h3 className="kicker">{t("Move your tasks in")}</h3>
      <p className="set-hint">
        {t("Import a CSV export from Todoist or TickTick, or any CSV with a task-title column. Done items are skipped, dates and priorities come along.")}
      </p>
      <div className="set-actions">
        <button type="button" className={cx('btn', 'btn-soft', busy && 'is-disabled')} disabled={busy} onClick={() => fileRef.current?.click()}>
          <UploadIcon size={16} /> {busy ? t("Importing…") : t("Choose a .csv file")}
        </button>
      </div>
      <input
        ref={fileRef}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setBusy(true);
          void file
            .text()
            .then((text) => {
              const result = parseTaskCSV(text);
              if (result.tasks.length === 0) {
                flash(t("Couldn't find any open tasks in that file."));
                return;
              }
              importTaskList(result.tasks);
              flash(
                t("Imported {0} {1}{2}.", {
                  0: result.tasks.length,
                  1: result.tasks.length === 1 ? t("task") : t("tasks"),
                  2: result.done > 0 ? t(" ({0} already-done {1} skipped)", { 0: result.done, 1: result.done === 1 ? t("task") : t("tasks") }) : '',
                }),
              );
            })
            .catch(() => flash(t("Couldn't read that file.")))
            .finally(() => setBusy(false));
        }}
      />
    </section>
  );
}

// ── Templates ───────────────────────────────────────────────────────────

export function TemplatesSection() {
  const { flash } = usePlanner();
  const [templates, setTemplates] = useState<PlannerTemplate[]>(() => loadTemplates());

  return (
    <section className="set-section">
      <h3 className="kicker">{t("Templates")}</h3>
      <p className="set-hint">
        {t("Blueprints you can stamp into new tasks and notes. Save your own from the task or note form with “Save as template”.")}
      </p>
      {templates.length === 0 ? (
        <p className="empty-inline">{t("No templates yet.")}</p>
      ) : (
        <ul className="feed-list">
          {templates.map((template) => (
            <li key={template.id} className="feed-item">
              <div className="feed-copy">
                <strong>{template.title}</strong>
                <small className="set-hint">
                  {template.type === 'task'
                    ? t("Task · {0} {1}", { 0: template.subtasks.length, 1: template.subtasks.length === 1 ? t("step") : t("steps") })
                    : t("Note")}
                </small>
              </div>
              <button
                type="button"
                className="btn btn-tiny danger"
                onClick={() => {
                  const next = removeTemplate(templates, template.id);
                  saveTemplates(next);
                  setTemplates(next);
                  flash(t("Template “{0}” removed.", { 0: template.title }));
                }}
              >
                {t("Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
