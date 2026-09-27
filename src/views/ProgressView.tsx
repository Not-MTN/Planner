import { usePlanner } from '../context';
import { cx } from '../cx';
import { dayNumber, formatWeekdayShort, todayISO, weekDates } from '../dates';
import { dayScore, formatPercent, goalProgress, habitStats, weekNarrative } from '../logic';
import { Meter } from '../components/ui';

export function ProgressView() {
  const { state, navigate } = usePlanner();
  const today = todayISO();
  const days = weekDates(today);
  const sentence = weekNarrative(state, today);
  const habits = state.habits.filter((habit) => !habit.archived);
  const goals = state.goals;

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Progress</p>
          <h1>Progress</h1>
          <p className="lede">How your days are taking shape.</p>
        </div>
      </header>

      <section className="card wash-sage narrative">
        <p>{sentence}</p>
      </section>

      <section className="card">
        <header className="card-head">
          <h2 className="kicker">This week</h2>
          <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'weekly', date: today })}>
            Open week
          </button>
        </header>
        <div className="week-bars" aria-hidden="true">
          {days.map((date) => {
            const score = dayScore(state, date, false);
            const height = score.ratio === null ? 10 : 10 + Math.round(score.ratio * 62);
            return (
              <div key={date} className={cx('bar-col', date === today && 'is-today')}>
                <span className="bar" style={{ height }} />
                <small>{formatWeekdayShort(date).slice(0, 1)}</small>
                <small className="bar-date">{dayNumber(date)}</small>
              </div>
            );
          })}
        </div>
        <ul className="visually-hidden">
          {days.map((date) => {
            const score = dayScore(state, date, false);
            return (
              <li key={date}>
                {formatWeekdayShort(date)}: {score.total === 0 ? 'nothing planned' : `${score.done} of ${score.total}`}
              </li>
            );
          })}
        </ul>
        <p className="meta">Bars show finished plans for each day. An open day stays short — that is allowed.</p>
      </section>

      <div className="today-grid">
        <section className="card">
          <header className="card-head">
            <h2 className="kicker">Habits</h2>
            <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'habits' })}>
              Tracker
            </button>
          </header>
          {habits.length === 0 ? (
            <p className="empty-inline">No habits to reflect on yet.</p>
          ) : (
            <ul className="progress-list">
              {habits.map((habit) => {
                const stats = habitStats(state, habit, days, today);
                return (
                  <li key={habit.id}>
                    <div className="progress-line">
                      <span>{habit.name}</span>
                      <small>{stats.expected === 0 ? 'New' : `${stats.done}/${stats.expected}`}</small>
                    </div>
                    <Meter value={stats.ratio} label={`${habit.name} this week`} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card">
          <header className="card-head">
            <h2 className="kicker">Goals</h2>
            <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'goals' })}>
              Goals
            </button>
          </header>
          {goals.length === 0 ? (
            <p className="empty-inline">No goals in motion.</p>
          ) : (
            <ul className="progress-list">
              {goals.map((goal) => {
                const progress = goalProgress(goal, state.tasks);
                return (
                  <li key={goal.id}>
                    <div className="progress-line">
                      <span>{goal.title}</span>
                      <small>{formatPercent(progress.ratio)}</small>
                    </div>
                    <Meter value={progress.ratio} label={`${goal.title} progress`} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
