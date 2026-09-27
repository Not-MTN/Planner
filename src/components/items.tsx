import { useEffect, useState } from 'react';
import { categoryById } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { dayNumber, formatDuration, formatMonthShort, formatWeekdayShort, isValidTime } from '../dates';
import { frequencyLabel, habitStreaks } from '../logic';
import { FlameIcon, GripIcon, HabitGlyph, PencilIcon, StopwatchIcon, TickIcon, TrashIcon } from '../icons';
import type { Habit, PlannerEvent, Task } from '../types';

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
      <span>Intention</span>
      <input
        value={text}
        maxLength={160}
        placeholder="One line for this day — optional"
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
        aria-label={event.completed ? `Mark ${event.title} not done` : `Mark ${event.title} complete`}
        onClick={() => toggleEvent(event.id)}
      >
        {event.completed ? <TickIcon size={14} /> : null}
      </button>
      <label className="time-field">
        <span className="visually-hidden">Start time for {event.title}</span>
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
        <button type="button" className="item-title" onClick={() => openComposer({ mode: 'edit', type: 'event', id: event.id })}>
          {event.title}
        </button>
        <p className="meta">
          <i className={cx('dot-inline', `accent-${accent}`)} aria-hidden="true" />
          {categoryById(event.category).label}
          {duration ? ` · ${duration}` : ''}
          {event.important ? ' · Important' : ''}
        </p>
      </div>
      <span
        className="grip"
        draggable
        aria-label={`Drag ${event.title} to swap times`}
        title="Drag onto another plan to swap times"
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
        aria-label={`Edit ${event.title}`}
        onClick={() => openComposer({ mode: 'edit', type: 'event', id: event.id })}
      >
        <PencilIcon size={16} />
      </button>
      <button
        type="button"
        className="icon-btn row-delete"
        aria-label={`Remove ${event.title}`}
        onClick={() => {
          deleteEvent(event.id);
          flash(`Event “${event.title}” removed.`, { label: 'Undo', run: undo });
        }}
      >
        <TrashIcon size={16} />
      </button>
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
  const { toggleTask, openComposer, deleteTask, flash, undo, startFocus } = usePlanner();
  const accent = categoryById(task.category).accent;
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
        aria-label={task.completed ? `Mark ${task.title} not done` : `Mark ${task.title} complete`}
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
            {task.priority === 'high' ? 'High' : task.priority === 'low' ? 'Low' : 'Medium'}
          </span>
          <i className={cx('dot-inline', `accent-${accent}`)} aria-hidden="true" />
          {categoryById(task.category).label}
          {task.dueTime ? ` · ${task.dueTime}` : ''}
          {showDate && task.dueDate ? ` · ${formatWeekdayShort(task.dueDate)} ${dayNumber(task.dueDate)} ${formatMonthShort(task.dueDate)}` : ''}
        </p>
        {task.note ? <p className="item-note">{task.note}</p> : null}
        {onReschedule ? (
          <button type="button" className="text-btn inline" onClick={onReschedule}>
            {rescheduleLabel}
          </button>
        ) : null}
      </div>
      <span
        className="grip"
        draggable
        aria-label={`Drag ${task.title} to reorder`}
        title="Drag onto another task to reorder"
        onDragStart={(dragEvent) => {
          dragEvent.dataTransfer.setData('text/plain', `task:${task.id}`);
          dragEvent.dataTransfer.effectAllowed = 'move';
        }}
      >
        <GripIcon size={14} />
      </span>
      {!task.completed ? (
        <button
          type="button"
          className="icon-btn row-focus"
          aria-label={`Start a focus session for ${task.title}`}
          title="Focus on this"
          onClick={() => startFocus({ taskId: task.id, title: task.title, minutes: 25 })}
        >
          <StopwatchIcon size={16} />
        </button>
      ) : null}
      <button
        type="button"
        className="icon-btn row-delete"
        aria-label={`Remove ${task.title}`}
        onClick={() => {
          deleteTask(task.id);
          flash(`Task “${task.title}” removed.`, { label: 'Undo', run: undo });
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
        aria-label={done ? `Mark ${habit.name} not done` : `Mark ${habit.name} complete`}
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
      <span>Now</span>
      <time dateTime={time}>{time}</time>
    </div>
  );
}
