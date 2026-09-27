import type { ReactNode } from 'react';
import { usePlanner } from '../context';
import { addDays, dayNumber, dayRelation, formatClock, formatMonthLong, formatWeekdayLong, motivationFor, timeToMinutes, todayISO } from '../dates';
import { ChevronRightIcon, PlusIcon } from '../icons';
import { useNow } from '../hooks';
import { dayScore, eventsForDate, habitsDueOn, overdueTasks, progressPhrase, tasksForDate, upcomingFocus } from '../logic';
import { EventRow, HabitRow, IntentionField, NowMark, TaskRow } from '../components/items';
import { Empty, Ring } from '../components/ui';

export function TodayView() {
  const { state, openComposer, navigate, swapEventTimes, swapTasks, moveTask } = usePlanner();
  const now = useNow();
  const today = todayISO(now);
  const events = eventsForDate(state, today);
  const openTasks = tasksForDate(state, today).filter((task) => !task.completed);
  const doneTasks = tasksForDate(state, today).filter((task) => task.completed);
  const habits = habitsDueOn(state, today);
  const carried = overdueTasks(state, today);
  const score = dayScore(state, today, true);
  const focus = upcomingFocus(state, today);
  const clock = formatClock(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const timeline: ReactNode[] = [];
  let placedNow = false;
  for (const event of events) {
    if (!placedNow && nowMin <= timeToMinutes(event.startTime)) {
      placedNow = true;
      timeline.push(
        <li key="now" className="timeline-slot">
          <NowMark time={clock} />
        </li>,
      );
    }
    timeline.push(
      <EventRow
        key={event.id}
        event={event}
        onDropSwap={(sourceId) => {
          if (sourceId !== event.id) swapEventTimes(sourceId, event.id);
        }}
      />,
    );
  }
  if (!placedNow) {
    timeline.push(
      <li key="now" className="timeline-slot">
        <NowMark time={clock} />
      </li>,
    );
  }

  return (
    <div className="view">
      <header className="mast">
        <div className="mast-copy">
          <p className="eyebrow">Personal Planner</p>
          <h1>
            <span className="mast-weekday">{formatWeekdayLong(today)}</span>
            <span className="date-lockup">
              <span className="date-num">{dayNumber(today)}</span>
              <span>
                <span className="date-month">{formatMonthLong(today)}</span>
                <span className="clock">{clock}</span>
              </span>
            </span>
          </h1>
          <p className="lede">Plan your day. Build better habits. Make progress.</p>
          <p className="quote">{motivationFor(today)}</p>
          {focus.length > 0 ? (
            <ul className="coming-up">
              {focus.map((item) => (
                <li key={`${item.kind}-${item.date}-${item.title}`}>
                  <span>{formatWeekdayLong(item.date).slice(0, 3)} {dayNumber(item.date)}</span>
                  {item.title}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mast-links">
            <button type="button" className="text-btn mast-link" onClick={() => navigate({ name: 'daily', date: today })}>
              Open the full day <ChevronRightIcon size={16} />
            </button>
            <button type="button" className="text-btn mast-link" onClick={() => navigate({ name: 'future' })}>
              {dayRelation(addDays(today, 1), today)} and beyond <ChevronRightIcon size={16} />
            </button>
          </div>
        </div>

        <aside className="mast-panel card wash-sage">
          <p className="kicker">Today’s progress</p>
          <Ring value={score.ratio ?? 0} label={score.total ? `${score.done}/${score.total}` : 'Open'} caption="in motion" />
          <p className="progress-phrase">{progressPhrase(score.ratio)}</p>
          <p className="meta">
            {score.eventsDone}/{score.eventsTotal} plans · {score.tasksDone}/{score.tasksTotal} tasks · {score.habitsDone}/{score.habitsTotal} habits
          </p>
          <div className="qa-row">
            <button type="button" className="qa-tile accent-peach" onClick={() => openComposer({ mode: 'create', type: 'task', date: today })}>
              <span className="qa-icon"><PlusIcon size={15} /></span>
              Task
            </button>
            <button type="button" className="qa-tile accent-sage" onClick={() => openComposer({ mode: 'create', type: 'habit' })}>
              <span className="qa-icon"><PlusIcon size={15} /></span>
              Habit
            </button>
            <button type="button" className="qa-tile accent-pink" onClick={() => openComposer({ mode: 'create', type: 'note', date: today })}>
              <span className="qa-icon"><PlusIcon size={15} /></span>
              Note
            </button>
          </div>
          <button type="button" className="text-btn" onClick={() => openComposer({ mode: 'create', type: 'event', date: today })}>
            Add an event
          </button>
        </aside>
      </header>

      <IntentionField key={today} date={today} />

      <div className="today-grid">
        <section className="card timeline-card">
          <header className="card-head">
            <div>
              <p className="kicker">Schedule</p>
              <h2 className="section-title">The day</h2>
            </div>
            <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'create', type: 'event', date: today })}>
              Add event
            </button>
          </header>
          {events.length === 0 ? (
            <div className="timeline timeline-empty">
              <NowMark time={clock} />
              <Empty
                title="Your day is still open."
                text="Add a time only for what you want to protect."
                action={
                  <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'event', date: today })}>
                    Add event
                  </button>
                }
              />
            </div>
          ) : (
            <ol className="timeline">{timeline}</ol>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <header className="card-head">
              <div>
                <p className="kicker">Checklist</p>
                <h2 className="section-title">Tasks</h2>
              </div>
              <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'tasks' })}>
                All tasks
              </button>
            </header>
            {carried.length > 0 ? (
              <div className="carried">
                <p>Carried over</p>
                <ul className="item-list">
                  {carried.slice(0, 4).map((task) => (
                    <TaskRow
                    key={task.id}
                    task={task}
                    showDate
                    onReschedule={() => moveTask(task.id, addDays(today, 1))}
                    rescheduleLabel="Move to tomorrow"
                    onDropSwap={(sourceId) => sourceId !== task.id && swapTasks(sourceId, task.id)}
                  />
                  ))}
                </ul>
                {carried.length > 4 ? (
                  <button type="button" className="text-btn" onClick={() => navigate({ name: 'tasks' })}>
                    {carried.length - 4} more
                  </button>
                ) : null}
              </div>
            ) : null}
            {openTasks.length === 0 && doneTasks.length === 0 ? (
              <Empty
                title="No tasks for today."
                text="A short list is easier to finish."
                action={
                  <button type="button" className="btn btn-soft" onClick={() => openComposer({ mode: 'create', type: 'task', date: today })}>
                    Add task
                  </button>
                }
              />
            ) : (
              <ul className="item-list">
                {[...openTasks, ...doneTasks].map((task) => (
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
              <div>
                <p className="kicker">Repeat</p>
                <h2 className="section-title">Habits</h2>
              </div>
              <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'habits' })}>
                History
              </button>
            </header>
            {habits.length === 0 ? (
              <Empty
                title="No habits for today."
                text="Start with one thing you want to repeat."
                action={
                  <button type="button" className="btn btn-soft" onClick={() => openComposer({ mode: 'create', type: 'habit' })}>
                    Add habit
                  </button>
                }
              />
            ) : (
              <ul className="item-list">
                {habits.map((habit) => (
                  <HabitRow key={habit.id} habit={habit} date={today} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
