import { useEffect, useState } from 'react';
import { categoryById } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { addDays, dayNumber, formatDuration, formatMonthShort, formatWeekdayShort, isValidTime, displayTime, nextMonth, nextWeekend, todayISO } from '../dates';
import { frequencyLabel, habitProgress, habitStreaks, isSkipped } from '../logic';
import { formatEstimate } from '../quickAdd';
import { FlameIcon, GripIcon, HabitGlyph, PencilIcon, StopwatchIcon, TickIcon, TrashIcon } from '../icons';
import { InlineTitle } from './InlineTitle';
import { repeatLabel } from '../recurrence';
import type { Habit, PlannerEvent, Task } from '../types';
import { t } from '../i18n';

export function IntentionField({ date }: { date: string }) {
  const { state, setIntention } = usePlanner();
  const saved = state.intentions[date] ?? '';
  const [text, setText] = useState(saved);

  useEffect(() => {
    setText(saved);
  }, [saved, date]);

  useEffect(() => {
    if (text === saved) return;
    const id = window.setTimeout(() => setIntention(date, text), 280);
    return () => window.clearTimeout(id);
  }, [text, saved, date, setIntention]);

  return (
    <label className="intention">
      <span>{t("Intention")}</span>
      <input
        value={text}
        maxLength={160}
        placeholder={t("One line for this day — optional")}
        dir="auto"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== saved) setIntention(date, text);
        }}
      />
    </label>
  );
}

export function EventRow({ event, onDropSwap }: { event: PlannerEvent; onDropSwap?: (sourceId: string) => void }) {
  const { toggleEvent, updateEvent, openComposer, deleteEvent, flash, undo } = usePlanner();
  const accent = categoryById(event.category).accent;
  const series = Boolean(event.seriesEventId);
  const editId = event.seriesEventId ?? event.id;
  const duration = formatDuration(event.startTime, event.endTime);
  return (
    <li
      className={cx('event', `accent-${accent}`, event.completed && 'is-done')}
      onDragOver={(dragEvent) => {
        if (!onDropSwap) return;
        dragEvent.preventDefault();
      }}
      onDrop={(dragEvent) => {
        if (!onDropSwap) return;
        dragEvent.preventDefault();
        dragEvent.stopPropagation();
        const raw = dragEvent.dataTransfer.getData('text/plain');
        if (raw.startsWith('event:')) onDropSwap(raw.slice(6));
      }}
    >
      <button
        type="button"
        className={cx('check', event.completed && 'on')}
        aria-pressed={event.completed}
        aria-label={event.completed ? t("Mark {0} not done", { 0: event.title }) : t("Mark {0} complete", { 0: event.title })}
        onClick={() => {
          if (!series) toggleEvent(event.id);
        }}
      >
        {event.completed ? <TickIcon size={14} /> : null}
      </button>
      <label className="time-field">
        <span className="visually-hidden">{t("Start time for")} {event.title}</span>
        <input
          type="time"
          value={event.startTime}
          onChange={(input) => {
            const value = input.target.value.slice(0, 5);
            if (isValidTime(value)) updateEvent(event.id, { startTime: value });
          }}
        />
      </label>
      <div className="item-body">
        <button type="button" className="item-title" dir="auto" onClick={() => openComposer({ mode: 'edit', type: 'event', id: editId })}>
          {event.title}
        </button>
        <p className="meta">
          <i className={cx('dot-inline', `accent-${accent}`)} aria-hidden="true" />
          {t("{category}{duration}{important}", {
            category: categoryById(event.category).label,
            duration: duration ? ` · ${duration}` : '',
            important: event.important ? ` · ${t("Important")}` : '',
          })}
          {event.repeat || series ? <span className="repeat-chip">↻ {repeatLabel(event.repeat)}</span> : null}
        </p>
      </div>
      <span
        className="grip"
        draggable
        aria-label={t("Drag {0} to swap times", { 0: event.title })}
        title={t("Drag onto another plan to swap times")}
        onDragStart={(dragEvent) => {
          dragEvent.dataTransfer.setData('text/plain', `event:${event.id}`);
          dragEvent.dataTransfer.effectAllowed = 'move';
          dragEvent.currentTarget.classList.add('dragging');
        }}
        onDragEnd={(dragEvent) => dragEvent.currentTarget.classList.remove('dragging')}
      >
        <GripIcon size={14} />
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label={t("Edit {0}", { 0: event.title })}
        onClick={() => openComposer({ mode: 'edit', type: 'event', id: editId })}
      >
        <PencilIcon size={16} />
      </button>
      {series ? null : (
      <button
        type="button"
        className="icon-btn row-delete"
        aria-label={t("Remove {0}", { 0: event.title })}
        onClick={() => {
          deleteEvent(event.id);
          flash(t("Event “{0}” removed.", { 0: event.title }), { label: t("Undo"), run: undo });
        }}
      >
        <TrashIcon size={16} />
      </button>
      )}
    </li>
  );
}

