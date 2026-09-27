import { useState } from 'react';
import { categoryById } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import {
  addDays,
  dayNumber,
  formatFullDate,
  formatWeekRange,
  formatWeekdayShort,
  isWeekend,
  weekdayIndex,
  todayISO,
  weekDates,
} from '../dates';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, TickIcon } from '../icons';
import { dayScore, eventsForDate, habitsDueOn, tasksForDate } from '../logic';
import { Meter } from '../components/ui';

export function WeeklyView() {
  const { route, navigate, state, openComposer, moveEvent, swapEventTimes, toggleTask, toggleEvent, toggleHabit } = usePlanner();
  const anchor = route.name === 'weekly' ? route.date : todayISO();
  const days = weekDates(anchor);
  const today = todayISO();
  const showingThisWeek = days.includes(today);
  const [picked, setPicked] = useState(anchor);
  const selected = days.includes(picked)
    ? picked
    : days.find((day) => weekdayIndex(day) === weekdayIndex(picked)) ?? days[0];
  const [over, setOver] = useState<string | null>(null);

  const shift = (amount: number) => navigate({ name: 'weekly', date: addDays(selected, amount) });

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Weekly planner</p>
          <h1 aria-live="polite">{formatWeekRange(anchor)}</h1>
          <p className="lede">Seven days, loosely held.</p>
        </div>
        <div className="pager">
          <button type="button" className="icon-btn round" aria-label="Previous week" onClick={() => shift(-7)}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className="btn btn-ghost" disabled={showingThisWeek} onClick={() => navigate({ name: 'weekly', date: today })}>
            Today
          </button>
          <button type="button" className="icon-btn round" aria-label="Next week" onClick={() => shift(7)}>
            <ChevronRightIcon />
          </button>
        </div>
      </header>
      <p className="quiet-hint">Drag an event to another day, or edit it to change the time. On a phone, pick a day below.</p>

      <div className="day-strip" role="group" aria-label="Days this week">
        {days.map((date) => (
          <button
            key={date}
            type="button"
            className={cx('day-chip', selected === date && 'on', date === today && 'is-today')}
            onClick={() => setPicked(date)}
          >
            <span>{formatWeekdayShort(date)}</span>
            <strong>{dayNumber(date)}</strong>
          </button>
        ))}
      </div>

      <div className="week-scroller">
        {days.map((date) => {
          const events = eventsForDate(state, date);
          const tasks = tasksForDate(state, date);
          const habits = habitsDueOn(state, date);
          const score = dayScore(state, date, false);
          return (
            <section
              key={date}
              className={cx(
                'day-col',
                selected === date && 'is-selected',
                date === today && 'is-today',
                isWeekend(date) && 'is-weekend',
                over === date && 'is-drop',
              )}
              aria-label={formatFullDate(date)}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(date);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const raw = event.dataTransfer.getData('text/plain');
                if (!raw.startsWith('event:')) return;
                const id = raw.slice(6);
                const source = state.events.find((item) => item.id === id);
                if (!source || source.date === date) return;
                moveEvent(id, date);
              }}
            >
              <header className="day-col-head">
                <button type="button" className="day-col-date" onClick={() => navigate({ name: 'daily', date })}>
                  <span>{formatWeekdayShort(date)}</span>
                  <strong>{dayNumber(date)}</strong>
                </button>
                <Meter value={score.ratio ?? 0} label={`${formatWeekdayShort(date)} completion`} />
              </header>
              <div className="day-col-body">
                {events.length === 0 && tasks.length === 0 ? <p className="open-label">Open</p> : null}
                {events.map((item) => (
                  <div
                    key={item.id}
                    className={cx('week-chip', `accent-${categoryById(item.category).accent}`, item.completed && 'is-done')}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', `event:${item.id}`);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setOver(null);
                      const raw = event.dataTransfer.getData('text/plain');
                      if (!raw.startsWith('event:')) return;
                      const sourceId = raw.slice(6);
                      if (sourceId === item.id) return;
                      const source = state.events.find((entry) => entry.id === sourceId);
                      if (!source) return;
                      if (source.date === item.date) swapEventTimes(sourceId, item.id);
                      else moveEvent(sourceId, item.date);
                    }}
                  >
                    <button
                      type="button"
                      className="week-chip-main"
                      onClick={() => openComposer({ mode: 'edit', type: 'event', id: item.id })}
                    >
                      <time>{item.startTime}</time>
                      <span>{item.title}</span>
                    </button>
                    <button
                      type="button"
                      className={cx('mini-check', item.completed && 'on')}
                      aria-label={item.completed ? `Mark ${item.title} not done` : `Mark ${item.title} complete`}
                      onMouseDown={(event) => event.stopPropagation()}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={() => toggleEvent(item.id)}
                    >
                      {item.completed ? <TickIcon size={12} /> : null}
                    </button>
                  </div>
                ))}
                {tasks.map((task) => (
                  <div key={task.id} className={cx('week-task', task.completed && 'is-done')}>
                    <button
                      type="button"
                      className={cx('mini-check', task.completed && 'on')}
                      aria-label={task.completed ? `Mark ${task.title} not done` : `Mark ${task.title} complete`}
                      onClick={() => toggleTask(task.id)}
                    >
                      {task.completed ? <TickIcon size={12} /> : null}
                    </button>
                    <button type="button" className="week-task-title" onClick={() => openComposer({ mode: 'edit', type: 'task', id: task.id })}>
                      {task.title}
                    </button>
                  </div>
                ))}
              </div>
              {habits.length > 0 ? (
                <ul className="week-habits">
                  {habits.slice(0, 3).map((habit) => {
                    const done = state.completions.some((item) => item.habitId === habit.id && item.date === date);
                    return (
                      <li key={habit.id}>
                        <button
                          type="button"
                          className={cx('mini-check', done && 'on', `accent-${habit.accent}`)}
                          aria-label={`${habit.name} on ${formatWeekdayShort(date)}`}
                          aria-pressed={done}
                          onClick={() => toggleHabit(habit.id, date)}
                        >
                          {done ? <TickIcon size={12} /> : null}
                        </button>
                        <span>{habit.name}</span>
                      </li>
                    );
                  })}
                  {habits.length > 3 ? <li className="more-habits">+{habits.length - 3} habits</li> : null}
                </ul>
              ) : null}
              <button
                type="button"
                className="day-add"
                aria-label={`Add to ${formatFullDate(date)}`}
                onClick={() => openComposer({ mode: 'create', type: 'event', date })}
              >
                <PlusIcon size={14} /> Add
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}
