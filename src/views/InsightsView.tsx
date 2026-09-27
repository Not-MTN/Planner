import { useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { addDays, dayNumber, formatMonthShort, formatWeekdayShort, startOfWeek, todayISO, weekDates } from '../dates';
import { dayScore, formatPercent, goalProgress, habitStreaks, habitStats, insightTotals, planVsFocus, weekDoneCount, weekNarrative, yearPixels } from '../logic';
import { formatEstimate } from '../quickAdd';
import { FlameIcon, SparklesIcon } from '../icons';
import { Meter } from '../components/ui';
import type { PlannerState } from '../types';
import { RhythmCard } from './RhythmCard';
import { t } from '../i18n';

export function InsightsView() {
  const { state, navigate } = usePlanner();
  const [historyDays, setHistoryDays] = useState<7 | 30 | 90>(30);
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
    { label: t("Day streak"), value: totals.dayStreak, hint: t("days with something done") },
    { label: t("Tasks done"), value: totals.tasksCompleted, hint: t("{0} still open", { 0: totals.tasksOpen }) },
    { label: t("Habit check-ins"), value: totals.checkIns, hint: t("all time") },
    { label: t("Active goals"), value: totals.activeGoals, hint: t("{0} notes kept", { 0: totals.notes }) },
  ];

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">{t("Insights")}</p>
          <h1>{t("Insights")}</h1>
          <p className="lede">{t("How your days are taking shape.")}</p>
        </div>
        <button type="button" className="btn btn-soft" onClick={() => navigate({ name: 'ai', tab: 'review' })}>
          <SparklesIcon size={16} /> {t("Get an AI review")}
        </button>
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
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)} {Math.abs(trend) === 1 ? t("thing") : t("things")} {trend > 0 ? t("more") : t("fewer")} {t("finished than last week.")}
            </p>
          ) : null}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2 className="kicker">{t("This week")}</h2>
          <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'calendar', tab: 'week', date: today })}>
            {t("Open week")}
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
                {formatWeekdayShort(date)}: {score.total === 0 ? t("nothing planned") : `${score.done} of ${score.total}`}
              </li>
            );
          })}
        </ul>
        <p className="meta">{t("Bars show finished plans for each day. An open day stays short — that is allowed.")}</p>
      </section>

      <RhythmCard today={today} />

      <section className="chart-grid" aria-label={t("Progress charts")}>
        <TrendChart state={state} today={today} days={historyDays} onDaysChange={setHistoryDays} />
        <CompletionDonut state={state} today={today} days={historyDays} />
      </section>

      <div className="today-grid">
        <section className="card">
          <header className="card-head">
            <h2 className="kicker">{t("Habits")}</h2>
            <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'habits' })}>
              {t("Tracker")}
            </button>
          </header>
          {habits.length === 0 ? (
            <p className="empty-inline">{t("No habits to reflect on yet.")}</p>
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
                          <span className="streak-chip" title={t("Current streak")}>
                            <FlameIcon size={12} /> {streaks.current}
                          </span>
                        ) : null}
                      </span>
                      <small>{stats.expected === 0 ? t("New") : `${stats.done}/${stats.expected}`}</small>
                    </div>
                    <Meter value={stats.ratio} label={t("{0} this week", { 0: habit.name })} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card">
          <header className="card-head">
            <h2 className="kicker">{t("Goals")}</h2>
            <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'goals' })}>
              {t("Goals")}
            </button>
          </header>
          {goals.length === 0 ? (
            <p className="empty-inline">{t("No goals in motion.")}</p>
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
        <PlanVsFocusCard state={state} today={today} />
        <YearPixelsCard state={state} today={today} />
      </div>
    </div>
  );
}

