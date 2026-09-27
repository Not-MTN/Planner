import { usePlanner } from '../context';
import { cx } from '../cx';
import {
  DAY_PARTS,
  addDays,
  dayNumber,
  dayPart,
  dayPartLabel,
  formatMonthLong,
  formatWeekdayLong,
  todayISO,
  type DayPart,
} from '../dates';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { eventsForDate, habitsDueOn, tasksForDate } from '../logic';
import { EventRow, HabitRow, IntentionField, TaskRow } from '../components/items';
import { Empty } from '../components/ui';
import type { PlannerEvent } from '../types';

export function DailyView() {
  const { route, navigate, state, openComposer, swapEventTimes, swapTasks } = usePlanner();
  const date = route.name === 'daily' ? route.date : todayISO();
  const events = eventsForDate(state, date);
  const tasks = tasksForDate(state, date);
  const habits = habitsDueOn(state, date);
  const groups = DAY_PARTS.map((part) => ({
    part,
    events: events.filter((event) => dayPart(event.startTime) === part),
  })).filter((group) => group.events.length > 0);

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Daily planner</p>
          <h1 className="page-date">
            <span className="date-num">{dayNumber(date)}</span>
            <span className="page-date-meta">
              <span className="mast-weekday">{formatWeekdayLong(date)}</span>
              <span className="date-month">{formatMonthLong(date)}</span>
            </span>
          </h1>
          <p className="lede">One day, with room to breathe.</p>
        </div>
        <div className="pager">
          <button type="button" className="icon-btn round" aria-label="Previous day" onClick={() => navigate({ name: 'daily', date: addDays(date, -1) })}>
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={date === todayISO()}
            onClick={() => navigate({ name: 'daily', date: todayISO() })}
          >
            Today
          </button>
          <button type="button" className="icon-btn round" aria-label="Next day" onClick={() => navigate({ name: 'daily', date: addDays(date, 1) })}>
            <ChevronRightIcon />
          </button>
        </div>
      </header>

      <IntentionField key={date} date={date} />

      <div className="today-grid">
        <section className="card">
          <header className="card-head">
            <h2 className="kicker">Schedule</h2>
            <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'create', type: 'event', date })}>
              Add event
            </button>
          </header>
          {groups.length === 0 ? (
            <Empty
              title="Nothing timed yet."
              text="Morning, afternoon, and evening will appear as you add them."
              action={
                <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'event', date })}>
                  Add event
                </button>
              }
            />
          ) : (
            <div className="parts">
              {groups.map((group) => (
                <Part
                  key={group.part}
                  part={group.part}
                  events={group.events}
                  onSwap={(sourceId, targetId) => {
                    if (sourceId !== targetId) swapEventTimes(sourceId, targetId);
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <header className="card-head">
              <h2 className="kicker">Tasks</h2>
              <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'create', type: 'task', date })}>
                Add task
              </button>
            </header>
            {tasks.length === 0 ? (
              <Empty title="No tasks on this day." text="Leave it open, or add one small thing." />
            ) : (
              <ul className="item-list">
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onDropSwap={(sourceId) => {
                      if (sourceId !== task.id) swapTasks(sourceId, task.id);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
          <section className="card wash-lav">
            <header className="card-head">
              <h2 className="kicker">Habits</h2>
            </header>
            {habits.length === 0 ? (
              <Empty title="No habits scheduled." text="Habits appear here on the days they belong." />
            ) : (
              <ul className="item-list">
                {habits.map((habit) => (
                  <HabitRow key={habit.id} habit={habit} date={date} />
                ))}
              </ul>
            )}
          </section>
          <DayNotes date={date} />
        </div>
      </div>
    </div>
  );
}

function Part({
  part,
  events,
  onSwap,
}: {
  part: DayPart;
  events: PlannerEvent[];
  onSwap: (sourceId: string, targetId: string) => void;
}) {
  return (
    <section className={cx('part', `part-${part.toLowerCase()}`)}>
      <h3>{dayPartLabel(part)}</h3>
      <ol className="timeline compact">
        {events.map((event) => (
          <EventRow key={event.id} event={event} onDropSwap={(sourceId) => onSwap(sourceId, event.id)} />
        ))}
      </ol>
    </section>
  );
}

function DayNotes({ date }: { date: string }) {
  const { state, openComposer } = usePlanner();
  const notes = state.notes.filter((note) => note.date === date);
  return (
    <section className="card">
      <header className="card-head">
        <h2 className="kicker">Notes</h2>
        <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'create', type: 'note', date })}>
          Add note
        </button>
      </header>
      {notes.length === 0 ? (
        <p className="meta">No notes tied to this day.</p>
      ) : (
        <ul className="mini-notes">
          {notes.map((note) => (
            <li key={note.id}>
              <button type="button" onClick={() => openComposer({ mode: 'edit', type: 'note', id: note.id })}>
                <strong>{note.title}</strong>
                <span>{note.body || 'Empty note'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
