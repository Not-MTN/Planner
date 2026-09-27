import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import {
  addDays,
  dayNumber,
  formatMonthShort,
  formatMonthYear,
  formatWeekdayShort,
  monthDates,
  startOfWeek,
  todayISO,
  weekDates,
} from '../dates';
import { ChevronLeftIcon, ChevronRightIcon, FlameIcon, HabitGlyph, SunIcon } from '../icons';
import { formatPercent, frequencyLabel, habitDot, habitStats, habitStreaks } from '../logic';
import { Meter } from '../components/ui';
import { HabitLibrary } from '../components/HabitLibrary';
import { ESSENTIAL_PRESETS, presetToInput } from '../presets';

const HEAT_WEEKS = 12;

export function HabitsView() {
  const { state, openComposer, setHabitArchived, deleteHabit, toggleHabit, addHabit, addHabits, flash, undo } = usePlanner();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const active = state.habits.filter((habit) => !habit.archived);
  const archived = state.habits.filter((habit) => habit.archived);
  const week = weekDates(today);
  const month = monthDates(cursor.year, cursor.month);
  const heatStart = startOfWeek(addDays(today, -(HEAT_WEEKS - 1) * 7));

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
        <div className="page-head-actions">
          <button type="button" className="btn btn-soft" onClick={() => setLibraryOpen(true)}>
            Library
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'habit' })}>
            Add habit
          </button>
        </div>
      </header>

      {active.length === 0 && archived.length === 0 ? (
        <section className="card library-empty">
          <img className="spot spot-lg" src="/img/spot-library.jpg" alt="" loading="lazy" />
          <div className="library-empty-body">
            <p className="kicker">Habit library</p>
            <h2 className="section-title">Start with a classic</h2>
            <p className="lede">Built-in habits and daily must-dos, ready in one tap.</p>
            <div className="preset-grid">
              {ESSENTIAL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={cx('preset-chip', `accent-${preset.accent}`)}
                  onClick={() => {
                    addHabit(presetToInput(preset));
                    flash(`Habit “${preset.name}” added.`, { label: 'Undo', run: undo });
                  }}
                >
                  <span className={cx('icon-well', `accent-${preset.accent}`)}>
                    <HabitGlyph name={preset.icon} />
                  </span>
                  <span className="preset-copy">
                    <strong>{preset.name}</strong>
                    {preset.blurb ? <small>{preset.blurb}</small> : null}
                  </span>
                  <span className="library-add" aria-hidden="true">Add</span>
                </button>
              ))}
            </div>
            <div className="welcome-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  addHabits(ESSENTIAL_PRESETS.map(presetToInput));
                  flash('Daily essentials added.', { label: 'Undo', run: undo });
                }}
              >
                Add all essentials
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setLibraryOpen(true)}>
                Browse the full library
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="habit-toolbar">
            <p className="kicker">{formatMonthYear(cursor.year, cursor.month)}</p>
            <div className="pager">
              <button type="button" className="icon-btn round" aria-label="Previous month" onClick={() => shift(-1)}>
                <ChevronLeftIcon />
              </button>
              <button type="button" className="icon-btn round" aria-label="Next month" onClick={() => shift(1)}>
                <ChevronRightIcon />
              </button>
            </div>
          </div>
          <div className="habit-list">
            {active.map((habit) => {
              const weekStats = habitStats(state, habit, week, today);
              const monthStats = habitStats(state, habit, month, today);
              const streaks = habitStreaks(state, habit, today);
              return (
                <article key={habit.id} className={cx('card habit-card', `accent-${habit.accent}`)}>
                  <header className="habit-top">
                    <span className={cx('icon-well', `accent-${habit.accent}`)}>
                      <HabitGlyph name={habit.icon} />
                    </span>
                    <div>
                      <h2>{habit.name}</h2>
                      <p className="meta">{frequencyLabel(habit)}</p>
                      {habit.essential ? (
                        <p className="essential-tag">
                          <SunIcon size={12} /> Daily must-do
                        </p>
                      ) : null}
                    </div>
                    <div className="habit-nums">
                      <span className="habit-percent">{formatPercent(monthStats.ratio)}</span>
                      <span className="streak-chip big" title={`Best streak: ${streaks.best} ${streaks.best === 1 ? 'day' : 'days'}`}>
                        <FlameIcon size={13} /> {streaks.current} day{streaks.current === 1 ? '' : 's'}
                      </span>
                    </div>
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
                  <div className="heat-wrap">
                    <div className="heat-months" aria-hidden="true">
                      <span>{formatMonthShort(heatStart)}</span>
                      <span>{formatMonthShort(addDays(heatStart, Math.round(HEAT_WEEKS / 2 * 7)))}</span>
                      <span>{formatMonthShort(today)}</span>
                    </div>
                    <div className="heat-grid" role="group" aria-label={`${habit.name} over the last ${HEAT_WEEKS} weeks`}>
                      {Array.from({ length: HEAT_WEEKS }, (_, weekIndex) => (
                        <div key={weekIndex} className="heat-col">
                          {weekDates(addDays(heatStart, weekIndex * 7)).map((date) => {
                            const status = habitDot(state, habit, date, today);
                            return (
                              <button
                                key={date}
                                type="button"
                                className={cx('heat-cell', status, `accent-${habit.accent}`)}
                                title={`${formatWeekdayShort(date)} ${dayNumber(date)} ${formatMonthShort(date)} — ${status === 'done' ? 'done' : status === 'open' ? 'missed' : status === 'future' ? 'upcoming' : status === 'optional' ? 'optional' : 'not planned'}`}
                                aria-label={`${habit.name} on ${date}: ${status}`}
                                aria-pressed={status === 'done'}
                                disabled={status === 'off' || status === 'future'}
                                onClick={() => toggleHabit(habit.id, date)}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="visually-hidden">
                    This week, {weekStats.done} of {weekStats.expected || week.length} kept. Streak: {streaks.current}, best {streaks.best}.
                  </p>
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
                      onClick={() => {
                        deleteHabit(habit.id);
                        flash(`Habit “${habit.name}” removed.`, { label: 'Undo', run: undo });
                      }}
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
      {libraryOpen ? <HabitLibrary onClose={() => setLibraryOpen(false)} /> : null}
    </div>
  );
}
