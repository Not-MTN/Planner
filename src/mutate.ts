import { isValidISODate, isValidTime, timeToMinutes, todayISO } from './dates';
import type {
  EventInput,
  FixedCommitmentInput,
  GoalInput,
  HabitInput,
  NoteInput,
  PlannerState,
  TaskInput,
} from './types';

export function uid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

function nextOrder(items: { sortOrder: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;
}

function clean(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function shiftedEnd(previousStart: string, previousEnd: string | null, nextStart: string): string | null {
  if (!previousEnd || !isValidTime(previousStart) || !isValidTime(previousEnd) || !isValidTime(nextStart)) return null;
  const duration = timeToMinutes(previousEnd) - timeToMinutes(previousStart);
  if (duration <= 0) return null;
  const next = timeToMinutes(nextStart) + duration;
  if (next >= 24 * 60) return null;
  const hours = Math.floor(next / 60);
  const minutes = next % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function addTask(state: PlannerState, input: TaskInput, id = uid(), now = nowIso()): PlannerState {
  const title = clean(input.title, 140);
  if (!title) return state;
  const dueDate = input.dueDate && isValidISODate(input.dueDate) ? input.dueDate : null;
  const dueTime = input.dueTime && isValidTime(input.dueTime) ? input.dueTime : null;
  return {
    ...state,
    tasks: [
      ...state.tasks,
      {
        id,
        title,
        completed: false,
        priority: input.priority,
        dueDate,
        dueTime,
        category: input.category || 'personal',
        note: input.note.trim().slice(0, 4000),
        goalId: input.goalId,
        sortOrder: nextOrder(state.tasks),
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function updateTask(state: PlannerState, id: string, patch: Partial<TaskInput>, now = nowIso()): PlannerState {
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      if (task.id !== id) return task;
      const title = patch.title === undefined ? task.title : clean(patch.title, 140);
      if (!title) return task;
      const dueDate = patch.dueDate === undefined ? task.dueDate : patch.dueDate && isValidISODate(patch.dueDate) ? patch.dueDate : null;
      const dueTime = patch.dueTime === undefined ? task.dueTime : patch.dueTime && isValidTime(patch.dueTime) ? patch.dueTime : null;
      return {
        ...task,
        ...patch,
        title,
        dueDate,
        dueTime,
        note: patch.note === undefined ? task.note : patch.note.trim().slice(0, 4000),
        updatedAt: now,
      };
    }),
  };
}

export function deleteTask(state: PlannerState, id: string): PlannerState {
  return { ...state, tasks: state.tasks.filter((task) => task.id !== id) };
}

export function clearCompletedTasks(state: PlannerState): PlannerState {
  return { ...state, tasks: state.tasks.filter((task) => !task.completed) };
}

export function toggleTask(state: PlannerState, id: string, now = nowIso()): PlannerState {
  return {
    ...state,
    tasks: state.tasks.map((task) => (task.id === id ? { ...task, completed: !task.completed, updatedAt: now } : task)),
  };
}

export function swapTasks(state: PlannerState, aId: string, bId: string, now = nowIso()): PlannerState {
  const a = state.tasks.find((task) => task.id === aId);
  const b = state.tasks.find((task) => task.id === bId);
  if (!a || !b || aId === bId) return state;
  const bothTimed = Boolean(a.dueTime && b.dueTime);
  const neitherTimed = !a.dueTime && !b.dueTime;
  if (!bothTimed && !neitherTimed) return state;
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      if (task.id === aId) return { ...task, dueTime: b.dueTime, sortOrder: b.sortOrder, updatedAt: now };
      if (task.id === bId) return { ...task, dueTime: a.dueTime, sortOrder: a.sortOrder, updatedAt: now };
      return task;
    }),
  };
}

export function addEvent(state: PlannerState, input: EventInput, id = uid(), now = nowIso()): PlannerState {
  const title = clean(input.title, 140);
  if (!title || !isValidISODate(input.date) || !isValidTime(input.startTime)) return state;
  const endTime = input.endTime && isValidTime(input.endTime) ? input.endTime : null;
  return {
    ...state,
    events: [
      ...state.events,
      {
        id,
        title,
        date: input.date,
        startTime: input.startTime,
        endTime,
        category: input.category || 'personal',
        note: input.note.trim().slice(0, 4000),
        important: input.important,
        completed: false,
        sortOrder: nextOrder(state.events),
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function updateEvent(state: PlannerState, id: string, patch: Partial<EventInput>, now = nowIso()): PlannerState {
  return {
    ...state,
    events: state.events.map((event) => {
      if (event.id !== id) return event;
      const title = patch.title === undefined ? event.title : clean(patch.title, 140);
      if (!title) return event;
      const date = patch.date === undefined ? event.date : isValidISODate(patch.date) ? patch.date : event.date;
      const startTime = patch.startTime === undefined ? event.startTime : isValidTime(patch.startTime) ? patch.startTime : event.startTime;
      let endTime =
        patch.endTime === undefined ? event.endTime : patch.endTime && isValidTime(patch.endTime) ? patch.endTime : null;
      if (endTime && timeToMinutes(endTime) <= timeToMinutes(startTime)) {
        endTime = patch.endTime === undefined ? shiftedEnd(event.startTime, event.endTime, startTime) : null;
      }
      return {
        ...event,
        ...patch,
        title,
        date,
        startTime,
        endTime,
        note: patch.note === undefined ? event.note : patch.note.trim().slice(0, 4000),
        updatedAt: now,
      };
    }),
  };
}

export function deleteEvent(state: PlannerState, id: string): PlannerState {
  return { ...state, events: state.events.filter((event) => event.id !== id) };
}

export function addFixedCommitment(
  state: PlannerState,
  input: FixedCommitmentInput,
  id = uid(),
  now = nowIso(),
): PlannerState {
  const title = clean(input.title, 140);
  if (
    !title || !Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6 ||
    !isValidTime(input.startTime) || !isValidTime(input.endTime) ||
    timeToMinutes(input.endTime) <= timeToMinutes(input.startTime)
  ) return state;
  return {
    ...state,
    fixedCommitments: [
      ...state.fixedCommitments,
      {
        id,
        title,
        weekday: input.weekday,
        startTime: input.startTime,
        endTime: input.endTime,
        category: input.category || 'personal',
        note: input.note.trim().slice(0, 4000),
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function updateFixedCommitment(
  state: PlannerState,
  id: string,
  patch: Partial<FixedCommitmentInput>,
  now = nowIso(),
): PlannerState {
  return {
    ...state,
    fixedCommitments: state.fixedCommitments.map((commitment) => {
      if (commitment.id !== id) return commitment;
      const next = { ...commitment, ...patch };
      const title = clean(next.title, 140);
      if (
        !title || !Number.isInteger(next.weekday) || next.weekday < 0 || next.weekday > 6 ||
        !isValidTime(next.startTime) || !isValidTime(next.endTime) ||
        timeToMinutes(next.endTime) <= timeToMinutes(next.startTime)
      ) return commitment;
      return {
        ...next,
        title,
        note: next.note.trim().slice(0, 4000),
        updatedAt: now,
      };
    }),
  };
}

export function deleteFixedCommitment(state: PlannerState, id: string): PlannerState {
  return { ...state, fixedCommitments: state.fixedCommitments.filter((item) => item.id !== id) };
}

export function toggleEvent(state: PlannerState, id: string, now = nowIso()): PlannerState {
  return {
    ...state,
    events: state.events.map((event) => (event.id === id ? { ...event, completed: !event.completed, updatedAt: now } : event)),
  };
}

export function moveEvent(state: PlannerState, id: string, date: string, now = nowIso()): PlannerState {
  if (!isValidISODate(date)) return state;
  return updateEvent(state, id, { date }, now);
}

export function moveTask(state: PlannerState, id: string, date: string | null, now = nowIso()): PlannerState {
  if (date !== null && !isValidISODate(date)) return state;
  return updateTask(state, id, { dueDate: date }, now);
}

export function swapEventTimes(state: PlannerState, aId: string, bId: string, now = nowIso()): PlannerState {
  const a = state.events.find((event) => event.id === aId);
  const b = state.events.find((event) => event.id === bId);
  if (!a || !b || aId === bId) return state;
  return {
    ...state,
    events: state.events.map((event) => {
      if (event.id === aId) return { ...event, startTime: b.startTime, endTime: b.endTime, updatedAt: now };
      if (event.id === bId) return { ...event, startTime: a.startTime, endTime: a.endTime, updatedAt: now };
      return event;
    }),
  };
}

export function addHabit(
  state: PlannerState,
  input: HabitInput,
  id = uid(),
  now = nowIso(),
  createdOn = todayISO(),
): PlannerState {
  const name = clean(input.name, 60);
  if (!name) return state;
  return {
    ...state,
    habits: [
      ...state.habits,
      {
        id,
        name,
        icon: input.icon || 'leaf',
        accent: input.accent,
        frequency: input.frequency,
        essential: input.essential === true,
        archived: false,
        createdOn,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function addHabits(
  state: PlannerState,
  inputs: HabitInput[],
  now = nowIso(),
  createdOn = todayISO(),
): PlannerState {
  return inputs.reduce((acc, input) => addHabit(acc, input, uid(), now, createdOn), state);
}

export function updateHabit(state: PlannerState, id: string, patch: Partial<HabitInput>, now = nowIso()): PlannerState {
  return {
    ...state,
    habits: state.habits.map((habit) => {
      if (habit.id !== id) return habit;
      const name = patch.name === undefined ? habit.name : clean(patch.name, 60);
      if (!name) return habit;
      return {
        ...habit,
        ...patch,
        name,
        essential: patch.essential === undefined ? habit.essential : patch.essential === true,
        updatedAt: now,
      };
    }),
  };
}

export function setHabitArchived(state: PlannerState, id: string, archived: boolean, now = nowIso()): PlannerState {
  return {
    ...state,
    habits: state.habits.map((habit) => (habit.id === id ? { ...habit, archived, updatedAt: now } : habit)),
  };
}

export function deleteHabit(state: PlannerState, id: string): PlannerState {
  return {
    ...state,
    habits: state.habits.filter((habit) => habit.id !== id),
    completions: state.completions.filter((item) => item.habitId !== id),
  };
}

export function toggleHabit(state: PlannerState, habitId: string, date: string): PlannerState {
  if (!isValidISODate(date) || !state.habits.some((habit) => habit.id === habitId)) return state;
  const exists = state.completions.some((item) => item.habitId === habitId && item.date === date);
  return {
    ...state,
    completions: exists
      ? state.completions.filter((item) => !(item.habitId === habitId && item.date === date))
      : [...state.completions, { habitId, date }],
  };
}

export function addGoal(state: PlannerState, input: GoalInput, id = uid(), milestoneId = uid(), now = nowIso()): PlannerState {
  const title = clean(input.title, 140);
  if (!title) return state;
  const milestone = clean(input.milestone, 140);
  return {
    ...state,
    goals: [
      ...state.goals,
      {
        id,
        title,
        description: input.description.trim().slice(0, 2000),
        horizon: input.horizon,
        deadline: input.deadline && isValidISODate(input.deadline) ? input.deadline : null,
        milestones: milestone ? [{ id: milestoneId, title: milestone, completed: false }] : [],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function updateGoal(
  state: PlannerState,
  id: string,
  patch: Partial<Omit<GoalInput, 'milestone'>>,
  now = nowIso(),
): PlannerState {
  return {
    ...state,
    goals: state.goals.map((goal) => {
      if (goal.id !== id) return goal;
      const title = patch.title === undefined ? goal.title : clean(patch.title, 140);
      if (!title) return goal;
      return {
        ...goal,
        ...patch,
        title,
        description: patch.description === undefined ? goal.description : patch.description.trim().slice(0, 2000),
        deadline:
          patch.deadline === undefined ? goal.deadline : patch.deadline && isValidISODate(patch.deadline) ? patch.deadline : null,
        updatedAt: now,
      };
    }),
  };
}

export function deleteGoal(state: PlannerState, id: string): PlannerState {
  return {
    ...state,
    goals: state.goals.filter((goal) => goal.id !== id),
    tasks: state.tasks.map((task) => (task.goalId === id ? { ...task, goalId: null } : task)),
  };
}

export function addMilestone(state: PlannerState, goalId: string, title: string, id = uid(), now = nowIso()): PlannerState {
  const cleaned = clean(title, 140);
  if (!cleaned) return state;
  return {
    ...state,
    goals: state.goals.map((goal) =>
      goal.id === goalId
        ? { ...goal, updatedAt: now, milestones: [...goal.milestones, { id, title: cleaned, completed: false }] }
        : goal,
    ),
  };
}

export function toggleMilestone(state: PlannerState, goalId: string, milestoneId: string, now = nowIso()): PlannerState {
  return {
    ...state,
    goals: state.goals.map((goal) =>
      goal.id === goalId
        ? {
            ...goal,
            updatedAt: now,
            milestones: goal.milestones.map((step) =>
              step.id === milestoneId ? { ...step, completed: !step.completed } : step,
            ),
          }
        : goal,
    ),
  };
}

export function deleteMilestone(state: PlannerState, goalId: string, milestoneId: string, now = nowIso()): PlannerState {
  return {
    ...state,
    goals: state.goals.map((goal) =>
      goal.id === goalId
        ? { ...goal, updatedAt: now, milestones: goal.milestones.filter((step) => step.id !== milestoneId) }
        : goal,
    ),
  };
}

export function addNote(state: PlannerState, input: NoteInput, id = uid(), now = nowIso()): PlannerState {
  const title = clean(input.title, 140);
  const body = input.body.trim().slice(0, 20000);
  if (!title && !body) return state;
  return {
    ...state,
    notes: [
      {
        id,
        title: title || 'Untitled note',
        body,
        kind: input.kind,
        date: input.date && isValidISODate(input.date) ? input.date : null,
        createdAt: now,
        updatedAt: now,
      },
      ...state.notes,
    ],
  };
}

export function updateNote(state: PlannerState, id: string, patch: Partial<NoteInput>, now = nowIso()): PlannerState {
  return {
    ...state,
    notes: state.notes.map((note) => {
      if (note.id !== id) return note;
      const title = patch.title === undefined ? note.title : clean(patch.title, 140) || 'Untitled note';
      const body = patch.body === undefined ? note.body : patch.body.trim().slice(0, 20000);
      return {
        ...note,
        ...patch,
        title,
        body,
        date: patch.date === undefined ? note.date : patch.date && isValidISODate(patch.date) ? patch.date : null,
        updatedAt: now,
      };
    }),
  };
}

export function deleteNote(state: PlannerState, id: string): PlannerState {
  return { ...state, notes: state.notes.filter((note) => note.id !== id) };
}

export function setIntention(state: PlannerState, date: string, text: string): PlannerState {
  if (!isValidISODate(date)) return state;
  const next = { ...state.intentions };
  if (!text.trim()) delete next[date];
  else next[date] = text.slice(0, 160);
  return { ...state, intentions: next };
}
