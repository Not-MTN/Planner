import { useState } from 'react';
import { CATEGORIES, categoryById, PRIORITIES } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { addDays, dayNumber, formatMonthShort, formatWeekdayShort, displayTime } from '../dates';
import { TickIcon } from '../icons';
import type { Task, TaskInput } from '../types';

export type BoardGroup = 'when' | 'priority' | 'category';

interface Column {
  id: string;
  label: string;
  tasks: Task[];
  /** What dropping a task here changes. `null` = can't drop. */
  patch: Partial<TaskInput> | 'done' | null;
}

function whenColumns(tasks: Task[], today: string): Column[] {
  const weekEnd = addDays(today, 7);
  const open = tasks.filter((task) => !task.completed);
  return [
    { id: 'overdue', label: 'Overdue', tasks: open.filter((task) => task.dueDate !== null && task.dueDate < today), patch: null },
    { id: 'today', label: 'Today', tasks: open.filter((task) => task.dueDate === today), patch: { dueDate: today } },
    { id: 'tomorrow', label: 'Tomorrow', tasks: open.filter((task) => task.dueDate === addDays(today, 1)), patch: { dueDate: addDays(today, 1) } },
    {
      id: 'week',
      label: 'This week',
      tasks: open.filter((task) => task.dueDate !== null && task.dueDate > addDays(today, 1) && task.dueDate <= weekEnd),
      patch: { dueDate: addDays(today, 3) },
    },
    { id: 'later', label: 'Later', tasks: open.filter((task) => task.dueDate !== null && task.dueDate > weekEnd), patch: { dueDate: addDays(today, 14) } },
    { id: 'anytime', label: 'Anytime', tasks: open.filter((task) => !task.dueDate), patch: { dueDate: null } },
    { id: 'done', label: 'Done', tasks: tasks.filter((task) => task.completed), patch: 'done' },
  ];
}

export function boardColumns(tasks: Task[], group: BoardGroup, today: string): Column[] {
  if (group === 'when') return whenColumns(tasks, today);
  const open = tasks.filter((task) => !task.completed);
  const done: Column = { id: 'done', label: 'Done', tasks: tasks.filter((task) => task.completed), patch: 'done' };
  if (group === 'priority') {
    return [
      ...[...PRIORITIES].reverse().map((item) => ({
        id: item.id,
        label: item.label,
        tasks: open.filter((task) => task.priority === item.id),
        patch: { priority: item.id } as Partial<TaskInput>,
      })),
      done,
    ];
  }
  return [
    ...CATEGORIES.map((item) => ({
      id: item.id,
      label: item.label,
      tasks: open.filter((task) => categoryById(task.category).id === item.id),
      patch: { category: item.id } as Partial<TaskInput>,
    })),
    done,
  ];
}

function sortForBoard(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
      a.sortOrder - b.sortOrder,
  );
}

export function TaskBoard({ tasks, group, today }: { tasks: Task[]; group: BoardGroup; today: string }) {
  const { state, toggleTask, updateTask, openComposer } = usePlanner();
  const [over, setOver] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const columns = boardColumns(tasks, group, today);

  const drop = (column: Column, id: string) => {
    const task = state.tasks.find((item) => item.id === id);
    if (!task || !column.patch) return;
    if (column.patch === 'done') {
      if (!task.completed) toggleTask(id);
      return;
    }
    if (task.completed) toggleTask(id);
    updateTask(id, column.patch);
  };

  return (
    <>
    <p className="visually-hidden" role="status" aria-live="polite">{announce}</p>
    <div className="board" role="list" aria-label="Task board">
      {columns.map((column) => (
        <section
          key={column.id}
          role="listitem"
          aria-label={`${column.label}, ${column.tasks.length} tasks`}
          className={cx('board-col', `board-${column.id}`, over === column.id && 'is-drop', !column.patch && 'no-drop')}
          onDragOver={(event) => {
            if (!column.patch) return;
            event.preventDefault();
            setOver(column.id);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setOver(null);
            const raw = event.dataTransfer.getData('text/plain');
            if (raw.startsWith('task:')) drop(column, raw.slice(5));
          }}
        >
          <header className="board-head">
            <h2 className="kicker">{column.label}</h2>
            <span className="filter-count">{column.tasks.length}</span>
          </header>
          <ul className="board-cards">
            {sortForBoard(column.tasks).map((task) => {
              const steps = task.subtasks.length;
              const stepsDone = task.subtasks.filter((item) => item.completed).length;
              return (
                <li
                  key={task.id}
                  className={cx('board-card', `accent-${categoryById(task.category).accent}`, task.completed && 'is-done', `prio-card-${task.priority}`)}
                  draggable
                  tabIndex={0}
                  aria-keyshortcuts="ArrowLeft ArrowRight"
                  aria-label={`${task.title}. Press left or right arrow to move between columns.`}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                    event.preventDefault();
                    const index = columns.findIndex((item) => item.id === column.id);
                    const step = event.key === 'ArrowRight' ? 1 : -1;
                    for (let next = index + step; next >= 0 && next < columns.length; next += step) {
                      if (columns[next].patch) {
                        drop(columns[next], task.id);
                        setAnnounce(`${task.title} moved to ${columns[next].label}`);
                        window.setTimeout(() => {
                          document.querySelector<HTMLElement>(`[data-card="${task.id}"]`)?.focus();
                        }, 0);
                        break;
                      }
                    }
                  }}
                  data-card={task.id}
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
                  <button type="button" className="board-card-body" onClick={() => openComposer({ mode: 'edit', type: 'task', id: task.id })}>
                    <strong>{task.title}</strong>
                    <small>
                      {task.dueDate ? `${formatWeekdayShort(task.dueDate)} ${dayNumber(task.dueDate)} ${formatMonthShort(task.dueDate)}` : 'No date'}
                      {task.dueTime ? ` · ${displayTime(task.dueTime)}` : ''}
                      {task.repeat ? ' · ↻' : ''}
                      {steps ? ` · ${stepsDone}/${steps}` : ''}
                    </small>
                  </button>
                </li>
              );
            })}
            {column.tasks.length === 0 ? <li className="board-empty">{column.patch ? 'Drop here' : 'Nothing overdue'}</li> : null}
          </ul>
        </section>
      ))}
    </div>
    </>
  );
}