/** Estimated minutes planned vs focus minutes actually logged, last 30 days. */
function PlanVsFocusCard({ state, today }: { state: PlannerState; today: string }) {
  const data = useMemo(() => planVsFocus(state, today, 30), [state, today]);
  const plannedTotal = data.reduce((sum, item) => sum + item.planned, 0);
  const focusedTotal = data.reduce((sum, item) => sum + item.focused, 0);
  if (plannedTotal === 0 && focusedTotal === 0) return null;
  const height = 120;
  const top = 10;
  const bottom = 6;
  const max = Math.max(10, ...data.flatMap((item) => [item.planned, item.focused]));
  const bar = (value: number) => Math.max(1, (value / max) * (height - top - bottom));
  return (
    <section className="card wide-card">
      <header className="card-head">
        <div>
          <p className="kicker">{t("Estimates vs reality")}</p>
          <h2 className="card-title">{t("Plan vs focus, last 30 days")}</h2>
        </div>
        <p className="meta">
          {t("{0} planned · {1} focused", { 0: formatEstimate(plannedTotal), 1: formatEstimate(focusedTotal) })}
        </p>
      </header>
      <div className="pvf-chart" role="img" aria-label={t("Estimated minutes versus focus minutes for the last 30 days")} style={{ height }}>
        {data.map((item) => (
          <div key={item.date} className="pvf-day" title={`${formatWeekdayShort(item.date)} ${dayNumber(item.date)} ≈ ${item.planned}m / ${item.focused}m`}>
            <span className="pvf-bar planned" style={{ height: bar(item.planned) }} />
            <span className="pvf-bar focused" style={{ height: bar(item.focused) }} />
          </div>
        ))}
      </div>
      <p className="meta pvf-legend">
        <span className="pvf-key planned" /> {t("Planned (estimates)")} <span className="pvf-key focused" /> {t("Focused")}
      </p>
    </section>
  );
}

