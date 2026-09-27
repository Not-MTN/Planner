import { useMemo, useState, type FormEvent } from 'react';
import { ACCENTS, CATEGORIES, HABIT_ICONS, NOTE_KINDS, PRIORITIES, type Accent, type NoteKind, type Priority } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { isValidTime, suggestTime, timeToMinutes, todayISO, WEEKDAY_TOGGLES } from '../dates';
import { HabitGlyph } from '../icons';
import type { ComposerState, EventInput, GoalHorizon, HabitFrequency, HabitInput, NoteInput, TaskInput } from '../types';
import { Field, Modal } from './ui';

const TITLES: Record<ComposerState['type'], [string, string]> = {
  task: ['New task', 'Edit task'],
  event: ['New event', 'Edit event'],
  habit: ['New habit', 'Edit habit'],
  goal: ['New goal', 'Edit goal'],
  note: ['New note', 'Edit note'],
};

export function Composer() {
  const { composer, closeComposer, state } = usePlanner();
  if (!composer) return null;
  return <ComposerForm key={`${composer.mode}-${composer.type}-${composer.mode === 'edit' ? composer.id : composer.date ?? ''}`} composer={composer} onClose={closeComposer} goals={state.goals} />;
}

function ComposerForm({
  composer,
  onClose,
  goals,
}: {
  composer: ComposerState;
  onClose: () => void;
  goals: { id: string; title: string }[];
}) {
  const planner = usePlanner();
  const editing = composer.mode === 'edit';
  const [type, setType] = useState(composer.type);
  const [confirming, setConfirming] = useState(false);
  const activeType = editing ? composer.type : type;
  const heading = TITLES[activeType][editing ? 1 : 0];

  const remove = () => {
    if (composer.mode !== 'edit') return;
    if (composer.type === 'task') planner.deleteTask(composer.id);
    if (composer.type === 'event') planner.deleteEvent(composer.id);
    if (composer.type === 'habit') planner.deleteHabit(composer.id);
    if (composer.type === 'goal') planner.deleteGoal(composer.id);
    if (composer.type === 'note') planner.deleteNote(composer.id);
    onClose();
  };

  return (
    <Modal title={confirming ? 'Remove this?' : heading} onClose={onClose}>
      {confirming ? (
        <div className="confirm-copy">
          <p>{removeCopy(composer.type)}</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" data-autofocus onClick={() => setConfirming(false)}>
              Back
            </button>
            <button type="button" className="btn btn-danger" onClick={remove}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <>
          {!editing ? (
            <div className="segmented type-switch" role="tablist" aria-label="What to add">
              {(['task', 'event', 'habit', 'goal', 'note'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={type === item}
                  className={cx('seg', type === item && 'on')}
                  onClick={() => setType(item)}
                >
                  {labelFor(item)}
                </button>
              ))}
            </div>
          ) : null}
          <div hidden={activeType !== 'task'}>
            <TaskForm composer={composer} goals={goals} onClose={onClose} onRemove={() => setConfirming(true)} />
          </div>
          <div hidden={activeType !== 'event'}>
            <EventForm composer={composer} onClose={onClose} onRemove={() => setConfirming(true)} />
          </div>
          <div hidden={activeType !== 'habit'}>
            <HabitForm composer={composer} onClose={onClose} onRemove={() => setConfirming(true)} />
          </div>
          <div hidden={activeType !== 'goal'}>
            <GoalForm composer={composer} onClose={onClose} onRemove={() => setConfirming(true)} />
          </div>
          <div hidden={activeType !== 'note'}>
            <NoteForm composer={composer} onClose={onClose} onRemove={() => setConfirming(true)} />
          </div>
        </>
      )}
    </Modal>
  );
}

function labelFor(type: ComposerState['type']): string {
  if (type === 'task') return 'Task';
  if (type === 'event') return 'Event';
  if (type === 'habit') return 'Habit';
  if (type === 'goal') return 'Goal';
  return 'Note';
}

