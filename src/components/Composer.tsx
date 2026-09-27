import { useMemo, useState, type FormEvent } from 'react';
import { ACCENTS, CATEGORIES, HABIT_ICONS, NOTE_KINDS, PRIORITIES, type Accent, type NoteKind, type Priority } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { isValidTime, suggestTime, timeToMinutes, todayISO, WEEKDAY_TOGGLES } from '../dates';
import { HabitGlyph } from '../icons';
import { REPEAT_CHOICES } from '../recurrence';
import { uid } from '../mutate';
import type { Subtask, TaskRepeat, ComposerState, EventInput, GoalHorizon, HabitFrequency, HabitInput, NoteInput, PlannerState, TaskInput } from '../types';
import { Field, Modal } from './ui';
import { Markdown } from './Markdown';
import { t } from '../i18n';

const TITLES: Record<ComposerState['type'], [string, string]> = {
  task: [t("New task"), t("Edit task")],
  event: [t("New event"), t("Edit event")],
  habit: [t("New habit"), t("Edit habit")],
  goal: [t("New goal"), t("Edit goal")],
  note: [t("New note"), t("Edit note")],
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
  const activeType = editing ? composer.type : type;
  const heading = TITLES[activeType][editing ? 1 : 0];

  const remove = () => {
    if (composer.mode !== 'edit') return;
    const item = findItem(planner.state, composer);
    if (composer.type === 'task') planner.deleteTask(composer.id);
    if (composer.type === 'event') planner.deleteEvent(composer.id);
    if (composer.type === 'habit') planner.deleteHabit(composer.id);
    if (composer.type === 'goal') planner.deleteGoal(composer.id);
    if (composer.type === 'note') planner.deleteNote(composer.id);
    planner.flash(t("{0} “{1}” removed.", { 0: labelFor(composer.type), 1: item ?? t("Removed") }), { label: t("Undo"), run: planner.undo });
    onClose();
  };

  return (
    <Modal title={heading} onClose={onClose}>
      {!editing ? (
        <div className="segmented type-switch" role="tablist" aria-label={t("What to add")}>
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
        <TaskForm composer={composer} goals={goals} onClose={onClose} onRemove={remove} />
      </div>
      <div hidden={activeType !== 'event'}>
        <EventForm composer={composer} onClose={onClose} onRemove={remove} />
      </div>
      <div hidden={activeType !== 'habit'}>
        <HabitForm composer={composer} onClose={onClose} onRemove={remove} />
      </div>
      <div hidden={activeType !== 'goal'}>
        <GoalForm composer={composer} onClose={onClose} onRemove={remove} />
      </div>
      <div hidden={activeType !== 'note'}>
        <NoteForm composer={composer} onClose={onClose} onRemove={remove} />
      </div>
    </Modal>
  );
}

function findItem(state: PlannerState, composer: { type: ComposerState['type']; id: string }): string | null {
  if (composer.type === 'task') return state.tasks.find((item) => item.id === composer.id)?.title ?? null;
  if (composer.type === 'event') return state.events.find((item) => item.id === composer.id)?.title ?? null;
  if (composer.type === 'habit') return state.habits.find((item) => item.id === composer.id)?.name ?? null;
  if (composer.type === 'goal') return state.goals.find((item) => item.id === composer.id)?.title ?? null;
  return state.notes.find((item) => item.id === composer.id)?.title ?? null;
}

function labelFor(type: ComposerState['type']): string {
  if (type === 'task') return t("Task");
  if (type === 'event') return t("Event");
  if (type === 'habit') return t("Habit");
  if (type === 'goal') return t("Goal");
  return t("Note");
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
  const [repeat, setRepeat] = useState<TaskRepeat | ''>(existing?.repeat ?? '');
  const [waiting, setWaiting] = useState(existing?.waiting ?? '');
  const [subtasks, setSubtasks] = useState<Subtask[]>(existing?.subtasks ?? []);
  const [draftStep, setDraftStep] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addStep = () => {
    const text = draftStep.trim();
    if (!text) return;
    setSubtasks((items) => [...items, { id: uid(), title: text.slice(0, 140), completed: false }]);
    setDraftStep('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError(t("Add a title."));
      return;
    }
    if (dueTime && !isValidTime(dueTime)) {
      setError(t("Use a valid time."));
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
      repeat: repeat || null,
      waiting: waiting.trim() || null,
      subtasks: draftStep.trim() ? [...subtasks, { id: uid(), title: draftStep.trim(), completed: false }] : subtasks,
    };
    if (existing) updateTask(existing.id, input);
    else addTask(input);
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label={t("Title")} error={error}>
        <input data-autofocus dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
      </Field>
      <div className="field">
        <span>{t("Priority")}</span>
        <div className="segmented" role="radiogroup" aria-label={t("Priority")}>
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
        <Field label={t("Due date")}>
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
        <Field label={t("Due time")}>
          <input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} />
        </Field>
      </div>
      <Field label={t("Waiting on")} hint={t("Keeps it off the overdue list until this is clear.")}>
        <input value={waiting} onChange={(event) => setWaiting(event.target.value)} maxLength={140} placeholder={t("A person, a reply, a delivery…")} />
      </Field>
      <Field label={t("Repeat")} hint={repeat ? t("Finishing it schedules the next one.") : undefined}>
        <select value={repeat} onChange={(event) => setRepeat(event.target.value as TaskRepeat | '')}>
          <option value="">{t("Does not repeat")}</option>
          {REPEAT_CHOICES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </Field>
      <div className="field">
        <span>{t("Checklist")}</span>
        {subtasks.length ? (
          <ul className="subtask-edit">
            {subtasks.map((item) => (
              <li key={item.id}>
                <input
                  type="checkbox"
                  checked={item.completed}
                  aria-label={t("Mark {0} done", { 0: item.title })}
                  onChange={() => setSubtasks((items) => items.map((step) => (step.id === item.id ? { ...step, completed: !step.completed } : step)))}
                />
                <input
                  value={item.title}
                  maxLength={140}
                  aria-label={t("Step title")}
                  onChange={(event) => setSubtasks((items) => items.map((step) => (step.id === item.id ? { ...step, title: event.target.value } : step)))}
                />
                <button type="button" className="text-btn" aria-label={t("Remove step {0}", { 0: item.title })} onClick={() => setSubtasks((items) => items.filter((step) => step.id !== item.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="subtask-add">
          <input
            value={draftStep}
            maxLength={140}
            placeholder={t("Add a step and press Enter")}
            aria-label={t("New checklist step")}
            onChange={(event) => setDraftStep(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addStep();
              }
            }}
          />
          <button type="button" className="btn btn-soft" onClick={addStep}>{t("Add")}</button>
        </div>
      </div>
      <div className="form-row two">
        <Field label={t("Category")}>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Goal")} hint={t("Optional. Completing it moves the goal.")}>
          <select value={goalId} onChange={(event) => setGoalId(event.target.value)}>
            <option value="">{t("No goal")}</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>{goal.title}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t("Note")}>
        <textarea dir="auto" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={4000} />
      </Field>
      <Actions editing={Boolean(existing)} label={t("Add task")} onClose={onClose} onRemove={onRemove} />
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
  const [repeat, setRepeat] = useState<TaskRepeat | ''>(existing?.repeat ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError(t("Add a title."));
      return;
    }
    if (!date) {
      setError(t("Choose a date."));
      return;
    }
    if (!isValidTime(startTime)) {
      setError(t("Add a start time."));
      return;
    }
    if (endTime && (!isValidTime(endTime) || timeToMinutes(endTime) <= timeToMinutes(startTime))) {
      setError(t("End time should be after the start."));
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
      repeat: repeat || null,
    };
    if (existing) updateEvent(existing.id, input);
    else addEvent(input);
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label={t("Title")} error={error}>
        <input data-autofocus dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
      </Field>
      <div className="form-row two">
        <Field label={t("Date")}>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </Field>
        <Field label={t("Starts")}>
          <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
        </Field>
      </div>
      <div className="form-row two">
        <Field label={t("Ends")} hint={t("Optional")}>
          <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        </Field>
        <Field label={t("Category")}>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t("Repeat")} hint={repeat ? t("Shows on matching days ahead.") : undefined}>
        <select value={repeat} onChange={(event) => setRepeat(event.target.value as TaskRepeat | '')}>
          <option value="">{t("Does not repeat")}</option>
          {REPEAT_CHOICES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </Field>
      <label className="check-line">
        <input type="checkbox" checked={important} onChange={(event) => setImportant(event.target.checked)} />
        <span>{t("Mark as important")}</span>
      </label>
      <Field label={t("Note")}>
        <textarea dir="auto" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={4000} />
      </Field>
      <Actions editing={Boolean(existing)} label={t("Add event")} onClose={onClose} onRemove={onRemove} />
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
  const [essential, setEssential] = useState(existing?.essential ?? false);
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
      setError(t("Name the habit."));
      return;
    }
    if (frequency.type === 'custom' && frequency.days.length === 0) {
      setError(t("Choose at least one day."));
      return;
    }
    const input: HabitInput = { name, icon, accent, frequency, essential };
    if (existing) updateHabit(existing.id, input);
    else addHabit(input);
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label={t("Name")} error={error}>
        <input data-autofocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
      </Field>
      <div className="field">
        <span>{t("Icon")}</span>
        <div className="icon-picker" role="listbox" aria-label={t("Habit icon")}>
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
        <span>{t("Colour")}</span>
        <div className="swatches" role="radiogroup" aria-label={t("Habit colour")}>
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
      <Field label={t("Frequency")}>
        <select value={freqType} onChange={(event) => setFreqType(event.target.value as HabitFrequency['type'])}>
          <option value="daily">{t("Every day")}</option>
          <option value="weekdays">{t("Weekdays")}</option>
          <option value="custom">{t("Specific days")}</option>
          <option value="weekly">{t("Times per week")}</option>
        </select>
      </Field>
      {freqType === 'custom' ? (
        <div className="day-pills" role="group" aria-label={t("Days")}>
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
        <Field label={t("Times each week")} hint={t("Shown until the week’s target is met. No streak pressure.")}>
          <input
            type="number"
            min={1}
            max={7}
            value={times}
            onChange={(event) => setTimes(Math.min(7, Math.max(1, Number(event.target.value) || 1)))}
          />
        </Field>
      ) : null}
      <label className="check-line">
        <input type="checkbox" checked={essential} onChange={(event) => setEssential(event.target.checked)} />
        <span>{t("A must-do for every day — pinned to Today")}</span>
      </label>
      <Actions editing={Boolean(existing)} label={t("Add habit")} onClose={onClose} onRemove={onRemove} />
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
  const [milestoneDue, setMilestoneDue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError(t("Name the goal."));
      return;
    }
    if (existing) {
      updateGoal(existing.id, { title, description, horizon, deadline: deadline || null });
    } else {
      addGoal({ title, description, horizon, deadline: deadline || null, milestone, milestoneDue: milestoneDue || null });
    }
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label={t("Title")} error={error}>
        <input data-autofocus dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
      </Field>
      <div className="field">
        <span>{t("Horizon")}</span>
        <div className="segmented" role="radiogroup" aria-label={t("Horizon")}>
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
        <small className="hint">{t("Short-term is this season. Long-term is the larger direction.")}</small>
      </div>
      <Field label={t("Description")}>
        <textarea dir="auto" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} />
      </Field>
      <Field label={t("Deadline")} hint={t("Optional")}>
        <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
      </Field>
      {!existing ? (
        <>
          <Field label={t("First step")} hint={t("Optional. You can add more on the goal.")}>
            <input value={milestone} onChange={(event) => setMilestone(event.target.value)} maxLength={140} />
          </Field>
          {milestone.trim() ? (
            <Field label={t("Step date")} hint={t("Optional. Shows on Upcoming.")}>
              <input type="date" value={milestoneDue} onChange={(event) => setMilestoneDue(event.target.value)} />
            </Field>
          ) : null}
        </>
      ) : null}
      <Actions editing={Boolean(existing)} label={t("Add goal")} onClose={onClose} onRemove={onRemove} />
    </form>
  );
}

function NoteForm({ composer, onClose, onRemove }: { composer: ComposerState; onClose: () => void; onRemove: () => void }) {
  const { state, addNote, updateNote } = usePlanner();
  const existing = composer.mode === 'edit' ? state.notes.find((note) => note.id === composer.id) : undefined;
  const [title, setTitle] = useState((existing?.title === 'Untitled note' || existing?.title === t('Untitled note')) ? '' : existing?.title ?? '');
  const [kind, setKind] = useState<NoteKind>(existing?.kind ?? 'quick');
  const [date, setDate] = useState(existing?.date ?? (composer.mode === 'create' ? composer.date ?? '' : ''));
  const [body, setBody] = useState(existing?.body ?? '');
  const [pinned, setPinned] = useState(existing?.pinned === true);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() && !body.trim()) {
      setError(t("Write a title or a few words."));
      return;
    }
    const input: NoteInput = { title, body, kind, date: date || null, pinned };
    if (existing) updateNote(existing.id, input);
    else addNote(input);
    onClose();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label={t("Title")} error={error}>
        <input data-autofocus dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
      </Field>
      <div className="field">
        <span>{t("Kind")}</span>
        <div className="segmented" role="radiogroup" aria-label={t("Note kind")}>
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
      <Field label={t("Date")} hint={t("Optional. Ties the note to a day.")}>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </Field>
      <div className="note-editor-bar">
        <label className="set-inline"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /> {t("Pin to top")}</label>
        <div className="segmented" role="radiogroup" aria-label={t("Editor mode")}>
          <button type="button" role="radio" aria-checked={!preview} className={cx('seg', !preview && 'on')} onClick={() => setPreview(false)}>{t("Write")}</button>
          <button type="button" role="radio" aria-checked={preview} className={cx('seg', preview && 'on')} onClick={() => setPreview(true)}>{t("Preview")}</button>
        </div>
      </div>
      {preview ? (
        <div className="md-body md-preview">{body.trim() ? <Markdown text={body} /> : <p className="meta">{t("Nothing to preview yet.")}</p>}</div>
      ) : null}
      <Field label={kind === 'journal' ? t("Entry") : t("Note")} hint={t("Markdown works: **bold**, *italic*, - lists, - [ ] checkboxes, # headings, #tags, links.")}>
        <textarea
          hidden={preview}
          dir="auto"
          className={kind === 'journal' ? 'journal-entry' : undefined}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={kind === 'journal' ? 8 : 5}
          maxLength={20000}
          placeholder={kind === 'journal' ? t("What do you want to remember about this day?") : t("A few words is enough.")}
        />
      </Field>
      <Actions editing={Boolean(existing)} label={t("Add note")} onClose={onClose} onRemove={onRemove} />
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
          {t("Remove")}
        </button>
      ) : (
        <span />
      )}
      <div className="form-actions-right">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t("Cancel")}
        </button>
        <button type="submit" className="btn btn-primary">
          {editing ? t("Save") : label}
        </button>
      </div>
    </div>
  );
}
