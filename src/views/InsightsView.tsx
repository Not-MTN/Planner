import { usePlanner } from '../context';
import { cx } from '../cx';
import { addDays, dayNumber, formatWeekdayShort, startOfWeek, todayISO, weekDates } from '../dates';
import { dayScore, formatPercent, goalProgress, habitStreaks, habitStats, insightTotals, weekDoneCount, weekNarrative } from '../logic';
import { FlameIcon } from '../icons';
import { Meter } from '../components/ui';

export function InsightsView() {
  const { state, navigate } = usePlanner();
  const today = todayISO();
  const days = weekDates(today);
  const lastWeekDays = weekDates(addDays(startOfWeek(today), -7));
  const sentence = weekNarrative(state, today);
  const habits = state.habits.filter((habit) => !habit.archived);
  const goals = state.goals;
  const totals = insightTotals(state, today);
  const doneThisWeek = weekDoneCount(state, days.filter((date) => date <= today));
  const doneLastWeek = weekDoneCount(state, lastWeekDays);
  const trend = doneThisWeek - doneLastWeek;

  const stats = [
    { label: 'Day streak', value: totals.dayStreak, hint: 'days with something done' },
    { label: 'Tasks done', value: totals.tasksCompleted, hint: `${totals.tasksOpen} still open` },
    { label: 'Habit check-ins', value: totals.checkIns, hint: 'all time' },
    { label: 'Active goals', value: totals.activeGoals, hint: `${totals.notes} notes kept` },
  ];

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Insights</p>
          <h1>Insights</h1>
          <p className="lede">How your days are taking shape.</p>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((stat) => (
          <div key={stat.label} className="card stat-tile">
            <strong className="stat-num">{stat.value}</strong>
            <span className="stat-label">{stat.label}</span>
            <span className="stat-hint">{stat.hint}</span>
          </div>
        ))}
      </div>

      <section className="card wash-sage narrative">
        <img className="narrative-img" src="/img/spot-insights.jpg" alt="" loading="lazy" />
        <div className="narrative-body">
          <p>{sentence}</p>
          {trend !== 0 && doneThisWeek + doneLastWeek > 0 ? (
            <p className="meta trend">
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)} {Math.abs(trend) === 1 ? 'thing' : 'things'} {trend > 0 ? 'more' : 'fewer'} finished than last week.
            </p>
          ) : null}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2 className="kicker">This week</h2>
          <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'calendar', tab: 'week', date: today })}>
            Open week
          </button>
        </header>
        <div className="week-bars" aria-hidden="true">
          {days.map((date) => {
            const score = dayScore(state, date, false);
            const height = score.ratio === null ? 8 : 10 + Math.round(score.ratio * 62);
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
                const streaks = habitStreaks(state, habit, today);
                return (
                  <li key={habit.id}>
                    <div className="progress-line">
                      <span>
                        {habit.name}
                        {streaks.current >= 2 ? (
                          <span className="streak-chip" title="Current streak">
                            <FlameIcon size={12} /> {streaks.current}
                          </span>
                        ) : null}
                      </span>
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
