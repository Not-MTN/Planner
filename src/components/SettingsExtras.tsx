import { useEffect, useRef, useState } from 'react';
import { cx } from '../cx';
import { usePlanner } from '../context';
import { UploadIcon } from '../icons';
import { parseTaskCSV } from '../importers';
import { parseSyllabus, syllabusToTasks, type SyllabusParse } from '../syllabus';
import { KEEP_EVERYTHING, RETENTION_CHOICES } from '../retention';
import { displayTime, formatEdited, formatFullDate, formatStamp, todayISO } from '../dates';
import { geocode } from '../weather';
import { loadTemplates, removeTemplate, saveTemplates, type PlannerTemplate } from '../templates';
import { PasskeyError, listPasskeys, passkeysSupported, registerPasskey, removePasskey, type ListedPasskey } from '../auth/passkey';
import { AuthError } from '../auth/session';
import { t, tn } from '../i18n';

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
                    : `${tn(feed.count, "{count} event", "{count} events")}${
                        feed.lastFetchedAt ? ` · ${displayTime(feed.lastFetchedAt.slice(11, 16))}` : ''
                      }`}
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
        <button type="button" className="btn btn-soft" disabled={busy} onClick={() => fileRef.current?.click()}>
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
                result.done > 0
                  ? tn(result.tasks.length, "Imported {count} task, skipping {done} already done.", "Imported {count} tasks, skipping {done} already done.", { done: result.done })
                  : tn(result.tasks.length, "Imported {count} task.", "Imported {count} tasks."),
              );
            })
            .catch(() => flash(t("Couldn't read that file.")))
            .finally(() => setBusy(false));
        }}
      />
    </section>
  );
}

// ── Retention window ─────────────────────────────────────────────────────

/**
 * How long detail is kept.
 *
 * The window is the whole promise of §11 made visible: inside it nothing is
 * touched, outside it a week becomes numbers. The section states plainly what
 * happens, because "your data may be pruned" is not something anyone should
 * have to infer from a changelog — and it counts what has been rolled up so far
 * so the setting is checkable rather than merely believed.
 */
