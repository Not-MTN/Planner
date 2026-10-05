/**
 * Two-way calendar sync, as a settings screen.
 *
 * The screen has two jobs beyond the form: it says where the password goes (this
 * device, and the calendar server, nowhere else), and it shows the state of the
 * last sync per calendar instead of a silent failure. Connecting is a two-step
 * flow because one address is often a principal or a home folder holding several
 * calendars — asking the server what it has is friendlier than making the user
 * guess the collection path.
 */
import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatEdited } from '../dates';
import { t, tn } from '../i18n';
import { MAX_CALENDARS } from '../calendarSync';

export function CalendarsSection() {
  const { calendars, calendarsSyncing, discoverCalendars, addCalendar, removeCalendar, setCalendarPush, syncCalendars, syncCalendarNow, flash } = usePlanner();
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ url: string; name: string }[] | null>(null);

  const full = calendars.length >= MAX_CALENDARS;

  const connect = async (target: string, name: string) => {
    setBusy(true);
    setError(null);
    const failure = await addCalendar({ url: target, name, username, password, push });
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setChoices(null);
    setUrl('');
    flash(t('Calendar connected — the next sync brings both sides together.'));
  };

  return (
    <section className="set-section">
      <h3 className="kicker">{t('Two-way calendars')}</h3>
      <p className="set-hint">
        {t("Connect a calendar you can write to (Google, iCloud, Fastmail, Nextcloud, a university CalDAV server). Events sync both ways: what you change here is uploaded, what changes elsewhere comes back, and the newer edit wins. The password stays on this device and is only sent to that calendar server.")}
      </p>

      {calendars.length > 0 ? (
        <ul className="feed-list">
          {calendars.map((calendar) => (
            <li key={calendar.url} className="feed-item">
              <div className="feed-copy">
                <strong className="feed-url" title={calendar.url}>
                  {calendar.name || calendar.url.replace(/^https?:\/\//i, '')}
                </strong>
                <small className={cx('set-hint', calendar.lastError && 'is-error')}>
                  {calendar.lastError ? (
                    calendar.lastError
                  ) : calendar.lastSyncedAt ? (
                    <>
                      {t('Synced {0}', { 0: formatEdited(calendar.lastSyncedAt) })}
                      {calendar.push ? ` · ${t('Two-way')}` : ` · ${t('Read-only')}`}
                    </>
                  ) : (
                    t('Not synced yet.')
                  )}
                </small>
                <div className="set-inline">
                  <button type="button" className="btn btn-tiny" onClick={() => setCalendarPush(calendar.url, !calendar.push)}>
                    {calendar.push ? t('Sending my events') : t('Read-only')}
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-tiny"
                disabled={calendarsSyncing}
                onClick={() => {
                  void syncCalendarNow(calendar.url).then(() => flash(t('Calendar synced.')));
                }}
              >
                {t('Sync now')}
              </button>
              <button
                type="button"
                className="btn btn-tiny danger"
                onClick={() => {
                  removeCalendar(calendar.url);
                  flash(t('Calendar disconnected. Its events stay in your planner.'));
                }}
              >
                {t('Remove')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!full && choices === null ? (
        <form
          className="sync-link"
          onSubmit={(event) => {
            event.preventDefault();
            if (!url.trim() || busy) return;
            setBusy(true);
            setError(null);
            void discoverCalendars({ url: url.trim(), username: username.trim(), password })
              .then((found) => {
                if (found.length === 0) {
                  setError(t('No calendar was found at that address. Check the address, or paste the calendar itself.'));
                  return;
                }
                if (found.length === 1) return connect(found[0]!.url, found[0]!.name);
                setChoices(found);
                return undefined;
              })
              .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t('That calendar could not be reached.')))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            <span className="visually-hidden">{t('Calendar address')}</span>
            <input
              value={url}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('https://calendar.example.com/dav/')}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
                setChoices(null);
              }}
            />
          </label>
          <div className="set-inline">
            <label>
              <span className="visually-hidden">{t('Username')}</span>
              <input value={username} autoComplete="username" spellCheck={false} placeholder={t('Username')} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>
              <span className="visually-hidden">{t('Password')}</span>
              <input
                value={password}
                type="password"
                autoComplete="current-password"
                placeholder={t('Password')}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </div>
          <label className="set-inline">
            <input type="checkbox" checked={push} onChange={(event) => setPush(event.target.checked)} />
            <span>{t('Send events I add here to this calendar')}</span>
          </label>
          {error ? (
            <p className="set-hint is-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="set-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
              {busy ? t('Connecting…') : t('Connect calendar')}
            </button>
            {calendars.length > 0 ? (
              <button type="button" className="btn btn-ghost" disabled={calendarsSyncing} onClick={() => void syncCalendars(true)}>
                {calendarsSyncing ? t('Syncing…') : t('Sync all now')}
              </button>
            ) : null}
          </div>
          <p className="set-hint">
            {tn(calendars.length, '{count} calendar connected', '{count} calendars connected')}
            {` · ${t('Up to {0}', { 0: MAX_CALENDARS })}`}
          </p>
        </form>
      ) : null}

      {choices ? (
        <div className="set-section">
          <h4 className="kicker">{t('Which calendar?')}</h4>
          <ul className="feed-list">
            {choices.map((choice) => (
              <li key={choice.url} className="feed-item">
                <div className="feed-copy">
                  <strong className="feed-url" title={choice.url}>{choice.name || choice.url.replace(/^https?:\/\//i, '')}</strong>
                  <small className="set-hint">{choice.url.replace(/^https?:\/\//i, '')}</small>
                </div>
                <button type="button" className="btn btn-tiny" disabled={busy} onClick={() => void connect(choice.url, choice.name)}>
                  {t('Use this one')}
                </button>
              </li>
            ))}
          </ul>
          <div className="set-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setChoices(null)}>
              {t('Back')}
            </button>
          </div>
        </div>
      ) : null}

      {full ? <p className="set-hint">{t('Remove a calendar before adding another one.')}</p> : null}
    </section>
  );
}
