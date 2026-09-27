import { useState } from 'react';
import { categoryById } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import {
  dayNumber,
  formatFullDate,
  formatMonthYear,
  formatWeekdayShort,
  monthGrid,
  todayISO,
} from '../dates';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { calendarMarks, eventsForDate, tasksForDate } from '../logic';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthlyView() {
  const { route, navigate, state, openComposer } = usePlanner();
  const now = new Date();
  const year = route.name === 'monthly' ? route.year : now.getFullYear();
  const month = route.name === 'monthly' ? route.month : now.getMonth() + 1;
  const today = todayISO();
  const cells = monthGrid(year, month);
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const [picked, setPicked] = useState(today);
  const selected = picked.startsWith(prefix) ? picked : today.startsWith(prefix) ? today : `${prefix}-01`;

  const go = (delta: number) => {
    const date = new Date(year, month - 1 + delta, 1);
    navigate({ name: 'monthly', year: date.getFullYear(), month: date.getMonth() + 1 });
  };

  const events = eventsForDate(state, selected);
  const tasks = tasksForDate(state, selected);
  const isCurrent = today.startsWith(`${year}-${String(month).padStart(2, '0')}`);

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Monthly calendar</p>
          <h1>{formatMonthYear(year, month)}</h1>
          <p className="lede">The shape of the month.</p>
        </div>
        <div className="pager">
          <button type="button" className="icon-btn round" aria-label="Previous month" onClick={() => go(-1)}>
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={isCurrent}
            onClick={() => navigate({ name: 'monthly', year: now.getFullYear(), month: now.getMonth() + 1 })}
          >
            Today
          </button>
          <button type="button" className="icon-btn round" aria-label="Next month" onClick={() => go(1)}>
            <ChevronRightIcon />
          </button>
        </div>
      </header>

      <div className="month-layout">
        <div className="month-sheet">
          <div className="weekday-row" aria-hidden="true">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="month-grid" role="grid" aria-label={formatMonthYear(year, month)}>
            {cells.map((iso) => {
              const outside = new Date(iso + 'T00:00:00').getMonth() !== month - 1;
              const marks = calendarMarks(state, iso);
              const titles = eventsForDate(state, iso).slice(0, 2);
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  className={cx('cell', outside && 'is-outside', iso === today && 'is-today', iso === selected && 'is-selected')}
                  aria-current={iso === today ? 'date' : undefined}
                  aria-pressed={iso === selected}
                  onClick={() => {
                  const [cellYear, cellMonth] = iso.split('-').map(Number);
                  if (cellYear !== year || cellMonth !== month) {
                    navigate({ name: 'monthly', year: cellYear, month: cellMonth });
                  }
                  setPicked(iso);
                }}
                >
                  <span className="cell-num">{dayNumber(iso)}</span>
                  <span className="cell-titles">
                    {titles.map((event) => (
                      <span key={event.id} className={cx('cell-title', `accent-${categoryById(event.category).accent}`)}>
                        {event.title}
                      </span>
                    ))}
                  </span>
                  <span className="cell-dots" aria-hidden="true">
                    {marks.events > 0 ? <i className="dot done accent-sage" /> : null}
                    {marks.tasks > 0 ? <i className="dot done accent-blue" /> : null}
                    {marks.important ? <i className="dot done accent-peach" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="legend">
            <span><i className="dot done accent-sage" /> Schedule</span>
            <span><i className="dot done accent-blue" /> Tasks</span>
            <span><i className="dot done accent-peach" /> Important</span>
          </p>
        </div>

        <aside className="card day-panel">
          <header className="card-head">
            <div>
              <p className="kicker">{formatWeekdayShort(selected)}</p>
              <h2>{formatFullDate(selected)}</h2>
            </div>
          </header>
          {events.length === 0 && tasks.length === 0 ? (
            <p className="empty-inline">Nothing on this day yet.</p>
          ) : (
            <>
              {events.length > 0 ? (
                <ul className="panel-list">
                  {events.map((event) => (
                    <li key={event.id}>
                      <button type="button" onClick={() => openComposer({ mode: 'edit', type: 'event', id: event.id })}>
                        <time>{event.startTime}</time>
                        <span>{event.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {tasks.length > 0 ? (
                <ul className="panel-list tasks">
                  {tasks.map((task) => (
                    <li key={task.id} className={task.completed ? 'is-done' : undefined}>
                      <button type="button" onClick={() => openComposer({ mode: 'edit', type: 'task', id: task.id })}>
                        <span>{task.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          <div className="panel-actions">
            <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'event', date: selected })}>
              Add event
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => openComposer({ mode: 'create', type: 'task', date: selected })}>
              Add task
            </button>
            <button type="button" className="btn btn-soft" onClick={() => navigate({ name: 'daily', date: selected })}>
              Open day
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