function removeCopy(type: ComposerState['type']): string {
  if (type === 'habit') return 'Its history will be deleted too.';
  if (type === 'goal') return 'Steps go with it. Linked tasks stay in your task list.';
  if (type === 'note') return 'This note will be deleted.';
  if (type === 'event') return 'It will be taken off your schedule.';
  return 'It will disappear from your lists.';
}

function TaskForm({
  composer,
  goals,
  onClose,
  onRemove,
}: {
  composer: ComposerState;
  goals: { id: string; title: string }[];
  onClose: () => void;
  onRemove: () => void;
}) {
  const { state, addTask, updateTask } = usePlanner();
  const existing = composer.mode === 'edit' ? state.tasks.find((task) => task.id === composer.id) : undefined;
  const initialDate = composer.mode === 'create' ? composer.date ?? todayISO() : existing?.dueDate ?? '';
  const [title, setTitle] = useState(existing?.title ?? '');
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? 'medium');
  const [dueDate, setDueDate] = useState(initialDate);
  const [dueTime, setDueTime] = useState(existing?.dueTime ?? '');
  const [category, setCategory] = useState(existing?.category ?? 'personal');
  const [goalId, setGoalId] = useState(existing?.goalId ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Add a title.');
      return;
    }
    if (dueTime && !isValidTime(dueTime)) {
      setError('Use a valid time.');
      return;
    }
    const input: TaskInput = {
      title,
      priority,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      category,
      note,
      goalId: goalId || null,
    };
    if (existing) updateTask(existing.id, input);
    else addTask(input);
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Title" error={error}>
        <input data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
      </Field>
      <div className="field">
        <span>Priority</span>
        <div className="segmented" role="radiogroup" aria-label="Priority">
          {PRIORITIES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={priority === item.id}
              className={cx('seg', priority === item.id && 'on')}
              onClick={() => setPriority(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-row two">
        <Field label="Due date">
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
        <Field label="Due time">
          <input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} />
        </Field>
      </div>
      <div className="form-row two">
        <Field label="Category">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Goal" hint="Optional. Completing it moves the goal.">
          <select value={goalId} onChange={(event) => setGoalId(event.target.value)}>
            <option value="">No goal</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>{goal.title}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Note">
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={4000} />
      </Field>
      <Actions editing={Boolean(existing)} label="Add task" onClose={onClose} onRemove={onRemove} />
    </form>
  );
}

function EventForm({ composer, onClose, onRemove }: { composer: ComposerState; onClose: () => void; onRemove: () => void }) {
  const { state, addEvent, updateEvent } = usePlanner();
  const existing = composer.mode === 'edit' ? state.events.find((event) => event.id === composer.id) : undefined;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(existing?.date ?? (composer.mode === 'create' ? composer.date ?? todayISO() : todayISO()));
  const [startTime, setStartTime] = useState(existing?.startTime ?? suggestTime());
  const [endTime, setEndTime] = useState(existing?.endTime ?? '');
  const [category, setCategory] = useState(existing?.category ?? 'personal');
  const [important, setImportant] = useState(existing?.important ?? false);
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Add a title.');
      return;
    }
    if (!date) {
      setError('Choose a date.');
      return;
    }
    if (!isValidTime(startTime)) {
      setError('Add a start time.');
      return;
    }
    if (endTime && (!isValidTime(endTime) || timeToMinutes(endTime) <= timeToMinutes(startTime))) {
      setError('End time should be after the start.');
      return;
    }
    const input: EventInput = {
      title,
      date,
      startTime,
      endTime: endTime || null,
      category,
      note,
      important,
    };
    if (existing) updateEvent(existing.id, input);
    else addEvent(input);
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Title" error={error}>
        <input data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
      </Field>
      <div className="form-row two">
        <Field label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </Field>
        <Field label="Starts">
          <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
        </Field>
      </div>
      <div className="form-row two">
        <Field label="Ends" hint="Optional">
          <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        </Field>
        <Field label="Category">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <label className="check-line">
        <input type="checkbox" checked={important} onChange={(event) => setImportant(event.target.checked)} />
        <span>Mark as important</span>
      </label>
      <Field label="Note">
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={4000} />
      </Field>
      <Actions editing={Boolean(existing)} label="Add event" onClose={onClose} onRemove={onRemove} />
    </form>
  );
}

