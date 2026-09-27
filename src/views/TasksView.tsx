import { useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { CATEGORIES, PRIORITIES, type Priority } from '../constants';
import { addDays, formatFullDate, todayISO } from '../dates';
import { matchesQuery } from '../logic';
import { TaskRow } from '../components/items';
import { Empty } from '../components/ui';
import { SparklesIcon } from '../icons';
import type { Task } from '../types';
import { TaskBoard, type BoardGroup } from './TaskBoard';
import { t } from '../i18n';

const LAYOUT_KEY = 'planner-task-layout';

function loadLayout(): { layout: 'list' | 'board'; group: BoardGroup } {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as { layout?: string; group?: string };
    return {
      layout: raw.layout === 'board' ? 'board' : 'list',
      group: raw.group === 'priority' || raw.group === 'category' ? raw.group : 'when',
    };
  } catch {
    return { layout: 'list', group: 'when' };
  }
}

const FILTERS = [
  { id: 'open', label: t("Open") },
  { id: 'overdue', label: t("Overdue") },
  { id: 'waiting', label: t("Waiting") },
  { id: 'today', label: t("Today") },
  { id: 'upcoming', label: t("Upcoming") },
  { id: 'done', label: t("Done") },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

export function TasksView() {
  const { state, openComposer, swapTasks, moveTask, clearCompletedTasks, loadSample, isEmpty } = useTaskViewHelpers();
  const bulk = useBulkActions();
  const [filter, setFilter] = useState<FilterId>('open');
  const [query, setQuery] = useState('');
  const [view, setView] = useState(loadLayout);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkPriority, setBulkPriority] = useState('');
  const today = todayISO();
  const changeView = (next: typeof view) => {
    setView(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const searched = useMemo(
    () => state.tasks.filter((task) => matchesQuery([task.title, task.note, task.category, task.priority, ...task.subtasks.map((item) => item.title)], query)),
    [state.tasks, query],
  );

  const counts = useMemo(
    () => ({
      open: state.tasks.filter((task) => !task.completed).length,
      overdue: state.tasks.filter((task) => !task.completed && !task.waiting && task.dueDate !== null && task.dueDate < today).length,
      waiting: state.tasks.filter((task) => !task.completed && Boolean(task.waiting)).length,
      today: state.tasks.filter((task) => task.dueDate === today).length,
      upcoming: state.tasks.filter((task) => !task.completed && task.dueDate !== null && task.dueDate > today).length,
      done: state.tasks.filter((task) => task.completed).length,
    }),
    [state.tasks, today],
  );

  const groups = useMemo(() => {
    const matched = searched;
    const visible = matched.filter((task) => {
      if (filter === 'done') return task.completed;
      if (filter === 'overdue') return !task.completed && !task.waiting && task.dueDate !== null && task.dueDate < today;
      if (filter === 'waiting') return !task.completed && Boolean(task.waiting);
      if (filter === 'today') return task.dueDate === today;
      if (filter === 'upcoming') return !task.completed && task.dueDate !== null && task.dueDate > today;
      return !task.completed;
    });
    if (filter === 'overdue') return [{ id: 'carried', label: t("Overdue"), tasks: sortTasks(visible) }];
    if (filter === 'waiting') return [{ id: 'waiting', label: t("Waiting"), tasks: sortTasks(visible) }];
    if (filter === 'done') return [{ id: 'done', label: t("Completed"), tasks: sortTasks(visible) }];
    if (filter === 'upcoming') {
      const byDate = new Map<string, Task[]>();
      for (const task of visible) {
        const key = task.dueDate as string;
        byDate.set(key, [...(byDate.get(key) ?? []), task]);
      }
      return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, tasks]) => ({
        id: date,
        label: formatFullDate(date),
        tasks: sortTasks(tasks),
      }));
    }
    const carried = visible.filter((task) => task.dueDate !== null && task.dueDate < today);
    const dueToday = visible.filter((task) => task.dueDate === today);
    const inbox = visible.filter((task) => !task.dueDate);
    return [
      { id: 'carried', label: t("Carried over"), tasks: sortTasks(carried) },
      { id: 'today', label: t("Today"), tasks: sortTasks(dueToday) },
      { id: 'inbox', label: t("Anytime"), tasks: sortTasks(inbox) },
    ].filter((group) => group.tasks.length > 0);
  }, [searched, filter, today]);

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">{t("Tasks")}</p>
          <h1>{t("Tasks")}</h1>
          <p className="lede">{t("What you’ve promised yourself.")}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'task', date: today })}>
          {t("Add task")}
        </button>
      </header>
      <div className="toolbar">
        <div className="segmented layout-switch" role="radiogroup" aria-label={t("Layout")}>
          {(['list', 'board'] as const).map((layout) => (
            <button key={layout} type="button" role="radio" aria-checked={view.layout === layout} className={cx('seg', view.layout === layout && 'on')} onClick={() => changeView({ ...view, layout })}>
              {layout === 'list' ? t("List") : t("Board")}
            </button>
          ))}
        </div>
        {view.layout === 'board' ? (
          <label className="board-group">
            <span>{t("Group by")}</span>
            <select value={view.group} onChange={(event) => changeView({ ...view, group: event.target.value as BoardGroup })}>
              <option value="when">{t("When")}</option>
              <option value="priority">{t("Priority")}</option>
              <option value="category">{t("Category")}</option>
            </select>
          </label>
        ) : (
        <div className="filters" role="tablist" aria-label={t("Task filters")}>
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
              <span className="filter-count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        )}
        <label className="search">
          <span className="visually-hidden">{t("Search tasks")}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search tasks")} />
        </label>
        {view.layout === 'list' && state.tasks.length > 0 ? (
          <button
            type="button"
            className={cx('btn', 'btn-soft', 'btn-small', selecting && 'btn-primary')}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((value) => !value);
              setSelected(new Set());
            }}
          >
            {selecting ? t("Done selecting") : t("Select")}
          </button>
        ) : null}
      </div>
      {state.tasks.length === 0 ? (
        <section className="card">
          <Empty
            image="/img/spot-tasks.jpg"
            title={t("Your list is clear.")}
            text={t("Add a task when something actually needs a place.")}
            action={
              isEmpty ? (
                <button type="button" className="btn btn-ghost" onClick={loadSample}>
                  <SparklesIcon size={15} /> {t("Try a sample day")}
                </button>
              ) : undefined
            }
          />
        </section>
      ) : view.layout === 'board' ? (
        <TaskBoard tasks={searched} group={view.group} today={today} />
      ) : groups.length === 0 ? (
        <section className="card">
          <Empty title={t("Nothing in this view.")} text={t("Try another filter, or clear the search.")} />
        </section>
      ) : (
        <div className="stack">
          {groups.map((group) => (
            <section key={group.id} className="card">
              <header className="card-head">
                <h2 className="kicker">{group.label}</h2>
                {group.id === 'done' && counts.done > 0 ? (
                  <button type="button" className="btn btn-tiny danger" onClick={clearCompletedTasks}>
                    {t("Clear completed")}
                  </button>
                ) : null}
              </header>
              <ul className="item-list">
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    showDate={filter === 'done' || group.id === 'carried' || filter === 'upcoming'}
                    onReschedule={group.id === 'carried' ? () => moveTask(task.id, addDays(today, 1)) : undefined}
                    rescheduleLabel={t("Move to tomorrow")}
                    selection={
                      selecting
                        ? {
                            selected: selected.has(task.id),
                            onToggle: () =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (next.has(task.id)) next.delete(task.id);
                                else next.add(task.id);
                                return next;
                              }),
                          }
                        : undefined
                    }
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
      {selecting && selected.size > 0 ? (
        <div className="bulk-bar" role="toolbar" aria-label={t("Bulk actions")}>
          <span className="bulk-count">{t("{0} selected", { 0: selected.size })}</span>
          <button type="button" className="btn btn-small btn-soft" onClick={() => { bulk.completeTasksByIds([...selected], true); done(); }}>
            {t("Complete")}
          </button>
          <button type="button" className="btn btn-small btn-soft" onClick={() => { bulk.completeTasksByIds([...selected], false); done(); }}>
            {t("Reopen")}
          </button>
          <input type="date" className="bulk-date" value={bulkDate} aria-label={t("Move all to date")} onChange={(event) => setBulkDate(event.target.value)} />
          <button type="button" className="btn btn-small btn-soft" disabled={!bulkDate} onClick={() => { bulk.moveTasksByIds([...selected], bulkDate); done(); }}>
            {t("Set date")}
          </button>
          <select value={bulkCategory} aria-label={t("Set category")} onChange={(event) => { if (event.target.value) { bulk.updateTasksByIds([...selected], { category: event.target.value }); setBulkCategory(''); done(); } }}>
            <option value="">{t("Category…")}</option>
            {CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <select value={bulkPriority} aria-label={t("Set priority")} onChange={(event) => { if (event.target.value) { bulk.updateTasksByIds([...selected], { priority: event.target.value as Priority }); setBulkPriority(''); done(); } }}>
            <option value="">{t("Priority…")}</option>
            {PRIORITIES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-small danger"
            onClick={() => {
              const count = selected.size;
              bulk.deleteTasksByIds([...selected]);
              done();
              bulk.flash(t("{0} {1} removed.", { 0: count, 1: count === 1 ? t("task") : t("tasks") }), { label: t("Undo"), run: bulk.undo });
            }}
          >
            {t("Delete")}
          </button>
          <button type="button" className="text-btn" onClick={done}>
            {t("Clear")}
          </button>
        </div>
      ) : null}
    </div>
  );

  function done() {
    setSelecting(false);
    setSelected(new Set());
    setBulkDate('');
  }
}

function useBulkActions() {
  const { completeTasksByIds, updateTasksByIds, deleteTasksByIds, moveTasksByIds, flash, undo } = usePlanner();
  return { completeTasksByIds, updateTasksByIds, deleteTasksByIds, moveTasksByIds, flash, undo };
}

function useTaskViewHelpers() {
  const planner = usePlanner();
  const { state } = planner;
  return {
    ...planner,
    isEmpty:
      state.tasks.length === 0 &&
      state.events.length === 0 &&
      state.habits.length === 0 &&
      state.goals.length === 0 &&
      state.notes.length === 0,
  };
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || a.sortOrder - b.sortOrder;
  });
}
