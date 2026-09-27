import { useRef, useState } from 'react';
import { categoryById } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import {
  addDays,
  dayNumber,
  dayRelation,
  formatFullDate,
  formatMonthShort,
  formatMonthYear,
  weekdayHeaders,
  formatWeekRange,
  formatWeekdayShort,
  isValidISODate,
  isWeekend,
  monthGrid,
  timeToMinutes,
  todayISO,
  weekDates, displayTime } from '../dates';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, TickIcon } from '../icons';
import {
  agendaWindow,
  calendarMarks,
  dayScore,
  eventsForDate,
  habitStats,
  hasAgendaPlans,
  habitsDueOn,
  laterAgenda,
  tasksForDate,
  type AgendaDay,
} from '../logic';
import { Meter } from '../components/ui';
import type { CalendarTab } from '../route';
import type { PlannerEvent } from '../types';

const TABS: Array<{ id: CalendarTab; label: string }> = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'agenda', label: 'Upcoming' },
];

const HORIZONS = [7, 14, 30] as const;

export function CalendarView() {
  const { route, navigate } = usePlanner();
  const anchor = route.name === 'calendar' ? route.date : todayISO();
  const tab: CalendarTab = route.name === 'calendar' ? route.tab : 'week';
  const today = todayISO();
  const setTab = (next: CalendarTab) => navigate({ name: 'calendar', tab: next, date: anchor });

  const title =
    tab === 'week' ? formatWeekRange(anchor) : tab === 'month' ? formatMonthYear(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))) : 'What’s ahead';
  const lede =
    tab === 'week'
      ? 'Seven days, loosely held.'
      : tab === 'month'
        ? 'The shape of the month.'
        : 'The days ahead, only where something is planned.';

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Calendar</p>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
        </div>
        <div className="segmented cal-tabs" role="tablist" aria-label="Calendar view">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={cx('seg', tab === item.id && 'on')}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      {tab === 'week' ? <WeekBoard anchor={anchor} today={today} /> : null}
      {tab === 'month' ? <MonthBoard anchor={anchor} today={today} /> : null}
      {tab === 'agenda' ? <AgendaBoard today={today} /> : null}
    </div>
  );
}