function HabitForm({ composer, onClose, onRemove }: { composer: ComposerState; onClose: () => void; onRemove: () => void }) {
  const { state, addHabit, updateHabit } = usePlanner();
  const existing = composer.mode === 'edit' ? state.habits.find((habit) => habit.id === composer.id) : undefined;
  const initial = existing?.frequency ?? { type: 'daily' as const };
  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? 'leaf');
  const [accent, setAccent] = useState<Accent>(existing?.accent ?? 'sage');
  const [freqType, setFreqType] = useState(initial.type);
  const [days, setDays] = useState<number[]>(initial.type === 'custom' ? initial.days : [1, 3, 5]);
  const [times, setTimes] = useState(initial.type === 'weekly' ? initial.times : 3);
  const [error, setError] = useState<string | null>(null);

  const frequency: HabitFrequency = useMemo(() => {
    if (freqType === 'weekdays') return { type: 'weekdays' };
    if (freqType === 'custom') return { type: 'custom', days };
    if (freqType === 'weekly') return { type: 'weekly', times };
    return { type: 'daily' };
  }, [freqType, days, times]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Name the habit.');
      return;
    }
    if (frequency.type === 'custom' && frequency.days.length === 0) {
      setError('Choose at least one day.');
      return;
    }
    const input: HabitInput = { name, icon, accent, frequency };
    if (existing) updateHabit(existing.id, input);
    else addHabit(input);
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Name" error={error}>
        <input data-autofocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
      </Field>
      <div className="field">
        <span>Icon</span>
        <div className="icon-picker" role="listbox" aria-label="Habit icon">
          {HABIT_ICONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx('icon-choice', icon === item.id && 'on')}
              aria-label={item.label}
              aria-selected={icon === item.id}
              onClick={() => setIcon(item.id)}
            >
              <HabitGlyph name={item.id} />
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Colour</span>
        <div className="swatches" role="radiogroup" aria-label="Habit colour">
          {ACCENTS.map((item) => (
            <button
              key={item}
              type="button"
              className={cx('swatch', `accent-${item}`, accent === item && 'on')}
              aria-label={item}
              aria-checked={accent === item}
              role="radio"
              onClick={() => setAccent(item)}
            />
          ))}
        </div>
      </div>
      <Field label="Frequency">
        <select value={freqType} onChange={(event) => setFreqType(event.target.value as HabitFrequency['type'])}>
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays</option>
          <option value="custom">Specific days</option>
          <option value="weekly">Times per week</option>
        </select>
      </Field>
      {freqType === 'custom' ? (
        <div className="day-pills" role="group" aria-label="Days">
          {WEEKDAY_TOGGLES.map((item) => {
            const on = days.includes(item.day);
            return (
              <button
                key={item.day}
                type="button"
                className={cx('day-pill-btn', on && 'on')}
                aria-pressed={on}
                onClick={() => setDays((current) => on ? current.filter((day) => day !== item.day) : [...current, item.day])}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {freqType === 'weekly' ? (
        <Field label="Times each week" hint="Shown until the week’s target is met. No streak pressure.">
          <input
            type="number"
            min={1}
            max={7}
            value={times}
            onChange={(event) => setTimes(Math.min(7, Math.max(1, Number(event.target.value) || 1)))}
          />
        </Field>
      ) : null}
      <Actions editing={Boolean(existing)} label="Add habit" onClose={onClose} onRemove={onRemove} />
    </form>
  );
}

function GoalForm({ composer, onClose, onRemove }: { composer: ComposerState; onClose: () => void; onRemove: () => void }) {
  const { state, addGoal, updateGoal } = usePlanner();
  const existing = composer.mode === 'edit' ? state.goals.find((goal) => goal.id === composer.id) : undefined;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [horizon, setHorizon] = useState<GoalHorizon>(existing?.horizon ?? (composer.mode === 'create' ? composer.horizon ?? 'short' : 'short'));
  const [description, setDescription] = useState(existing?.description ?? '');
  const [deadline, setDeadline] = useState(existing?.deadline ?? '');
  const [milestone, setMilestone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Name the goal.');
      return;
    }
    if (existing) {
      updateGoal(existing.id, { title, description, horizon, deadline: deadline || null });
    } else {
      addGoal({ title, description, horizon, deadline: deadline || null, milestone });
    }
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Title" error={error}>
        <input data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
      </Field>
      <div className="field">
        <span>Horizon</span>
        <div className="segmented" role="radiogroup" aria-label="Horizon">
          {([['short', 'Short-term'], ['long', 'Long-term']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={horizon === id}
              className={cx('seg', horizon === id && 'on')}
              onClick={() => setHorizon(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <small className="hint">Short-term is this season. Long-term is the larger direction.</small>
      </div>
      <Field label="Description">
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} />
      </Field>
      <Field label="Deadline" hint="Optional">
        <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
      </Field>
      {!existing ? (
        <Field label="First step" hint="Optional. You can add more on the goal.">
          <input value={milestone} onChange={(event) => setMilestone(event.target.value)} maxLength={140} />
        </Field>
      ) : null}
      <Actions editing={Boolean(existing)} label="Add goal" onClose={onClose} onRemove={onRemove} />
    </form>
  );
}

function NoteForm({ composer, onClose, onRemove }: { composer: ComposerState; onClose: () => void; onRemove: () => void }) {
  const { state, addNote, updateNote } = usePlanner();
  const existing = composer.mode === 'edit' ? state.notes.find((note) => note.id === composer.id) : undefined;
  const [title, setTitle] = useState(existing?.title === 'Untitled note' ? '' : existing?.title ?? '');
  const [kind, setKind] = useState<NoteKind>(existing?.kind ?? 'quick');
  const [date, setDate] = useState(existing?.date ?? (composer.mode === 'create' ? composer.date ?? '' : ''));
  const [body, setBody] = useState(existing?.body ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() && !body.trim()) {
      setError('Write a title or a few words.');
      return;
    }
    const input: NoteInput = { title, body, kind, date: date || null };
    if (existing) updateNote(existing.id, input);
    else addNote(input);
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Title" error={error}>
        <input data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
      </Field>
      <div className="field">
        <span>Kind</span>
        <div className="segmented" role="radiogroup" aria-label="Note kind">
          {NOTE_KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={kind === item.id}
              className={cx('seg', kind === item.id && 'on')}
              onClick={() => setKind(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <Field label="Date" hint="Optional. Ties the note to a day.">
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </Field>
      <Field label={kind === 'journal' ? 'Entry' : 'Note'}>
        <textarea
          className={kind === 'journal' ? 'journal-entry' : undefined}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={kind === 'journal' ? 8 : 5}
          maxLength={20000}
          placeholder={kind === 'journal' ? 'What do you want to remember about this day?' : 'A few words is enough.'}
        />
      </Field>
      <Actions editing={Boolean(existing)} label="Add note" onClose={onClose} onRemove={onRemove} />
    </form>
  );
}

function Actions({
  editing,
  label,
  onClose,
  onRemove,
}: {
  editing: boolean;
  label: string;
  onClose: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="form-actions">
      {editing ? (
        <button type="button" className="btn btn-danger" onClick={onRemove}>
          Remove
        </button>
      ) : (
        <span />
      )}
      <div className="form-actions-right">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          {editing ? 'Save' : label}
        </button>
      </div>
    </div>
  );
}