/** A GitHub-style “year in pixels”: one cell per day of the current year. */
function YearPixelsCard({ state, today }: { state: PlannerState; today: string }) {
  const year = Number(today.slice(0, 4));
  const days = useMemo(() => yearPixels(state, year), [state, year]);
  const start = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const tally = days.filter((day) => (day.score.ratio ?? 0) > 0).length;
  const firstOfYear = `${year}-01-01`;
  const level = (ratio: number | null) => (ratio === null ? 0 : ratio >= 0.9 ? 4 : ratio >= 0.6 ? 3 : ratio >= 0.3 ? 2 : ratio > 0 ? 1 : 0);
  return (
    <section className="card wide-card">
      <header className="card-head">
        <div>
          <p className="kicker">{t("Year in pixels")}</p>
          <h2 className="card-title">{year}</h2>
        </div>
        <span className="streak-chip big">{t("{0} lived days", { 0: tally })}</span>
      </header>
      <div className="year-scroll">
        <div className="year-grid" role="img" aria-label={t("Completion level for every day of {0}", { 0: year })}>
          {days.map((day) => (
            <span
              key={day.date}
              className="year-cell"
              data-level={level(day.score.ratio)}
              style={day.date === firstOfYear ? { gridColumnStart: start + 1 } : undefined}
              title={`${day.date}${day.score.total ? ` — ${day.score.done}/${day.score.total}` : ''}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TrendChart({
  state,
  today,
  days,
  onDaysChange,
}: {
  state: PlannerState;
  today: string;
  days: 7 | 30 | 90;
  onDaysChange: (days: 7 | 30 | 90) => void;
}) {
  const dates = Array.from({ length: days }, (_, index) => addDays(today, index - days + 1));
  const data = dates.map((date) => ({ date, score: dayScore(state, date, false) }));
  const plotted = data.flatMap((item, index) => item.score.ratio === null ? [] : [{ ...item, index }]);
  const viewWidth = 620;
  const viewHeight = 220;
  const left = 38;
  const right = 12;
  const top = 14;
  const bottom = 34;
  const plotWidth = viewWidth - left - right;
  const plotHeight = viewHeight - top - bottom;
  const x = (index: number) => left + (index / (days - 1)) * plotWidth;
  const y = (ratio: number) => top + (1 - ratio) * plotHeight;
  const points = plotted.map((item) => `${x(item.index)},${y(item.score.ratio ?? 0)}`).join(' ');
  const labelEvery = days === 7 ? 1 : days === 30 ? 5 : 15;

  return (
    <section className="card chart-card">
      <header className="card-head chart-head">
        <div><p className="kicker">{t("Daily rhythm")}</p><h2 className="card-title">{t("Completion trend")}</h2></div>
        <div className="segmented chart-range" role="group" aria-label={t("Chart date range")}>
          {([7, 30, 90] as const).map((amount) => (
            <button key={amount} type="button" className={cx('seg', days === amount && 'on')} aria-pressed={days === amount} onClick={() => onDaysChange(amount)}>{amount}d</button>
          ))}
        </div>
      </header>
      {plotted.length === 0 ? <p className="chart-empty">{t("No planned items in this stretch yet. That’s okay — an open day isn’t a zero.")}</p> : (
        <figure className="trend-figure">
          <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label={t("Completion rate across the last {0} days", { 0: days })}>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <g key={ratio} className="chart-gridline">
                <line x1={left} x2={viewWidth - right} y1={y(ratio)} y2={y(ratio)} />
                <text x={left - 8} y={y(ratio) + 4} textAnchor="end">{Math.round(ratio * 100)}%</text>
              </g>
            ))}
            {plotted.map((item) => {
              const barWidth = Math.max(2, Math.min(18, plotWidth / days * 0.56));
              return <rect key={item.date} className="trend-bar" x={x(item.index) - barWidth / 2} y={y(item.score.ratio ?? 0)} width={barWidth} height={Math.max(2, top + plotHeight - y(item.score.ratio ?? 0))} rx={barWidth / 2} />;
            })}
            {plotted.length > 1 ? <polyline className="trend-line" points={points} /> : null}
            {plotted.map((item) => (
              <circle key={`point-${item.date}`} className="trend-point" cx={x(item.index)} cy={y(item.score.ratio ?? 0)} r="4.5">
                <title>{formatFullWeekday(item.date)}: {item.score.done} {t('of')} {item.score.total} {t('completed')}</title>
              </circle>
            ))}
            {data.map((item, index) => index % labelEvery === 0 || index === data.length - 1 ? (
              <text key={`label-${item.date}`} className="chart-axis-label" x={x(index)} y={viewHeight - 8} textAnchor="middle">{dayNumber(item.date)}{item.date.endsWith('-01') || index === 0 ? ` ${formatMonthShort(item.date)}` : ''}</text>
            ) : null)}
          </svg>
          <figcaption>{t("Each dot is a day with something planned. Empty days are left out—not scored as zero.")}</figcaption>
        </figure>
      )}
    </section>
  );
}

function CompletionDonut({ state, today, days }: { state: PlannerState; today: string; days: 7 | 30 | 90 }) {
  const start = addDays(today, -days + 1);
  const taskWins = state.tasks.filter((task) => task.completed && task.dueDate !== null && task.dueDate >= start && task.dueDate <= today).length;
  const eventWins = state.events.filter((event) => event.completed && event.date >= start && event.date <= today).length;
  const activeHabitIds = new Set(state.habits.filter((habit) => !habit.archived).map((habit) => habit.id));
  const habitWins = state.completions.filter((item) => activeHabitIds.has(item.habitId) && item.date >= start && item.date <= today).length;
  const segments = [
    { label: t("Tasks"), value: taskWins, className: 'tasks' },
    { label: t("Events"), value: eventWins, className: 'events' },
    { label: t("Habits"), value: habitWins, className: 'habits' },
  ];
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;

  return (
    <section className="card chart-card">
      <header className="card-head">
        <div><p className="kicker">{t("Small wins")}</p><h2 className="card-title">{t("What you finished")}</h2></div>
        <span className="chip">{days} {t('days')}</span>
      </header>
      {total === 0 ? <p className="chart-empty">{t("Check off a task, event, or habit to start your completion mix.")}</p> : (
        <div className="donut-layout">
          <div className="donut-wrap">
            <svg viewBox="0 0 112 112" role="img" aria-label={t("Completed plans: {0} tasks, {1} events, {2} habit check-ins", { 0: taskWins, 1: eventWins, 2: habitWins })}>
              <circle className="donut-track" cx="56" cy="56" r={radius} />
              {segments.map((segment) => {
                const length = total ? (segment.value / total) * circumference : 0;
                const offset = consumed;
                consumed += length;
                return segment.value > 0 ? (
                  <circle key={segment.label} className={`donut-segment ${segment.className}`} cx="56" cy="56" r={radius} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 56 56)" />
                ) : null;
              })}
              <text className="donut-total" x="56" y="54" textAnchor="middle">{total}</text>
              <text className="donut-caption" x="56" y="69" textAnchor="middle">{t('completed')}</text>
            </svg>
          </div>
          <ul className="donut-legend">
            {segments.map((segment) => (
              <li key={segment.label}>
                <span className={`donut-key ${segment.className}`} />
                <span>{segment.label}</span>
                <strong>{segment.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="meta chart-footnote">{t("Counts completed items in the selected window; habit check-ins are counted once each.")}</p>
    </section>
  );
}

function formatFullWeekday(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
}