export function FixedEventRow({ event }: { event: PlannerEvent }) {
  const accent = categoryById(event.category).accent;
  const duration = formatDuration(event.startTime, event.endTime);
  return (
    <li className={cx('event', 'fixed-event', `accent-${accent}`)} title={t("Protected weekly time — AI plans will leave this slot clear")}>
      <span className="fixed-repeat" aria-hidden="true">↻</span>
      <time className="fixed-time">{displayTime(event.startTime)}</time>
      <div className="item-body">
        <span className="item-title fixed-title" dir="auto">{event.title}</span>
        <p className="meta">
          {categoryById(event.category).label}
          {duration ? ` · ${duration}` : ''}
          <span className="fixed-tag">{t("Protected weekly")}</span>
        </p>
      </div>
    </li>
  );
}

export function TaskRow({
  task,
  showDate = false,
  onDropSwap,
  onReschedule,
  rescheduleLabel = 'Tomorrow',
  selection,
}: {
  task: Task;
  showDate?: boolean;
  onDropSwap?: (sourceId: string) => void;
  onReschedule?: () => void;
  rescheduleLabel?: string;
  /** Bulk-select mode: shows a checkbox instead of nothing. */
  selection?: { selected: boolean; onToggle: () => void };
}) {
  const { toggleTask, toggleSubtask, openComposer, deleteTask, updateTask, flash, undo, startFocus, duplicateTask, moveTask } = usePlanner();
  const accent = categoryById(task.category).accent;
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const stepsDone = task.subtasks.filter((item) => item.completed).length;
  const today = todayISO();
  /**
   * An upcoming occurrence of a repeating task, drawn from the series rather
   * than stored. There is nothing here to tick, reorder, snooze or delete —
   * only the real copy can be changed, so every action on the row opens that
   * task instead of pretending to work on a projection.
   */
  const projected = Boolean(task.seriesTaskId);
  const editId = task.seriesTaskId ?? task.id;
  const overdue = !projected && !task.completed && task.dueDate !== null && task.dueDate < today;
  return (
    <li
      className={cx('task', task.completed && 'is-done', selection?.selected && 'is-selected', projected && 'is-projected')}
      onDragOver={(dragEvent) => {
        if (!onDropSwap || projected) return;
        dragEvent.preventDefault();
      }}
      onDrop={(dragEvent) => {
        if (!onDropSwap || projected) return;
        dragEvent.preventDefault();
        const raw = dragEvent.dataTransfer.getData('text/plain');
        if (raw.startsWith('task:')) onDropSwap(raw.slice(5));
      }}
    >
      {selection ? (
        <input
          type="checkbox"
          className="select-box"
          checked={selection.selected}
          aria-label={t("Select {0}", { 0: task.title })}
          onChange={selection.onToggle}
        />
      ) : null}
      <button
        type="button"
        className={cx('check', task.completed && 'on')}
        aria-pressed={task.completed}
        disabled={projected}
        title={projected ? t("This is an upcoming repeat. Open the task to tick it.") : undefined}
        aria-label={task.completed ? t("Mark {0} not done", { 0: task.title }) : t("Mark {0} complete", { 0: task.title })}
        onClick={() => toggleTask(task.id)}
      >
        {task.completed ? <TickIcon size={14} /> : null}
      </button>
      <div className="item-body">
        {/* A projection has no stored copy to rename — it opens the real task. */}
        {projected ? (
          <button type="button" className="item-title" dir="auto" onClick={() => openComposer({ mode: 'edit', type: 'task', id: editId })}>
            {task.title}
          </button>
        ) : (
          <InlineTitle
            value={task.title}
            onCommit={(title) => {
              updateTask(task.id, { title });
              flash(t("Title updated."), { label: t("Undo"), run: undo });
            }}
          />
        )}
        <p className="meta">
          <span className={cx('prio', `prio-${task.priority}`)}>
            <i aria-hidden="true" />
            {task.priority === 'high' ? t("High") : task.priority === 'low' ? t("Low") : t("Medium")}
          </span>
          <i className={cx('dot-inline', `accent-${accent}`)} aria-hidden="true" />
          {categoryById(task.category).label}
          {task.dueTime ? ` · ${displayTime(task.dueTime)}` : ''}
          {task.estimatedMinutes ? <span className="repeat-chip" title={t("Planned effort")}>≈ {formatEstimate(task.estimatedMinutes)}</span> : null}
          {showDate && task.dueDate ? ` · ${formatWeekdayShort(task.dueDate)} ${dayNumber(task.dueDate)} ${formatMonthShort(task.dueDate)}` : ''}
          {task.waiting ? <span className="repeat-chip">{t("Waiting on {0}", { 0: task.waiting })}</span> : null}
          {task.repeat ? <span className="repeat-chip" title={repeatLabel(task.repeat)}>↻ {repeatLabel(task.repeat).replace('Every ', '')}</span> : null}
          {projected ? <span className="repeat-chip">{t("Repeats")}</span> : null}
          {task.subtasks.length ? (
            <button type="button" className="steps-chip" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              <span className="steps-bar" aria-hidden="true"><i style={{ width: `${(stepsDone / task.subtasks.length) * 100}%` }} /></span>
              {stepsDone}/{task.subtasks.length} {t('steps')}
            </button>
          ) : null}
        </p>
        {task.note ? <p className="item-note">{task.note}</p> : null}
        {open && task.subtasks.length ? (
          <ul className="subtask-list">
            {task.subtasks.map((item) => (
              <li key={item.id} className={cx(item.completed && 'is-done')}>
                <button
                  type="button"
                  className={cx('check', 'mini', item.completed && 'on')}
                  aria-pressed={item.completed}
                  aria-label={item.completed ? t("Mark step {0} not done", { 0: item.title }) : t("Mark step {0} done", { 0: item.title })}
                  onClick={() => toggleSubtask(task.id, item.id)}
                >
                  {item.completed ? <TickIcon size={10} /> : null}
                </button>
                <span>{item.title}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {overdue ? (
          <div className="snooze-row" role="group" aria-label={t("Snooze")}>
            <button type="button" className="text-btn inline" onClick={() => moveTask(task.id, today)}>
              {t("Move to today")}
            </button>
            <button type="button" className="text-btn inline" onClick={() => (onReschedule ? onReschedule() : moveTask(task.id, addDays(today, 1)))}>
              {t("Move to tomorrow")}
            </button>
            <button type="button" className="text-btn inline" onClick={() => moveTask(task.id, nextWeekend(today))}>
              {t("This weekend")}
            </button>
            <button type="button" className="text-btn inline" onClick={() => moveTask(task.id, addDays(today, 7))}>
              {t("Next week")}
            </button>
            <button type="button" className="text-btn inline" onClick={() => moveTask(task.id, nextMonth(today))}>
              {t("Next month")}
            </button>
            {picking ? (
              <input
                type="date"
                className="snooze-date"
                aria-label={t("Pick a date")}
                min={today}
                onChange={(event) => {
                  if (event.target.value) {
                    moveTask(task.id, event.target.value);
                    setPicking(false);
                  }
                }}
                onBlur={() => setPicking(false)}
                autoFocus
              />
            ) : (
              <button type="button" className="text-btn inline" onClick={() => setPicking(true)}>
                {t("Pick date…")}
              </button>
            )}
          </div>
        ) : onReschedule ? (
          <button type="button" className="text-btn inline" onClick={onReschedule}>
            {rescheduleLabel}
          </button>
        ) : null}
      </div>
      {!projected ? (
        <>
          <span
            className="grip"
            draggable
            aria-label={t("Drag {0} to reorder", { 0: task.title })}
            title={t("Drag onto another task to reorder")}
            onDragStart={(dragEvent) => {
              dragEvent.dataTransfer.setData('text/plain', `task:${task.id}`);
              dragEvent.dataTransfer.effectAllowed = 'move';
            }}
          >
            <GripIcon size={14} />
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("Duplicate {0}", { 0: task.title })}
            title={t("Duplicate")}
            onClick={() => {
              duplicateTask(task.id);
              flash(t("Task “{0}” duplicated.", { 0: task.title }), { label: t("Undo"), run: undo });
            }}
          >
            <span aria-hidden="true">⧉</span>
          </button>
          {!task.completed ? (
            <button
              type="button"
              className="icon-btn row-focus"
              aria-label={t("Start a focus session for {0}", { 0: task.title })}
              title={t("Focus on this")}
              onClick={() => startFocus({ taskId: task.id, title: task.title, minutes: 25 })}
            >
              <StopwatchIcon size={16} />
            </button>
          ) : null}
          {/* The title edits in place now, so the full form needs its own door. */}
          <button
            type="button"
            className="icon-btn row-edit"
            aria-label={t("Edit details of {0}", { 0: task.title })}
            title={t("Edit details")}
            onClick={() => openComposer({ mode: 'edit', type: 'task', id: editId })}
          >
            <PencilIcon size={16} />
          </button>
          <button
            type="button"
            className="icon-btn row-delete"
            aria-label={t("Remove {0}", { 0: task.title })}
            onClick={() => {
              deleteTask(task.id);
              flash(t("Task “{0}” removed.", { 0: task.title }), { label: t("Undo"), run: undo });
            }}
          >
            <TrashIcon size={16} />
          </button>
        </>
      ) : null}
    </li>
  );
}

export function HabitRow({ habit, date }: { habit: Habit; date: string }) {
  const { state, toggleHabit, setHabitValue, skipHabit, openComposer } = usePlanner();
  const done = state.completions.some((item) => item.habitId === habit.id && item.date === date);
  const skipped = isSkipped(state, habit.id, date);
  const progress = habitProgress(state, habit, date);
  const streak = habitStreaks(state, habit, date).current;
  return (
    <li className={cx('habit-row', `accent-${habit.accent}`, done && !skipped && 'is-done', skipped && 'is-skipped')}>
      <span className={cx('icon-well', `accent-${habit.accent}`)}>
        <HabitGlyph name={habit.icon} />
      </span>
      <button type="button" className="habit-name" onClick={() => openComposer({ mode: 'edit', type: 'habit', id: habit.id })}>
        <strong>{habit.name}</strong>
        <small>
          {frequencyLabel(habit)}
          {habit.unit ? ` · ${habit.unit.label}` : ''}
          {skipped ? <span className="streak-chip" title={t("Rest day — your streak is safe")}>🌙 {t("rest")}</span> : streak >= 2 ? <span className="streak-chip"><FlameIcon size={12} />{streak}</span> : null}
        </small>
      </button>
      {progress && !skipped ? (
        <span className="unit-progress">
          <button
            type="button"
            className="icon-btn"
            aria-label={t("Add one {0} for {1}", { 0: habit.unit?.label ?? '', 1: habit.name })}
            onClick={() => setHabitValue(habit.id, date, progress.value + 1)}
          >
            <span aria-hidden="true">＋</span>
          </button>
          <span className={cx('unit-count', progress.value >= progress.target && 'met')}>
            {progress.value}/{progress.target}
          </span>
        </span>
      ) : null}
      <button
        type="button"
        className={cx('icon-btn', skipped && 'is-on')}
        aria-label={skipped ? t("Take {0} out of rest", { 0: habit.name }) : t("Rest day for {0} (streak is safe)", { 0: habit.name })}
        aria-pressed={skipped}
        title={t("Rest day — the streak is not broken")}
        onClick={() => skipHabit(habit.id, date)}
      >
        <span aria-hidden="true">🌙</span>
      </button>
      <button
        type="button"
        className={cx('check', 'circle', done && !skipped && 'on')}
        aria-pressed={done && !skipped}
        aria-label={done && !skipped ? t("Mark {0} not done", { 0: habit.name }) : t("Mark {0} complete", { 0: habit.name })}
        onClick={() => toggleHabit(habit.id, date)}
      >
        {done && !skipped ? <TickIcon size={14} /> : null}
      </button>
    </li>
  );
}

export function NowMark({ time }: { time: string }) {
  return (
    <div className="now-mark">
      <span>{t("Now")}</span>
      <time dateTime={time}>{displayTime(time)}</time>
    </div>
  );
}
