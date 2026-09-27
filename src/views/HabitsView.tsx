import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import {
  dayNumber,
  formatMonthYear,
  formatWeekdayShort,
  monthDates,
  todayISO,
  weekDates,
} from '../dates';
import { ChevronLeftIcon, ChevronRightIcon, HabitGlyph } from '../icons';
import { formatPercent, frequencyLabel, habitDot, habitStats } from '../logic';
import { Empty, Meter } from '../components/ui';

export function HabitsView() {
  const { state, openComposer, setHabitArchived, requestConfirm, deleteHabit, toggleHabit } = usePlanner();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const active = state.habits.filter((habit) => !habit.archived);
  const archived = state.habits.filter((habit) => habit.archived);
  const week = weekDates(today);
  const month = monthDates(cursor.year, cursor.month);

  const shift = (delta: number) => {
    const date = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: date.getFullYear(), month: date.getMonth() + 1 });
  };

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Habit tracker</p>
          <h1>Habits</h1>
          <p className="lede">Repeat what you want to keep.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'habit' })}>
          Add habit
        </button>
      </header>

      {active.length === 0 && archived.length === 0 ? (
        <section className="card">
          <Empty
            title="No habits yet."
            text="One small repeat is enough to begin. History will collect quietly."
            action={
              <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'habit' })}>
                Add habit
              </button>
            }
          />
        </section>
      ) : (
        <>
          <div className="habit-toolbar">
            <p className="kicker">This week</p>
            <div className="pager">
              <button type="button" className="icon-btn round" aria-label="Previous month" onClick={() => shift(-1)}>
                <ChevronLeftIcon />
              </button>
              <span>{formatMonthYear(cursor.year, cursor.month)}</span>
              <button type="button" className="icon-btn round" aria-label="Next month" onClick={() => shift(1)}>
                <ChevronRightIcon />
              </button>
            </div>
          </div>
          <div className="habit-list">
            {active.map((habit) => {
              const weekStats = habitStats(state, habit, week, today);
              const monthStats = habitStats(state, habit, month, today);
              return (
                <article key={habit.id} className={cx('card habit-card', `accent-${habit.accent}`)}>
                  <header className="habit-top">
                    <span className={cx('icon-well', `accent-${habit.accent}`)}>
                      <HabitGlyph name={habit.icon} />
                    </span>
                    <div>
                      <h2>{habit.name}</h2>
                      <p className="meta">{frequencyLabel(habit)}</p>
                    </div>
                    <p className="habit-percent">{formatPercent(monthStats.ratio)}</p>
                  </header>
                  <Meter value={monthStats.ratio} label={`${habit.name} this month`} />
                  <p className="meta habit-count">
                    {monthStats.expected === 0
                      ? 'No planned days in this stretch yet.'
                      : `${monthStats.done} of ${monthStats.expected} this month`}
                  </p>
                  <div className="habit-week">
                    {week.map((date) => (
                      <span key={date} aria-hidden="true">{formatWeekdayShort(date).slice(0, 1)}</span>
                    ))}
                    {week.map((date) => {
                      const status = habitDot(state, habit, date, today);
                      return (
                        <button
                          key={`${date}-dot`}
                          type="button"
                          className={cx('dot', 'dot-btn', status, `accent-${habit.accent}`)}
                          aria-label={`${habit.name} on ${formatWeekdayShort(date)} ${dayNumber(date)}, ${status}`}
                          aria-pressed={status === 'done'}
                          disabled={status === 'off'}
                          onClick={() => toggleHabit(habit.id, date)}
                        />
                      );
                    })}
                  </div>
                  <p className="visually-hidden">
                    This week, {weekStats.done} of {weekStats.expected || week.length} kept.
                  </p>
                  <div className="month-dots">
                    {month.map((date) => {
                      const status = habitDot(state, habit, date, today);
                      return (
                        <button
                          key={date}
                          type="button"
                          title={`${formatWeekdayShort(date)} ${dayNumber(date)}`}
                          className={cx('dot', 'dot-btn', status, `accent-${habit.accent}`)}
                          aria-label={`${habit.name} on ${dayNumber(date)} ${formatMonthYear(cursor.year, cursor.month)}, ${status}`}
                          aria-pressed={status === 'done'}
                          disabled={status === 'off'}
                          onClick={() => toggleHabit(habit.id, date)}
                        />
                      );
                    })}
                  </div>
                  <div className="row-actions">
                    <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'edit', type: 'habit', id: habit.id })}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-tiny" onClick={() => setHabitArchived(habit.id, true)}>
                      Archive
                    </button>
                    <button
                      type="button"
                      className="btn btn-tiny danger"
                      onClick={() =>
                        requestConfirm({
                          title: 'Remove this habit?',
                          body: 'Its history will be deleted too.',
                          onConfirm: () => deleteHabit(habit.id),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {archived.length > 0 ? (
            <details className="archive-block">
              <summary>Archived ({archived.length})</summary>
              <ul>
                {archived.map((habit) => (
                  <li key={habit.id}>
                    <span>{habit.name}</span>
                    <button type="button" className="btn btn-tiny" onClick={() => setHabitArchived(habit.id, false)}>
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      </div>
  );
}
