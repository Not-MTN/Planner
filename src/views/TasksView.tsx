import { useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { addDays, formatFullDate, todayISO } from '../dates';
import { matchesQuery } from '../logic';
import { TaskRow } from '../components/items';
import { Empty } from '../components/ui';
import type { Task } from '../types';

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'done', label: 'Done' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

export function TasksView() {
  const { state, openComposer, swapTasks, moveTask } = usePlanner();
  const [filter, setFilter] = useState<FilterId>('open');
  const [query, setQuery] = useState('');
  const today = todayISO();

  const groups = useMemo(() => {
    const matched = state.tasks.filter((task) =>
      matchesQuery([task.title, task.note, task.category, task.priority], query),
    );
    const visible = matched.filter((task) => {
      if (filter === 'done') return task.completed;
      if (filter === 'today') return task.dueDate === today;
      if (filter === 'upcoming') return !task.completed && task.dueDate !== null && task.dueDate > today;
      return !task.completed;
    });
    if (filter === 'done') return [{ id: 'done', label: 'Completed', tasks: sortTasks(visible) }];
    const carried = visible.filter((task) => task.dueDate !== null && task.dueDate < today);
    const dueToday = visible.filter((task) => task.dueDate === today);
    const later = visible.filter((task) => task.dueDate !== null && task.dueDate > today);
    const inbox = visible.filter((task) => !task.dueDate);
    const byDate = new Map<string, Task[]>();
    for (const task of later) {
      const key = task.dueDate as string;
      byDate.set(key, [...(byDate.get(key) ?? []), task]);
    }
    return [
      { id: 'carried', label: 'Carried over', tasks: sortTasks(carried) },
      { id: 'today', label: 'Today', tasks: sortTasks(dueToday) },
      ...[...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, tasks]) => ({
        id: date,
        label: formatFullDate(date),
        tasks: sortTasks(tasks),
      })),
      { id: 'inbox', label: 'Anytime', tasks: sortTasks(inbox) },
    ].filter((group) => group.tasks.length > 0);
  }, [state.tasks, filter, query, today]);

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Tasks</p>
          <h1>Tasks</h1>
          <p className="lede">What you’ve promised yourself.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'task', date: today })}>
          Add task
        </button>
      </header>
      <div className="toolbar">
        <div className="filters" role="tablist" aria-label="Task filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={cx('filter', filter === item.id && 'on')}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="search">
          <span className="visually-hidden">Search tasks</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" />
        </label>
      </div>
      {state.tasks.length === 0 ? (
        <section className="card">
          <Empty
            title="Your list is clear."
            text="Add a task when something actually needs a place."
            action={
              <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'task', date: today })}>
                Add task
              </button>
            }
          />
        </section>
      ) : groups.length === 0 ? (
        <section className="card">
          <Empty title="Nothing in this view." text="Try another filter, or clear the search." />
        </section>
      ) : (
        <div className="stack">
          {groups.map((group) => (
            <section key={group.id} className="card">
              <h2 className="kicker">{group.label}</h2>
              <ul className="item-list">
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    showDate={filter === 'done' || group.id === 'carried'}
                    onReschedule={group.id === 'carried' ? () => moveTask(task.id, addDays(today, 1)) : undefined}
                    rescheduleLabel="Move to tomorrow"
                    onDropSwap={(sourceId) => {
                      if (sourceId !== task.id) swapTasks(sourceId, task.id);
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || a.sortOrder - b.sortOrder;
  });
}