export function RetentionSection() {
  const { retentionWeeks, setRetentionWeeks, state } = usePlanner();
  const archived = state.archives?.length ?? 0;

  return (
    <section className="set-section">
      <h3 className="kicker">{t('How long detail is kept')}</h3>
      <p className="set-hint">
        {t('Weeks inside the window keep everything — notes, reasons, focus sessions. Older weeks keep their results and lose the detail behind them. Anything unfinished or in the future is never touched.')}
      </p>
      <div className="segmented" role="radiogroup" aria-label={t('How long detail is kept')}>
        {RETENTION_CHOICES.map((weeks) => (
          <button
            key={weeks}
            type="button"
            role="radio"
            aria-checked={retentionWeeks === weeks}
            className={cx('seg', retentionWeeks === weeks && 'on')}
            onClick={() => setRetentionWeeks(weeks)}
          >
            {weeks === 1 ? t('1 week') : t('{0} weeks', { 0: weeks })}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={retentionWeeks === KEEP_EVERYTHING}
          className={cx('seg', retentionWeeks === KEEP_EVERYTHING && 'on')}
          onClick={() => setRetentionWeeks(KEEP_EVERYTHING)}
        >
          {t('Keep everything')}
        </button>
      </div>
      {retentionWeeks === KEEP_EVERYTHING ? (
        <p className="set-hint">
          {t('Keeping everything means the vault keeps growing: a busy year is a few megabytes, and cloud sync has a 3 MB cap. Export a backup now and then.')}
        </p>
      ) : null}
      <p className="set-hint">
        {archived > 0
          ? tn(archived, '{count} week has been rolled up so far — numbers only, never your notes.', '{count} weeks have been rolled up so far — numbers only, never your notes.')
          : t('Nothing has been rolled up yet.')}
      </p>
    </section>
  );
}

// ── Syllabus → term plan ─────────────────────────────────────────────────

/**
 * A pasted syllabus becomes a term plan.
 *
 * The reading happens in `syllabus.ts`, which returns the weeks and the
 * assessments it understood and counts what it did not. This section shows
 * that reading back before anything is added — a term plan is a dozen tasks
 * appearing at once, and a wrong week is much cheaper to catch here than in
 * the calendar. Nothing reaches the planner until "Add to planner".
 */
export function SyllabusSection() {
  const { state, importTaskList, flash } = usePlanner();
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [parsed, setParsed] = useState<SyllabusParse | null>(null);
  const [reading, setReading] = useState(false);
  const subjects = state.panels.student.subjects;

  const read = () => {
    setReading(true);
    // Reading is synchronous — the flag exists so a long paste cannot feel
    // like a dead button, not because there is anything to await.
    const result = parseSyllabus(text, todayISO());
    setReading(false);
    if (result.weeks.length === 0 && result.assessments.length === 0) {
      setParsed(null);
      flash(t('Nothing in that text looked like a term plan. A week line has to say which week it is.'));
      return;
    }
    setParsed(result);
  };

  const add = () => {
    if (!parsed) return;
    importTaskList(syllabusToTasks(parsed, { subject, category: 'learning', weeklyMinutes: 60 }));
    setParsed(null);
    setText('');
  };

  return (
    <section className="set-section">
      <h3 className="kicker">{t('Plan a term from a syllabus')}</h3>
      <p className="set-hint">
        {t('Paste a course outline and each teaching week becomes a task, each dated exam or assignment its own. Nothing is added until you press Add.')}
      </p>
      <div className="field">
        <textarea
          dir="auto"
          rows={6}
          value={text}
          placeholder={t('Paste the syllabus here')}
          aria-label={t('Paste the syllabus here')}
          onChange={(event) => {
            setText(event.target.value);
            setParsed(null);
          }}
        />
      </div>
      <div className="set-row">
        <div className="field">
          <p className="set-label">{t('Subject (optional)')}</p>
          <input
            value={subject}
            list="syllabus-subjects"
            aria-label={t('Subject (optional)')}
            placeholder={t('Physics')}
            onChange={(event) => setSubject(event.target.value)}
          />
          <datalist id="syllabus-subjects">
            {subjects.map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
        </div>
        <span className="set-actions">
          <button type="button" className="btn btn-soft" disabled={reading || text.trim() === ''} onClick={read}>
            {reading ? t('Reading the syllabus…') : t('Read the syllabus')}
          </button>
        </span>
      </div>

      {parsed ? (
        <div className="syllabus-preview" role="status">
          <p className="set-label">
            {t('Syllabus read: {0} and {1}.', {
              0: tn(parsed.weeks.length, '{count} teaching week', '{count} teaching weeks'),
              1: tn(parsed.assessments.length, '{count} assessment', '{count} assessments'),
            })}
          </p>
          {parsed.weeks.length > 0 ? (
            <ul className="feed-list">
              {parsed.weeks.slice(0, 8).map((week) => (
                <li key={week.week} className="feed-item">
                  <div className="feed-copy">
                    <strong>{t('Week {0}', { 0: week.week })}</strong>
                    <small className="set-hint">
                      {[week.title, week.start ? formatFullDate(week.start) : null].filter(Boolean).join(' · ')}
                    </small>
                  </div>
                </li>
              ))}
              {parsed.weeks.length > 8 ? (
                <li className="feed-item">
                  <small className="set-hint">{tn(parsed.weeks.length - 8, '{count} more week', '{count} more weeks')}</small>
                </li>
              ) : null}
            </ul>
          ) : null}
          {parsed.assessments.length > 0 ? (
            <ul className="feed-list">
              {parsed.assessments.map((item, index) => (
                <li key={`${item.title}-${index}`} className="feed-item">
                  <div className="feed-copy">
                    <strong>{item.title}</strong>
                    <small className="set-hint">
                      {[item.date ? formatFullDate(item.date) : t('No date'), item.weight !== null ? t('{0}% of the grade', { 0: item.weight }) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {parsed.unread > 0 ? (
            <p className="set-hint">{tn(parsed.unread, '{count} dated line was left out — only lines that name their week become weeks.', '{count} dated lines were left out — only lines that name their week become weeks.')}</p>
          ) : null}
          <p className="set-hint">{t('Dates such as 05/03 are read as day/month. Check the dates on the calendar after adding.')}</p>
          <div className="set-actions">
            <button type="button" className="btn btn-primary" onClick={add}>
              {t('Add to planner')}
            </button>
          </div>
        </div>
      ) : null}
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

// ── Passkeys ───────────────────────────────────────────────────────────

/** Best sentence for a failed passkey action: the server's, then the specific local cause. */
function passkeyNote(caught: unknown): string {
  if (caught instanceof AuthError) return caught.detail ?? t("Something went wrong with that change.");
  if (caught instanceof PasskeyError) {
    if (caught.code === 'no_prf') return t("This browser's passkeys cannot open the planner — your password still will.");
    if (caught.code === 'cancelled') return t("Cancelled — nothing was added.");
    if (caught.code === 'unsupported') return t("Passkeys need a modern browser on a secure connection.");
    if (caught.code === 'no_session') return t("That session has expired. Please sign in again.");
    return t("Something went wrong with that change.");
  }
  return t("Something went wrong with that change.");
}

/**
 * Settings → Security: list, add and remove the account's passkeys. The
 * ladder after a trusted device — a passkey still beats losing the recovery
 * key. Hidden entirely where WebAuthn is unavailable.
 */
export function SecuritySection() {
  const { flash } = usePlanner();
  const [rows, setRows] = useState<ListedPasskey[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = passkeysSupported();

  const refresh = async () => {
    setRows(await listPasskeys());
  };

  useEffect(() => {
    if (!supported) return;
    let live = true;
    listPasskeys()
      .then((found) => {
        if (live) setRows(found);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [supported]);

  const add = async () => {
    if (busy) return;
    setBusy('add');
    setError(null);
    try {
      await registerPasskey();
      await refresh();
      flash(t("Passkey added."));
    } catch (caught) {
      setError(passkeyNote(caught));
    } finally {
      setBusy(null);
    }
  };

  const drop = async (credentialId: string) => {
    if (busy) return;
    setBusy(credentialId);
    setError(null);
    try {
      await removePasskey(credentialId);
      await refresh();
      flash(t("Passkey removed."));
    } catch (caught) {
      setError(passkeyNote(caught));
    } finally {
      setBusy(null);
    }
  };

  if (!supported) return null;

  return (
    <section className="set-section">
      <h3 className="kicker">{t("Passkeys")}</h3>
      <p className="set-hint">
        {t("Sign in with your face, fingerprint or device PIN. Your passkey replaces the password — and on browsers that support it, it opens the planner with no password at all.")}
      </p>
      {error ? <p className="set-hint is-error" role="alert">{error}</p> : null}
      {rows && rows.length === 0 ? <p className="empty-inline">{t("No passkeys yet.")}</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="feed-list">
          {rows.map((row) => (
            <li key={row.credentialId} className="feed-item">
              <div className="feed-copy">
                <strong>{row.label}</strong>
                <small className="set-hint">{t("Added {0}", { 0: formatStamp(row.createdAt) })}</small>
              </div>
              <button
                type="button"
                className="btn btn-tiny danger"
                disabled={busy === row.credentialId}
                onClick={() => void drop(row.credentialId)}
              >
                {t("Remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="set-row">
        <div>
          <p className="set-label">{t("Add a passkey")}</p>
          <p className="set-hint">{t("One for this browser or your phone. Lost one? Remove it and add another.")}</p>
        </div>
        <button type="button" className="btn btn-soft" disabled={busy !== null} onClick={() => void add()}>
          {busy === 'add' ? t("Adding…") : t("Add")}
        </button>
      </div>
    </section>
  );
}
