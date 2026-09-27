import { useState } from 'react';
import { categoryById } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { addDays, dayNumber, dayRelation, formatFullDate, formatMonthShort, formatWeekdayShort, isValidISODate, todayISO, weekDates } from '../dates';
import { TickIcon } from '../icons';
import { agendaWindow, habitStats, hasAgendaPlans, laterAgenda, type AgendaDay } from '../logic';

const HORIZONS = [7, 14, 30] as const;

export function FutureView() {
  const { state, navigate, openComposer, toggleEvent, toggleTask } = usePlanner();
  const today = todayISO();
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(14);
  const days = agendaWindow(state, today, horizon);
  const later = laterAgenda(state, today, horizon);
  const visible = horizon === 7 ? days : days.filter((day, index) => index === 0 || hasAgendaPlans(day));
  const planned = days.filter(hasAgendaPlans).length;
  const laterCount = later.events.length + later.tasks.length + later.deadlines.length;
  const weekLeft = state.habits.flatMap((habit) => {
    if (habit.archived || habit.frequency.type !== 'weekly') return [];
    const stats = habitStats(state, habit, weekDates(today), today);
    const left = Math.max(0, stats.expected - stats.done);
    return left > 0 ? [`${habit.name} can still happen ${left === 1 ? 'once' : `${left} times`} this week`] : [];
  });

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Future</p>
          <h1>Ahead</h1>
          <p className="lede">
            {planned === 0
              ? `The next ${horizon} days are open. Add only what you want to keep.`
              : `${planned} ${planned === 1 ? 'day has' : 'days have'} something in the next ${horizon}.`}
          </p>
        </div>
        <div className="horizon" role="group" aria-label="How far ahead">
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
      </header>
      <p className="quiet-hint">Seven days shows every day. A longer view keeps only tomorrow and the days that already have plans.</p>
      {weekLeft.length > 0 ? <p className="meta">{weekLeft.join(' · ')}</p> : null}
      <label className="future-jump">
        <span>Open a day</span>
        <input
          type="date"
          min={addDays(today, 1)}
          aria-label="Open a future day"
          onChange={(event) => {
            const value = event.target.value;
            if (isValidISODate(value) && value > today) navigate({ name: 'daily', date: value });
          }}
        />
      </label>

      <div className="future-list">
        {visible.map((day) => (
          <DayCard
            key={day.date}
            day={day}
            today={today}
            onOpen={() => navigate({ name: 'daily', date: day.date })}
            onAddEvent={() => openComposer({ mode: 'create', type: 'event', date: day.date })}
            onAddTask={() => openComposer({ mode: 'create', type: 'task', date: day.date })}
            onToggleEvent={toggleEvent}
            onToggleTask={toggleTask}
            onEditEvent={(id) => openComposer({ mode: 'edit', type: 'event', id })}
            onEditTask={(id) => openComposer({ mode: 'edit', type: 'task', id })}
            onEditNote={(id) => openComposer({ mode: 'edit', type: 'note', id })}
            onOpenGoals={() => navigate({ name: 'goals' })}
          />
        ))}
      </div>

      {laterCount > 0 ? (
        <section className="card later-card">
          <header className="card-head">
            <div>
              <p className="kicker">Later</p>
              <h2 className="section-title">Beyond this stretch</h2>
            </div>
            <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'monthly', year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })}>
              Month
            </button>
          </header>
          <ul className="later-list">
            {later.events.slice(0, 8).map((event) => (
              <li key={event.id}>
                <button type="button" onClick={() => openComposer({ mode: 'edit', type: 'event', id: event.id })}>
                  <time>{formatWeekdayShort(event.date)} {dayNumber(event.date)}</time>
                  <span>{event.title}</span>
                </button>
              </li>
            ))}
            {later.tasks.slice(0, 8).map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => openComposer({ mode: 'edit', type: 'task', id: task.id })}>
                  <time>{task.dueDate ? `${formatWeekdayShort(task.dueDate)} ${dayNumber(task.dueDate)}` : 'Anytime'}</time>
                  <span>{task.title}</span>
                </button>
              </li>
            ))}
            {later.deadlines.slice(0, 6).map((goal) => (
              <li key={goal.id}>
                <button type="button" onClick={() => navigate({ name: 'goals' })}>
                  <time>{formatWeekdayShort(goal.date)} {dayNumber(goal.date)}</time>
                  <span>{goal.title}</span>
                </button>
              </li>
            ))}
          </ul>
          {laterCount > 14 ? <p className="meta">More is waiting on the month and in tasks.</p> : null}
        </section>
      ) : null}
    </div>
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
  onToggleEvent,
  onToggleTask,
  onEditEvent,
  onEditTask,
  onEditNote,
  onOpenGoals,
}: {
  day: AgendaDay;
  today: string;
  onOpen: () => void;
  onAddEvent: () => void;
  onAddTask: () => void;
  onToggleEvent: (id: string) => void;
  onToggleTask: (id: string) => void;
  onEditEvent: (id: string) => void;
  onEditTask: (id: string) => void;
  onEditNote: (id: string) => void;
  onOpenGoals: () => void;
}) {
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
            <li key={event.id} className={cx('plan-line', event.completed && 'is-done', `accent-${categoryById(event.category).accent}`)}>
              <button
                type="button"
                className={cx('check', event.completed && 'on')}
                aria-pressed={event.completed}
                aria-label={event.completed ? `Mark ${event.title} not done` : `Mark ${event.title} complete`}
                onClick={() => onToggleEvent(event.id)}
              >
                {event.completed ? <TickIcon size={12} /> : null}
              </button>
              <time>{event.startTime}</time>
              <button type="button" className="item-title" onClick={() => onEditEvent(event.id)}>{event.title}</button>
            </li>
          ))}
          {day.tasks.map((task) => (
            <li key={task.id} className={cx('plan-line', task.completed && 'is-done')}>
              <button
                type="button"
                className={cx('check', task.completed && 'on')}
                aria-pressed={task.completed}
                aria-label={task.completed ? `Mark ${task.title} not done` : `Mark ${task.title} complete`}
                onClick={() => onToggleTask(task.id)}
              >
                {task.completed ? <TickIcon size={12} /> : null}
              </button>
              <time>{task.dueTime ?? ''}</time>
              <button type="button" className="item-title" onClick={() => onEditTask(task.id)}>{task.title}</button>
            </li>
          ))}
          {day.notes.map((note) => (
            <li key={note.id} className="plan-line is-note">
              <span className="plan-kind">Note</span>
              <button type="button" className="item-title" onClick={() => onEditNote(note.id)}>{note.title}</button>
            </li>
          ))}
          {day.deadlines.map((goal) => (
            <li key={goal.id} className="plan-line is-note">
              <span className="plan-kind">Due</span>
              <button type="button" className="item-title" onClick={onOpenGoals}>{goal.title}</button>
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
