import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatWeekdayShort } from '../dates';
import { focusSummary, habitLinks, hourLabel, productiveHours, weeklyReport } from '../insights';
import { DownloadIcon } from '../icons';

function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
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
      flash('Weekly report copied — paste it anywhere.');
    } catch {
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `week-${today}.md`;
      link.click();
      URL.revokeObjectURL(url);
      flash('Weekly report downloaded.');
    }
  };

  return (
    <section className="chart-grid rhythm" aria-label="Focus and rhythm">
      <section className="card chart-card">
        <header className="card-head">
          <div><p className="kicker">Last 7 days</p><h2 className="card-title">Focus time</h2></div>
          <strong className="rhythm-total">{formatMinutes(focus.totalMinutes)}</strong>
        </header>
        {focus.sessions === 0 ? (
          <div className="rhythm-empty">
            <p className="meta">No focus sessions yet. Finished sessions are counted here automatically.</p>
            <button type="button" className="btn btn-soft" onClick={() => startFocus({ taskId: null, title: 'Deep work', minutes: 25 })}>Start a session</button>
          </div>
        ) : (
          <>
            <div className="week-bars focus-bars" aria-hidden="true">
              {focus.perDay.map((day) => (
                <div key={day.date} className={cx('bar-col', day.date === today && 'is-today')}>
                  <span className="bar" style={{ height: day.minutes ? 8 + Math.round((day.minutes / peak) * 64) : 6 }} title={`${day.minutes} min`} />
                  <small>{formatWeekdayShort(day.date).slice(0, 1)}</small>
                </div>
              ))}
            </div>
            <p className="meta">
              {focus.sessions} {focus.sessions === 1 ? 'session' : 'sessions'}
              {focus.topTasks.length ? ` · most on “${focus.topTasks[0].title}” (${formatMinutes(focus.topTasks[0].minutes)})` : ''}
            </p>
          </>
        )}
      </section>

      <section className="card chart-card">
        <header className="card-head">
          <div><p className="kicker">Your rhythm</p><h2 className="card-title">When you get things done</h2></div>
          <button type="button" className="btn btn-tiny" onClick={() => void copyReport()}>
            <DownloadIcon size={14} /> Weekly report
          </button>
        </header>
        {profile.bestHour === null ? (
          <p className="meta">Complete a few more tasks and your most productive hours will show up here.</p>
        ) : (
          <>
            <div className="hour-strip" aria-hidden="true">
              {profile.hours.slice(6, 24).map((count, index) => (
                <span key={index} className={cx(index + 6 === profile.bestHour && 'is-best')} style={{ opacity: 0.18 + (count / hourPeak) * 0.82 }} title={`${hourLabel(index + 6)}: ${count}`} />
              ))}
            </div>
            <div className="hour-axis" aria-hidden="true"><span>6</span><span>12</span><span>18</span><span>24</span></div>
            <p className="meta">You finish the most around <strong>{hourLabel(profile.bestHour)}</strong>. Try protecting that hour for your hardest task.</p>
          </>
        )}
        {links.length ? (
          <ul className="habit-links">
            {links.map((link) => (
              <li key={link.habitId}>
                <span className={cx('link-lift', link.lift > 0 ? 'up' : 'down')}>{link.lift > 0 ? '↑' : '↓'} {Math.round(Math.abs(link.lift) * 100)}%</span>
                On days you do <strong>{link.name}</strong>, you finish {link.lift > 0 ? 'more' : 'fewer'} tasks ({link.withHabit.toFixed(1)} vs {link.without.toFixed(1)}).
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
