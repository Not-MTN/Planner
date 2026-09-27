import { useEffect, useState } from 'react';
import { categoryById } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { addDays, dayNumber, formatDuration, formatMonthShort, formatWeekdayShort, isValidTime, displayTime, todayISO } from '../dates';
import { frequencyLabel, habitStreaks } from '../logic';
import { FlameIcon, GripIcon, HabitGlyph, PencilIcon, StopwatchIcon, TickIcon, TrashIcon } from '../icons';
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
        <button type="button" className="item-title" onClick={() => openComposer({ mode: 'edit', type: 'event', id: editId })}>
          {event.title}
        </button>
        <p className="meta">
          <i className={cx('dot-inline', `accent-${accent}`)} aria-hidden="true" />
          {categoryById(event.category).label}
          {duration ? ` · ${duration}` : ''}
          {event.important ? t(" · Important") : ''}
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
        <span className="item-title fixed-title">{event.title}</span>
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
}: {
  task: Task;
  showDate?: boolean;
  onDropSwap?: (sourceId: string) => void;
  onReschedule?: () => void;
  rescheduleLabel?: string;
}) {
  const { toggleTask, toggleSubtask, openComposer, deleteTask, flash, undo, startFocus, duplicateTask, moveTask } = usePlanner();
  const accent = categoryById(task.category).accent;
  const [open, setOpen] = useState(false);
  const stepsDone = task.subtasks.filter((item) => item.completed).length;
  const today = todayISO();
  const overdue = !task.completed && task.dueDate !== null && task.dueDate < today;
  return (
    <li
      className={cx('task', task.completed && 'is-done')}
      onDragOver={(dragEvent) => {
        if (!onDropSwap) return;
        dragEvent.preventDefault();
      }}
      onDrop={(dragEvent) => {
        if (!onDropSwap) return;
        dragEvent.preventDefault();
        const raw = dragEvent.dataTransfer.getData('text/plain');
        if (raw.startsWith('task:')) onDropSwap(raw.slice(5));
      }}
    >
      <button
        type="button"
        className={cx('check', task.completed && 'on')}
        aria-pressed={task.completed}
        aria-label={task.completed ? t("Mark {0} not done", { 0: task.title }) : t("Mark {0} complete", { 0: task.title })}
        onClick={() => toggleTask(task.id)}
      >
        {task.completed ? <TickIcon size={14} /> : null}
      </button>
      <div className="item-body">
        <button type="button" className="item-title" onClick={() => openComposer({ mode: 'edit', type: 'task', id: task.id })}>
          {task.title}
        </button>
        <p className="meta">
          <span className={cx('prio', `prio-${task.priority}`)}>
            <i aria-hidden="true" />
            {task.priority === 'high' ? t("High") : task.priority === 'low' ? t("Low") : t("Medium")}
          </span>
          <i className={cx('dot-inline', `accent-${accent}`)} aria-hidden="true" />
          {categoryById(task.category).label}
          {task.dueTime ? ` · ${displayTime(task.dueTime)}` : ''}
          {showDate && task.dueDate ? ` · ${formatWeekdayShort(task.dueDate)} ${dayNumber(task.dueDate)} ${formatMonthShort(task.dueDate)}` : ''}
          {task.waiting ? <span className="repeat-chip">{t("Waiting on {0}", { 0: task.waiting })}</span> : null}
          {task.repeat ? <span className="repeat-chip" title={repeatLabel(task.repeat)}>↻ {repeatLabel(task.repeat).replace('Every ', '')}</span> : null}
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
            <button type="button" className="text-btn inline" onClick={() => moveTask(task.id, addDays(today, 7))}>
              {t("Next week")}
            </button>
          </div>
        ) : onReschedule ? (
          <button type="button" className="text-btn inline" onClick={onReschedule}>
            {rescheduleLabel}
          </button>
        ) : null}
      </div>
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
    </li>
  );
}

export function HabitRow({ habit, date }: { habit: Habit; date: string }) {
  const { state, toggleHabit, openComposer } = usePlanner();
  const done = state.completions.some((item) => item.habitId === habit.id && item.date === date);
  const streak = habitStreaks(state, habit, date).current;
  return (
    <li className={cx('habit-row', `accent-${habit.accent}`, done && 'is-done')}>
      <span className={cx('icon-well', `accent-${habit.accent}`)}>
        <HabitGlyph name={habit.icon} />
      </span>
      <button type="button" className="habit-name" onClick={() => openComposer({ mode: 'edit', type: 'habit', id: habit.id })}>
        <strong>{habit.name}</strong>
        <small>
          {frequencyLabel(habit)}
          {streak >= 2 ? <span className="streak-chip"><FlameIcon size={12} />{streak}</span> : null}
        </small>
      </button>
      <button
        type="button"
        className={cx('check', 'circle', done && 'on')}
        aria-pressed={done}
        aria-label={done ? t("Mark {0} not done", { 0: habit.name }) : t("Mark {0} complete", { 0: habit.name })}
        onClick={() => toggleHabit(habit.id, date)}
      >
        {done ? <TickIcon size={14} /> : null}
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
