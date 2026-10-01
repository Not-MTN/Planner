import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatWeekdayShort } from '../dates';
import { focusSummary, habitLinks, hourLabel, productiveHours } from '../insights';
import { buildWeeklyReport, weeklyReport, weeklyReportHtml } from '../weeklyReport';
import { printDocument } from '../printDocument';
import { Rich } from '../components/Rich';
import { downloadBlob } from '../download';
import { DownloadIcon, PrinterIcon } from '../icons';
import { t, tn } from '../i18n';

function formatMinutes(total: number): string {
  if (total < 60) return t("{0} min", { 0: total });
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? t("{0} h {1} min", { 0: hours, 1: rest }) : t("{0} h", { 0: hours });
}

export function RhythmCard({ today }: { today: string }) {
  const { state, flash, startFocus } = usePlanner();
  const focus = focusSummary(state, today, 7);
  const profile = productiveHours(state);
  const links = habitLinks(state, today);
  const peak = Math.max(1, ...focus.perDay.map((day) => day.minutes));
  const hourPeak = Math.max(1, ...profile.hours);

  const copyReport = async () => {
    const text = weeklyReport(state, today);
    try {
      await navigator.clipboard.writeText(text);
      flash(t("Weekly report copied — paste it anywhere."));
    } catch {
      downloadBlob(new Blob([text], { type: 'text/markdown' }), `week-${today}.md`);
      flash(t("Weekly report downloaded."));
    }
  };

  // The same week, on paper. If the print window is blocked the report is
  // handed over as a file instead, so the button never silently does nothing.
  const printReport = () => {
    const html = weeklyReportHtml(buildWeeklyReport(state, today), {
      madeOn: today,
      dir: document.documentElement.dir || 'ltr',
      lang: document.documentElement.lang || 'en',
    });
    if (printDocument(html)) return;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `week-${today}.html`);
    flash(t("Pop-ups are blocked, so the report was downloaded. Open it to print it."));
  };

  return (
    <section className="chart-grid rhythm" aria-label={t("Focus and rhythm")}>
      <section className="card chart-card">
        <header className="card-head">
          <div><p className="kicker">{t("Last 7 days")}</p><h2 className="card-title">{t("Focus time")}</h2></div>
          <strong className="rhythm-total">{formatMinutes(focus.totalMinutes)}</strong>
        </header>
        {focus.sessions === 0 ? (
          <div className="rhythm-empty">
            <p className="meta">{t("No focus sessions yet. Finished sessions are counted here automatically.")}</p>
            <button type="button" className="btn btn-soft" onClick={() => startFocus({ taskId: null, title: t("Deep work"), minutes: 25 })}>{t("Start a session")}</button>
          </div>
        ) : (
          <>
            <div className="week-bars focus-bars" aria-hidden="true">
              {focus.perDay.map((day) => (
                <div key={day.date} className={cx('bar-col', day.date === today && 'is-today')}>
                  <span className="bar" style={{ height: day.minutes ? 8 + Math.round((day.minutes / peak) * 64) : 6 }} title={t("{0} min", { 0: day.minutes })} />
                  <small>{formatWeekdayShort(day.date).slice(0, 1)}</small>
                </div>
              ))}
            </div>
            <p className="meta">
              {focus.topTasks.length
                ? tn(
                    focus.sessions,
                    "{count} session · most on “{title}” ({time})",
                    "{count} sessions · most on “{title}” ({time})",
                    { title: focus.topTasks[0].title, time: formatMinutes(focus.topTasks[0].minutes) },
                  )
                : tn(focus.sessions, "{count} session", "{count} sessions")}
            </p>
          </>
        )}
      </section>

      <section className="card chart-card">
        <header className="card-head">
          <div><p className="kicker">{t("Your rhythm")}</p><h2 className="card-title">{t("When you get things done")}</h2></div>
          <div className="rhythm-actions">
            <button type="button" className="btn btn-tiny" onClick={() => void copyReport()}>
              <DownloadIcon size={14} /> {t("Weekly report")}
            </button>
            <button type="button" className="btn btn-tiny" onClick={printReport}>
              <PrinterIcon size={14} /> {t("Print")}
            </button>
          </div>
        </header>
        {profile.bestHour === null ? (
          <p className="meta">{t("Complete a few more tasks and your most productive hours will show up here.")}</p>
        ) : (
          <>
            <div className="hour-strip" aria-hidden="true">
              {profile.hours.slice(6, 24).map((count, index) => (
                <span key={index} className={cx(index + 6 === profile.bestHour && 'is-best')} style={{ opacity: 0.18 + (count / hourPeak) * 0.82 }} title={`${hourLabel(index + 6)}: ${count}`} />
              ))}
            </div>
            <div className="hour-axis" aria-hidden="true"><span>6</span><span>12</span><span>18</span><span>24</span></div>
            <p className="meta">
              <Rich
                text={t("You finish the most around {hour}. Try protecting that hour for your hardest task.")}
                values={{ hour: <strong>{hourLabel(profile.bestHour)}</strong> }}
              />
            </p>
          </>
        )}
        {links.length ? (
          <ul className="habit-links">
            {links.map((link) => (
              <li key={link.habitId}>
                <span className={cx('link-lift', link.lift > 0 ? 'up' : 'down')}>{link.lift > 0 ? '↑' : '↓'} {Math.round(Math.abs(link.lift) * 100)}%</span>
                <Rich
                  text={t("On days you do {habit}, you finish {direction} tasks ({with} vs {without}).")}
                  values={{
                    habit: <strong>{link.name}</strong>,
                    direction: link.lift > 0 ? t("more") : t("fewer"),
                    with: link.withHabit.toFixed(1),
                    without: link.without.toFixed(1),
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