function WeekBoard({ anchor, today }: { anchor: string; today: string }) {
  const { navigate, state, openComposer, moveEvent, moveTask, resizeEvent, swapEventTimes, toggleTask, toggleEvent, toggleHabit } = usePlanner();
  const days = weekDates(anchor);
  const showingThisWeek = days.includes(today);
  const [picked, setPicked] = useState(anchor);
  const [over, setOver] = useState<string | null>(null);
  const selected = days.includes(picked) ? picked : days[0];

  const shift = (amount: number) => navigate({ name: 'calendar', tab: 'week', date: addDays(selected, amount) });

  return (
    <>
      <div className="cal-tools">
        <p className="quiet-hint">Drag events or tasks to another day, or drag an event’s bottom edge to change its length.</p>
        <div className="pager">
          <button type="button" className="icon-btn round" aria-label="Previous week" onClick={() => shift(-7)}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className="btn btn-ghost" disabled={showingThisWeek} onClick={() => navigate({ name: 'calendar', tab: 'week', date: today })}>
            This week
          </button>
          <button type="button" className="icon-btn round" aria-label="Next week" onClick={() => shift(7)}>
            <ChevronRightIcon />
          </button>
        </div>
      </div>

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
                if (raw.startsWith('task:')) {
                  const task = state.tasks.find((item) => item.id === raw.slice(5));
                  if (task && task.dueDate !== date) moveTask(task.id, date);
                  return;
                }
                if (!raw.startsWith('event:')) return;
                const id = raw.slice(6);
                const source = state.events.find((item) => item.id === id);
                if (!source || source.date === date) return;
                moveEvent(id, date);
              }}
            >
              <header className="day-col-head">
                <button type="button" className="day-col-date" onClick={() => navigate({ name: 'day', date })}>
                  <span>{formatWeekdayShort(date)}</span>
                  <strong>{dayNumber(date)}</strong>
                </button>
                <Meter value={score.ratio ?? 0} label={`${formatWeekdayShort(date)} completion`} />
              </header>
              <div className="day-col-body">
                {events.length === 0 && tasks.length === 0 ? <p className="open-label">Open</p> : null}
                {events.map((item) => {
                  const fixed = Boolean(item.fixedCommitmentId);
                  return (
                    <div
                      key={item.id}
                      className={cx('week-chip', `accent-${categoryById(item.category).accent}`, item.completed && 'is-done', item.important && 'is-important', fixed && 'is-fixed')}
                      draggable={!fixed}
                      onDragStart={(event) => {
                        if (fixed) return;
                        event.dataTransfer.setData('text/plain', `event:${item.id}`);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(event) => {
                        if (fixed) return;
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onDrop={(event) => {
                        if (fixed) {
                          event.preventDefault();
                          event.stopPropagation();
                          setOver(null);
                          return;
                        }
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
                        disabled={fixed}
                        title={fixed ? 'Protected weekly time' : undefined}
                        onClick={() => {
                          if (!fixed) openComposer({ mode: 'edit', type: 'event', id: item.id });
                        }}
                      >
                        <time>{displayTime(item.startTime)}{item.endTime ? `–${displayTime(item.endTime)}` : ''}</time>
                        <span>{item.title}</span>
                      </button>
                      {!fixed ? <ResizeHandle startTime={item.startTime} endTime={item.endTime} title={item.title} onResize={(end) => resizeEvent(item.id, end)} /> : null}
                      {fixed ? <span className="fixed-chip-tag">Fixed</span> : (
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
                      )}
                    </div>
                  );
                })}
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={cx('week-task', task.completed && 'is-done')}
                    draggable
                    title="Drag to another day"
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', `task:${task.id}`);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                  >
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
    </>
  );
}

const STEP = 15;

function clockFrom(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** Drag down/up to lengthen or shorten an event in 15-minute steps. Arrow keys work too. */
function ResizeHandle({ startTime, endTime, title, onResize }: { startTime: string; endTime: string | null; title: string; onResize: (end: string) => void }) {
  const start = timeToMinutes(startTime);
  const base = endTime ? timeToMinutes(endTime) : start + 60;
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{ y: number } | null>(null);
  const valueFor = (dy: number) => Math.max(start + STEP, Math.min(23 * 60 + 59, base + Math.round(dy / 6) * STEP));
  return (
    <span
      className={cx('resize-handle', preview !== null && 'is-active')}
      role="slider"
      tabIndex={0}
      aria-label={`End time for ${title}`}
      aria-valuetext={clockFrom(preview ?? base)}
      aria-valuenow={preview ?? base}
      aria-valuemin={start + STEP}
      aria-valuemax={23 * 60 + 59}
      title="Drag to change the end time"
      draggable={false}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY };
        setPreview(base);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        setPreview(valueFor(event.clientY - drag.current.y));
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        const next = valueFor(event.clientY - drag.current.y);
        drag.current = null;
        setPreview(null);
        if (next !== base) onResize(clockFrom(next));
      }}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const next = Math.max(start + STEP, Math.min(23 * 60 + 59, base + (event.key === 'ArrowDown' ? STEP : -STEP)));
        if (next !== base) onResize(clockFrom(next));
      }}
    >
      {preview !== null ? <em>until {displayTime(clockFrom(preview))}</em> : null}
    </span>
  );
}

function MonthBoard({ anchor, today }: { anchor: string; today: string }) {
  const { navigate, state, openComposer } = usePlanner();
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  const cells = monthGrid(year, month);
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const [picked, setPicked] = useState(today);
  const selected = picked.startsWith(prefix) ? picked : today.startsWith(prefix) ? today : `${prefix}-01`;
  const events = eventsForDate(state, selected);
  const tasks = tasksForDate(state, selected);
  const isCurrent = today.startsWith(prefix);

  const go = (delta: number) => {
    const date = new Date(year, month - 1 + delta, 1);
    navigate({ name: 'calendar', tab: 'month', date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01` });
  };

  return (
    <div className="month-layout">
      <div className="month-sheet">
        <div className="cal-tools">
          <div className="legend">
            <span><i className="dot done accent-sage" /> Event</span>
            <span><i className="dot done accent-blue" /> Task</span>
            <span><i className="dot done accent-peach" /> Important</span>
          </div>
          <div className="pager">
            <button type="button" className="icon-btn round" aria-label="Previous month" onClick={() => go(-1)}>
              <ChevronLeftIcon />
            </button>
            <button type="button" className="btn btn-ghost" disabled={isCurrent} onClick={() => navigate({ name: 'calendar', tab: 'month', date: today })}>
              This month
            </button>
            <button type="button" className="icon-btn round" aria-label="Next month" onClick={() => go(1)}>
              <ChevronRightIcon />
            </button>
          </div>
        </div>
        <div className="weekday-row" aria-hidden="true">
          {weekdayHeaders().map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="month-grid" role="grid" aria-label={formatMonthYear(year, month)}>
          {cells.map((iso) => {
            const outside = Number(iso.slice(5, 7)) !== month;
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
                  const cellYear = Number(iso.slice(0, 4));
                  const cellMonth = Number(iso.slice(5, 7));
                  if (cellYear !== year || cellMonth !== month) {
                    navigate({ name: 'calendar', tab: 'month', date: `${cellYear}-${String(cellMonth).padStart(2, '0')}-01` });
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
      </div>

      <aside className="card day-panel">
        <header className="card-head">
          <div>
            <p className="kicker">{formatWeekdayShort(selected)}</p>
            <h2 className="card-title">{formatFullDate(selected)}</h2>
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
                    <button
                      type="button"
                      disabled={Boolean(event.fixedCommitmentId)}
                      className={event.fixedCommitmentId ? 'fixed-panel-item' : undefined}
                      onClick={() => {
                        if (!event.fixedCommitmentId) openComposer({ mode: 'edit', type: 'event', id: event.id });
                      }}
                    >
                      <time>{displayTime(event.startTime)}</time>
                      <span>{event.title}</span>
                      {event.fixedCommitmentId ? <small>Fixed</small> : null}
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
          <button type="button" className="btn btn-primary btn-small" onClick={() => openComposer({ mode: 'create', type: 'event', date: selected })}>
            Add event
          </button>
          <button type="button" className="btn btn-soft btn-small" onClick={() => openComposer({ mode: 'create', type: 'task', date: selected })}>
            Add task
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'day', date: selected })}>
            Open day
          </button>
        </div>
      </aside>
    </div>
  );
}

function AgendaBoard({ today }: { today: string }) {
  const { state, navigate, openComposer } = usePlanner();
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(14);
  const days = agendaWindow(state, today, horizon);
  const later = laterAgenda(state, today, horizon);
  const visible = horizon === 7 ? days : days.filter((day, index) => index === 0 || hasAgendaPlans(day));
  const planned = days.filter(hasAgendaPlans).length;
  const weekLeft = state.habits.flatMap((habit) => {
    if (habit.archived || habit.frequency.type !== 'weekly') return [];
    const stats = habitStats(state, habit, weekDates(today), today);
    const left = Math.max(0, stats.expected - stats.done);
    return left > 0 ? [`${habit.name} can still happen ${left === 1 ? 'once' : `${left} times`} this week`] : [];
  });

  return (
    <>
      <div className="cal-tools">
        <p className="quiet-hint">
          {planned === 0
            ? `The next ${horizon} days are open. Add only what you want to keep.`
            : `${planned} ${planned === 1 ? 'day has' : 'days have'} something in the next ${horizon}.`}
        </p>
        <div className="pager">
          {HORIZONS.map((daysAhead) => (
            <button
              key={daysAhead}
              type="button"
              className={cx('filter', horizon === daysAhead && 'on')}
              aria-pressed={horizon === daysAhead}
              onClick={() => setHorizon(daysAhead)}
            >
              {daysAhead} days
            </button>
          ))}
        </div>
      </div>
      {weekLeft.length > 0 ? <p className="meta">{weekLeft.join(' · ')}</p> : null}
      <label className="future-jump">
        <span>Open a day</span>
        <input
          type="date"
          min={addDays(today, 1)}
          aria-label="Open a future day"
          onChange={(event) => {
            const value = event.target.value;
            if (isValidISODate(value) && value > today) navigate({ name: 'day', date: value });
          }}
        />
      </label>
      <div className="agenda-list">
        {visible.map((day) => (
          <DayCard
            key={day.date}
            day={day}
            today={today}
            onOpen={() => navigate({ name: 'day', date: day.date })}
            onAddEvent={() => openComposer({ mode: 'create', type: 'event', date: day.date })}
            onAddTask={() => openComposer({ mode: 'create', type: 'task', date: day.date })}
          />
        ))}
      </div>
      {later.events.length + later.tasks.length + later.deadlines.length > 0 ? (
        <section className="card">
          <header className="card-head">
            <h2 className="kicker">After {horizon} days</h2>
          </header>
          <ul className="panel-list">
            {later.events.map((event: PlannerEvent) => (
              <li key={event.id}>
                <button type="button" onClick={() => openComposer({ mode: 'edit', type: 'event', id: event.id })}>
                  <time>{event.date.slice(5)}</time>
                  <span>{event.title}</span>
                </button>
              </li>
            ))}
            {later.tasks.map((task) => (
              <li key={task.id} className={cx('plain', task.completed && 'is-done')}>
                <button type="button" onClick={() => openComposer({ mode: 'edit', type: 'task', id: task.id })}>
                  <time>{(task.dueDate ?? '').slice(5)}</time>
                  <span>{task.title}</span>
                </button>
              </li>
            ))}
            {later.deadlines.map((goal) => (
              <li key={goal.id} className="plain">
                <button type="button" onClick={() => openComposer({ mode: 'edit', type: 'goal', id: goal.id })}>
                  <time>{goal.date.slice(5)}</time>
                  <span>{goal.title} · due</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function fixedHabits(day: AgendaDay) {
  return day.habits.filter((habit) => habit.frequency.type !== 'weekly');
}

function DayCard({
  day,
  today,
  onOpen,
  onAddEvent,
  onAddTask,
}: {
  day: AgendaDay;
  today: string;
  onOpen: () => void;
  onAddEvent: () => void;
  onAddTask: () => void;
}) {
  const { toggleEvent, toggleTask, openComposer } = usePlanner();
  const open = !hasAgendaPlans(day);
  const habits = fixedHabits(day);
  return (
    <article className="card future-day">
      <button type="button" className="future-date" onClick={onOpen} aria-label={`Open ${formatFullDate(day.date)}`}>
        <span className="kicker">{dayRelation(day.date, today)}</span>
        <strong>{dayNumber(day.date)}</strong>
        <span>{formatMonthShort(day.date)}</span>
      </button>
      <div className="future-body">
        {day.intention ? <p className="future-intention">{day.intention}</p> : null}
        {open ? <p className="open-label">Open</p> : null}
        <ul className="plan-list">
          {day.events.map((event) => (
            <li key={event.id} className={cx('plan-line', event.completed && 'is-done', `accent-${categoryById(event.category).accent}`, event.fixedCommitmentId && 'is-fixed')}>
              {event.fixedCommitmentId ? (
                <span className="fixed-plan-mark" aria-label="Protected weekly time">↻</span>
              ) : (
                <button
                  type="button"
                  className={cx('check', event.completed && 'on')}
                  aria-pressed={event.completed}
                  aria-label={event.completed ? `Mark ${event.title} not done` : `Mark ${event.title} complete`}
                  onClick={() => toggleEvent(event.id)}
                >
                  {event.completed ? <TickIcon size={12} /> : null}
                </button>
              )}
              <time>{displayTime(event.startTime)}</time>
              {event.fixedCommitmentId ? <span className="item-title">{event.title}</span> : (
                <button type="button" className="item-title" onClick={() => openComposer({ mode: 'edit', type: 'event', id: event.id })}>{event.title}</button>
              )}
              {event.fixedCommitmentId ? <small className="fixed-plan-tag">Fixed</small> : null}
            </li>
          ))}
          {day.tasks.map((task) => (
            <li key={task.id} className={cx('plan-line', task.completed && 'is-done')}>
              <button
                type="button"
                className={cx('check', task.completed && 'on')}
                aria-pressed={task.completed}
                aria-label={task.completed ? `Mark ${task.title} not done` : `Mark ${task.title} complete`}
                onClick={() => toggleTask(task.id)}
              >
                {task.completed ? <TickIcon size={12} /> : null}
              </button>
              <time>{task.dueTime ?? ''}</time>
              <button type="button" className="item-title" onClick={() => openComposer({ mode: 'edit', type: 'task', id: task.id })}>{task.title}</button>
            </li>
          ))}
          {day.notes.map((note) => (
            <li key={note.id} className="plan-line is-note">
              <span className="plan-kind">Note</span>
              <button type="button" className="item-title" onClick={() => openComposer({ mode: 'edit', type: 'note', id: note.id })}>{note.title}</button>
            </li>
          ))}
          {day.deadlines.map((goal) => (
            <li key={goal.id} className="plan-line is-note">
              <span className="plan-kind">Due</span>
              <button type="button" className="item-title" onClick={onOpen}>{goal.title}</button>
            </li>
          ))}
        </ul>
        {habits.length > 0 ? (
          <p className="meta">{habits.slice(0, 4).map((habit) => habit.name).join(', ')}{habits.length > 4 ? ` +${habits.length - 4}` : ''}</p>
        ) : null}
        <div className="future-actions">
          <button type="button" className="btn btn-tiny" onClick={onAddEvent}>Add event</button>
          <button type="button" className="btn btn-tiny" onClick={onAddTask}>Add task</button>
          <button type="button" className="text-btn inline" onClick={onOpen}>Open day</button>
        </div>
      </div>
    </article>
  );
}
