import { addDays, isValidISODate, isValidTime, timeToMinutes, todayISO, weekDates } from './dates';
import { nextDueAfterCompletion, REPEAT_SET } from './recurrence';
import { MAX_PLAN_DAYS } from './duration';
import { AI_DECLINED_LIMIT, AI_DECLINED_MAX_AGE_DAYS, AI_PLAN_LIMIT, GOAL_STEPS_MAX } from './types';
import { t } from './i18n';
import type {
  AIMemoryCategory,
  AIMemoryInput,
  EventInput,
  Habit,
  Subtask,
  TaskRepeat,
  FixedCommitmentInput,
  GoalInput,
  HabitInput,
  MoodEntry,
  MoodValue,
  NoteInput,
  PlannerState,
  SavedAIPlan,
  SavedAIPlanInput,
  Task,
  TaskInput,
  AIDeclined,
  AIDeclinedKind,
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

function cleanRepeat(value: TaskRepeat | null | undefined): TaskRepeat | null {
  return value && REPEAT_SET.has(value) ? value : null;
}

const AI_MEMORY_CATEGORIES = new Set<AIMemoryCategory>(['preference', 'person', 'routine', 'boundary', 'context']);

function cleanAIMemoryCategory(value: AIMemoryCategory): AIMemoryCategory {
  return AI_MEMORY_CATEGORIES.has(value) ? value : 'context';
}

export function cleanSubtasks(items: Subtask[] | undefined): Subtask[] {
  if (!items) return [];
  return items
    .map((item) => ({ id: item.id || uid(), title: clean(item.title, 140), completed: item.completed === true }))
    .filter((item) => item.title)
    .slice(0, 50);
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
        repeat: cleanRepeat(input.repeat),
        subtasks: cleanSubtasks(input.subtasks),
        completedAt: null,
        waiting: input.waiting ? clean(input.waiting, 140) : null,
        estimatedMinutes: cleanEstimate(input.estimatedMinutes),
      },
    ],
  };
}

function cleanEstimate(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const minutes = Math.round(value);
  return minutes >= 1 && minutes <= 1440 ? minutes : null;
}

function cleanUnit(value: HabitInput['unit']): Habit['unit'] {
  if (!value || typeof value !== 'object') return null;
  const label = String(value.label ?? '').trim().toLowerCase().slice(0, 20);
  const target = Number.isFinite(value.target) ? Math.round(value.target) : 0;
  if (!label || target < 1 || target > 999) return null;
  return { label, target };
}

/**
 * What a patch may carry. `completed` lives on `Task`, not on `TaskInput`, so a
 * caller that only knew the input shape had its "done" flag dropped without a
 * word. Named here so the board and the bulk editor can use it honestly.
 */
export interface TaskPatch extends Partial<TaskInput> {
  completed?: boolean;
}

export function updateTask(state: PlannerState, id: string, patch: TaskPatch, now = nowIso()): PlannerState {
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      if (task.id !== id) return task;
      const title = patch.title === undefined ? task.title : clean(patch.title, 140);
      if (!title) return task;
      const dueDate = patch.dueDate === undefined ? task.dueDate : patch.dueDate && isValidISODate(patch.dueDate) ? patch.dueDate : null;
      const dueTime = patch.dueTime === undefined ? task.dueTime : patch.dueTime && isValidTime(patch.dueTime) ? patch.dueTime : null;
      // Ticking a task off through a patch has to stamp the moment as well,
      // or insights and streaks quietly lose the day it happened.
      const completed = patch.completed === undefined ? task.completed : patch.completed;
      const completedAt = patch.completed === undefined ? task.completedAt : completed ? task.completedAt ?? now : null;
      return {
        ...task,
        ...patch,
        title,
        dueDate,
        dueTime,
        completed,
        completedAt,
        note: patch.note === undefined ? task.note : patch.note.trim().slice(0, 4000),
        repeat: patch.repeat === undefined ? task.repeat : cleanRepeat(patch.repeat),
        subtasks: patch.subtasks === undefined ? task.subtasks : cleanSubtasks(patch.subtasks),
        waiting: patch.waiting === undefined ? task.waiting : patch.waiting ? clean(patch.waiting, 140) : null,
        estimatedMinutes: patch.estimatedMinutes === undefined ? task.estimatedMinutes : cleanEstimate(patch.estimatedMinutes),
        updatedAt: now,
      };
    }),
  };
}

/** Apply the same patch to many tasks at once. Single undo covers the whole batch. */
export function updateTasks(state: PlannerState, ids: string[], patch: TaskPatch, now = nowIso()): PlannerState {
  return ids.reduce((next, id) => updateTask(next, id, patch, now), state);
}

/** Complete or reopen many tasks at once, honouring repeat rules like a single toggle would. */
export function completeTasks(state: PlannerState, ids: string[], complete: boolean, now = nowIso(), today = todayISO()): PlannerState {
  let next = state;
  for (const id of ids) {
    const task = next.tasks.find((item) => item.id === id);
    if (!task || task.completed === complete) continue;
    next = toggleTask(next, id, now, today, uid());
  }
  return next;
}

export function deleteTasks(state: PlannerState, ids: string[]): PlannerState {
  const drop = new Set(ids);
  return { ...state, tasks: state.tasks.filter((task) => !drop.has(task.id)) };
}

export function moveTasks(state: PlannerState, ids: string[], date: string | null, now = nowIso()): PlannerState {
  return ids.reduce((next, id) => moveTask(next, id, date, now), state);
}

export function duplicateTask(state: PlannerState, id: string, now = nowIso(), nextId = uid()): PlannerState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  return addTask(
    state,
    {
      title: task.title,
      priority: task.priority,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      category: task.category,
      note: task.note,
      goalId: task.goalId,
      repeat: task.repeat,
      subtasks: task.subtasks.map((step) => ({ ...step, id: '', completed: false })),
      waiting: task.waiting,
      estimatedMinutes: task.estimatedMinutes,
    },
    nextId,
    now,
  );
}

export function deleteTask(state: PlannerState, id: string): PlannerState {
  return { ...state, tasks: state.tasks.filter((task) => task.id !== id) };
}

export function clearCompletedTasks(state: PlannerState): PlannerState {
  return { ...state, tasks: state.tasks.filter((task) => !task.completed) };
}

/**
 * The next occurrence `id` created when it was completed — but only while
 * nobody has worked on it. Anything the user has ticked, stepped through or
 * carried forward again is their work now, so it is left alone.
 */
function removableSpawn(state: PlannerState, id: string | null | undefined): Task | null {
  if (!id) return null;
  const spawn = state.tasks.find((task) => task.id === id);
  if (!spawn) return null;
  if (spawn.completed || spawn.completedAt || spawn.spawnedId) return null;
  if (spawn.subtasks.some((item) => item.completed)) return null;
  return spawn;
}

export function toggleTask(state: PlannerState, id: string, now = nowIso(), today = todayISO(), nextId = uid()): PlannerState {
  const target = state.tasks.find((task) => task.id === id);
  if (!target) return state;
  const completing = !target.completed;
  // The copy this task made the last time it was completed. Completing again
  // replaces it so the date moves on; un-completing takes it back so a series
  // can never double up.
  const spawn = completing
    ? (target.repeat ? removableSpawn(state, target.spawnedId) : null)
    : removableSpawn(state, target.spawnedId);
  const tasks = state.tasks
    .filter((task) => task.id !== spawn?.id)
    .map((task) =>
      task.id === id
        ? {
            ...task,
            completed: completing,
            completedAt: completing ? now : null,
            // The rule stays on the finished copy on purpose: nulling it here
            // meant un-checking the task ended the series for good.
            spawnedId: completing && target.repeat ? nextId : null,
            updatedAt: now,
          }
        : task,
    );
  if (completing && target.repeat) {
    // The finished copy stays in history; a fresh copy carries the rule forward.
    tasks.push({
      ...target,
      id: nextId,
      completed: false,
      completedAt: null,
      spawnedId: null,
      dueDate: nextDueAfterCompletion(target.dueDate, target.repeat, today),
      subtasks: target.subtasks.map((item) => ({ ...item, completed: false })),
      sortOrder: nextOrder(state.tasks),
      createdAt: now,
      updatedAt: now,
    });
  }
  return { ...state, tasks };
}

export function toggleSubtask(state: PlannerState, taskId: string, subtaskId: string, now = nowIso()): PlannerState {
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId
        ? { ...task, updatedAt: now, subtasks: task.subtasks.map((item) => (item.id === subtaskId ? { ...item, completed: !item.completed } : item)) }
        : task,
    ),
  };
}

export function resizeEvent(state: PlannerState, id: string, endTime: string, now = nowIso()): PlannerState {
  const event = state.events.find((item) => item.id === id);
  if (!event || !isValidTime(endTime) || timeToMinutes(endTime) <= timeToMinutes(event.startTime)) return state;
  return updateEvent(state, id, { endTime }, now);
}

export function logFocus(
  state: PlannerState,
  entry: { taskId: string | null; title: string; minutes: number },
  id = uid(),
  now = nowIso(),
  date = todayISO(),
): PlannerState {
  const minutes = Math.round(entry.minutes);
  if (!Number.isFinite(minutes) || minutes < 1) return state;
  const log = [...state.focusLog, { id, taskId: entry.taskId, title: clean(entry.title, 140) || 'Focus', minutes: Math.min(minutes, 600), date, endedAt: now }];
  return { ...state, focusLog: log.slice(-2000) };
}

export function addAIMemory(state: PlannerState, input: AIMemoryInput, id = uid(), now = nowIso()): PlannerState {
  const text = clean(input.text, 500);
  if (!text) return state;
  const duplicate = state.aiMemory.some((item) => item.text.toLowerCase() === text.toLowerCase());
  if (duplicate) return state;
  const memory = {
    id,
    text,
    category: cleanAIMemoryCategory(input.category),
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, aiMemory: [...state.aiMemory, memory].slice(-100) };
}

export function updateAIMemory(state: PlannerState, id: string, patch: Partial<AIMemoryInput>, now = nowIso()): PlannerState {
  return {
    ...state,
    aiMemory: state.aiMemory.map((item) => {
      if (item.id !== id) return item;
      const text = patch.text === undefined ? item.text : clean(patch.text, 500);
      if (!text) return item;
      return {
        ...item,
        ...patch,
        text,
        category: patch.category === undefined ? item.category : cleanAIMemoryCategory(patch.category),
        updatedAt: now,
      };
    }),
  };
}

export function deleteAIMemory(state: PlannerState, id: string): PlannerState {
  return { ...state, aiMemory: state.aiMemory.filter((item) => item.id !== id) };
}

export function clearAIMemory(state: PlannerState): PlannerState {
  return state.aiMemory.length === 0 ? state : { ...state, aiMemory: [] };
}

// ── Declined AI suggestions ───────────────────────────────────────────

/**
 * Remember the suggestions this user did not keep, so they stop coming back.
 *
 * Two things keep this honest. It is capped and it expires: the record is
 * meant to prevent an idea being proposed twice in a row, not to build a
 * permanent file. And every entry is visible in Memory, where it can be
 * forgotten individually — a preference learned silently and then acted on
 * invisibly is a guess the user has no way to correct.
 */
export function recordDeclined(
  state: PlannerState,
  items: Array<{ title: string; kind: AIDeclinedKind }>,
  now = nowIso(),
): PlannerState {
  const incoming = items
    .map((item) => ({ title: clean(item.title, 140).trim(), kind: item.kind }))
    .filter((item) => item.title.length > 0);
  if (incoming.length === 0) return state;

  const cutoff = new Date(Date.now() - AI_DECLINED_MAX_AGE_DAYS * 86_400_000).toISOString();
  const byKey = new Map<string, AIDeclined>();
  for (const entry of state.aiDeclined ?? []) {
    // Expired entries are dropped rather than carried: an old "no" is not
    // evidence about today.
    if (entry.updatedAt < cutoff) continue;
    byKey.set(entry.title.toLowerCase(), entry);
  }
  let changed = false;
  for (const item of incoming) {
    const key = item.title.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      if (existing.kind === item.kind) {
        // Said no again: that is the strongest signal there is, so refresh it.
        if (existing.updatedAt !== now) {
          byKey.set(key, { ...existing, updatedAt: now });
          changed = true;
        }
        continue;
      }
      byKey.set(key, { ...existing, kind: item.kind, updatedAt: now });
      changed = true;
      continue;
    }
    byKey.set(key, { id: uid(), title: item.title, kind: item.kind, createdAt: now, updatedAt: now });
    changed = true;
  }
  if (!changed) return state;

  const next = [...byKey.values()]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(-AI_DECLINED_LIMIT);
  return { ...state, aiDeclined: next };
}

export function forgetDeclined(state: PlannerState, id: string): PlannerState {
  const next = (state.aiDeclined ?? []).filter((item) => item.id !== id);
  return next.length === (state.aiDeclined ?? []).length ? state : { ...state, aiDeclined: next };
}

export function clearDeclined(state: PlannerState): PlannerState {
  return (state.aiDeclined ?? []).length === 0 ? state : { ...state, aiDeclined: [] };
}

// ── Saved AI plans (the Plans page) ───────────────────────────────────

function cleanPlanTitle(input: SavedAIPlanInput): string {
  const title = input.title.trim().slice(0, 140);
  if (title) return title;
  const fallback = input.summary.trim() || input.prompt.trim();
  return fallback.slice(0, 60);
}

/** Save an AI draft to the Plans page, newest first. Returns the stored plan. */
export function saveAIPlan(state: PlannerState, input: SavedAIPlanInput, id = uid(), now = nowIso()): { state: PlannerState; plan: SavedAIPlan } {
  const startDate = isValidISODate(input.startDate) ? input.startDate : todayISO();
  const days = Math.max(1, Math.min(MAX_PLAN_DAYS, Math.round(Number.isFinite(input.days) ? input.days : 1)));
  const plan: SavedAIPlan = {
    id,
    title: cleanPlanTitle(input),
    prompt: input.prompt.trim().slice(0, 2400),
    summary: input.summary.trim().slice(0, 400),
    startDate,
    days,
    status: 'draft',
    source: input.source === 'voice' ? 'voice' : 'typed',
    tasks: input.tasks.slice(0, 40),
    events: input.events.slice(0, 40),
    habits: input.habits.slice(0, 12),
    suggestions: input.suggestions.slice(0, 5),
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...state, aiPlans: [plan, ...state.aiPlans].slice(0, AI_PLAN_LIMIT) }, plan };
}

export function deleteAIPlan(state: PlannerState, id: string): PlannerState {
  return state.aiPlans.some((plan) => plan.id === id)
    ? { ...state, aiPlans: state.aiPlans.filter((plan) => plan.id !== id) }
    : state;
}

/** Fields the AI can revise in a saved plan. Everything else is untouched. */
export interface AIPlanPatch {
  summary?: string;
  startDate?: string;
  days?: number;
  tasks?: TaskInput[];
  events?: EventInput[];
  habits?: HabitInput[];
  suggestions?: string[];
}

/** Replace a saved plan's draft contents after the AI revises it. */
export function updateAIPlan(state: PlannerState, id: string, patch: AIPlanPatch, now = nowIso()): PlannerState {
  if (!state.aiPlans.some((plan) => plan.id === id)) return state;
  return {
    ...state,
    aiPlans: state.aiPlans.map((plan) => {
      if (plan.id !== id) return plan;
      const days = patch.days === undefined
        ? plan.days
        : Math.max(1, Math.min(MAX_PLAN_DAYS, Math.round(patch.days)));
      return {
        ...plan,
        summary: patch.summary === undefined ? plan.summary : patch.summary.trim().slice(0, 400),
        startDate: patch.startDate !== undefined && isValidISODate(patch.startDate) ? patch.startDate : plan.startDate,
        days,
        tasks: patch.tasks ? patch.tasks.slice(0, 40) : plan.tasks,
        events: patch.events ? patch.events.slice(0, 40) : plan.events,
        habits: patch.habits ? patch.habits.slice(0, 12) : plan.habits,
        suggestions: patch.suggestions ? patch.suggestions.slice(0, 5) : plan.suggestions,
        updatedAt: now,
      };
    }),
  };
}

/** Mark a plan as applied to the planner once its items have been added. */
export function markAIPlanAdded(state: PlannerState, id: string, now = nowIso()): PlannerState {
  if (!state.aiPlans.some((plan) => plan.id === id && plan.status === 'draft')) return state;
  return {
    ...state,
    aiPlans: state.aiPlans.map((plan) => (plan.id === id ? { ...plan, status: 'added', updatedAt: now } : plan)),
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
        repeat: cleanRepeat(input.repeat),
        source: input.source ?? null,
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
        repeat: patch.repeat === undefined ? event.repeat : cleanRepeat(patch.repeat),
        source: patch.source === undefined ? event.source ?? null : patch.source,
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
        unit: cleanUnit(input.unit),
        reminderTime: input.reminderTime && isValidTime(input.reminderTime) ? input.reminderTime : null,
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
        unit: patch.unit === undefined ? habit.unit : cleanUnit(patch.unit),
        reminderTime: patch.reminderTime === undefined
          ? habit.reminderTime ?? null
          : patch.reminderTime && isValidTime(patch.reminderTime) ? patch.reminderTime : null,
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
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit || !isValidISODate(date)) return state;
  const exists = state.completions.some((item) => item.habitId === habitId && item.date === date);
  return {
    ...state,
    completions: exists
      ? state.completions.filter((item) => !(item.habitId === habitId && item.date === date))
      : [...state.completions, habit.unit ? { habitId, date, value: habit.unit.target } : { habitId, date }],
  };
}

/** Record an amount for a unit-based habit; reaching the target marks the day done. 0 clears the day. */
export function setHabitValue(state: PlannerState, habitId: string, date: string, value: number): PlannerState {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit || !isValidISODate(date) || !Number.isFinite(value)) return state;
  const amount = Math.max(0, Math.min(999, Math.round(value)));
  const others = state.completions.filter((item) => !(item.habitId === habitId && item.date === date));
  if (amount === 0) return { ...state, completions: others };
  return { ...state, completions: [...others, { habitId, date, value: amount }] };
}

/** Toggle a deliberate rest day — neutral for streaks and stats. */
export function skipHabit(state: PlannerState, habitId: string, date: string): PlannerState {
  if (!isValidISODate(date) || !state.habits.some((habit) => habit.id === habitId)) return state;
  const existing = state.completions.find((item) => item.habitId === habitId && item.date === date);
  const others = state.completions.filter((item) => !(item.habitId === habitId && item.date === date));
  if (existing?.skipped) return { ...state, completions: others };
  return { ...state, completions: [...others, { habitId, date, skipped: true }] };
}

export function addGoal(state: PlannerState, input: GoalInput, id = uid(), milestoneId = uid(), now = nowIso()): PlannerState {
  const title = clean(input.title, 140);
  if (!title) return state;
  const milestone = clean(input.milestone ?? '', 140);
  // Several steps at once when a goal arrives with them; otherwise the single
  // line someone typed. The second id onwards has to differ, so a step can be
  // ticked on its own.
  const steps = (input.milestones ?? []).map((step, index) => ({
    id: index === 0 ? milestoneId : `${milestoneId}-${index}`,
    title: clean(step.title, 140),
    completed: false,
    dueDate: step.dueDate && isValidISODate(step.dueDate) ? step.dueDate : null,
  })).filter((step) => step.title).slice(0, GOAL_STEPS_MAX);
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
        milestones:
          steps.length > 0
            ? steps
            : milestone
              ? [{ id: milestoneId, title: milestone, completed: false, dueDate: input.milestoneDue && isValidISODate(input.milestoneDue) ? input.milestoneDue : null }]
              : [],
        ...(input.fromSuggestion ? { fromSuggestion: input.fromSuggestion } : {}),
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function updateGoal(
  state: PlannerState,
  id: string,
  // Steps and provenance are set when a goal is made, not edited afterwards.
  patch: Partial<Omit<GoalInput, 'milestone' | 'milestones' | 'fromSuggestion'>>,
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

export function addMilestone(state: PlannerState, goalId: string, title: string, id = uid(), now = nowIso(), dueDate: string | null = null): PlannerState {
  const cleaned = clean(title, 140);
  if (!cleaned) return state;
  const due = dueDate && isValidISODate(dueDate) ? dueDate : null;
  return {
    ...state,
    goals: state.goals.map((goal) =>
      goal.id === goalId
        ? { ...goal, updatedAt: now, milestones: [...goal.milestones, { id, title: cleaned, completed: false, dueDate: due }] }
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
        title: title || t("Untitled note"),
        body,
        kind: input.kind,
        date: input.date && isValidISODate(input.date) ? input.date : null,
        pinned: input.pinned === true,
        attachments: input.attachments && input.attachments.length > 0 ? input.attachments.slice(0, 24) : undefined,
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
      const title = patch.title === undefined ? note.title : clean(patch.title, 140) || t("Untitled note");
      const body = patch.body === undefined ? note.body : patch.body.trim().slice(0, 20000);
      return {
        ...note,
        ...patch,
        title,
        body,
        date: patch.date === undefined ? note.date : patch.date && isValidISODate(patch.date) ? patch.date : null,
        pinned: patch.pinned === undefined ? note.pinned === true : patch.pinned === true,
        updatedAt: now,
      };
    }),
  };
}

export function deleteNote(state: PlannerState, id: string): PlannerState {
  return { ...state, notes: state.notes.filter((note) => note.id !== id) };
}

/**
 * Record how a day felt (1 drained → 5 glowing). One entry per day — logging
 * again replaces it; passing null clears the day.
 */
export function setMood(state: PlannerState, date: string, value: MoodValue | null, taskId?: string, now = nowIso()): PlannerState {
  const rest = state.moods.filter((entry) => entry.date !== date);
  if (value === null) return { ...state, moods: rest };
  const entry: MoodEntry = { date, value, updatedAt: now };
  if (taskId) entry.taskId = taskId;
  return { ...state, moods: [...rest, entry].sort((a, b) => a.date.localeCompare(b.date)).slice(-2000) };
}

export function setIntention(state: PlannerState, date: string, text: string): PlannerState {
  if (!isValidISODate(date)) return state;
  const next = { ...state.intentions };
  if (!text.trim()) delete next[date];
  else next[date] = text.slice(0, 160);
  return { ...state, intentions: next };
}

/** Copy this week's dated events and open tasks onto the following week. */
export function copyWeek(state: PlannerState, fromDate: string, now = nowIso()): PlannerState {
  if (!isValidISODate(fromDate)) return state;
  const days = new Set(weekDates(fromDate));
  let next = state;
  for (const event of state.events) {
    if (!days.has(event.date) || event.repeat || event.completed) continue;
    next = addEvent(
      next,
      {
        title: event.title,
        date: addDays(event.date, 7),
        startTime: event.startTime,
        endTime: event.endTime,
        category: event.category,
        note: event.note,
        important: event.important,
      },
      uid(),
      now,
    );
  }
  for (const task of state.tasks) {
    if (!task.dueDate || !days.has(task.dueDate) || task.completed || task.repeat) continue;
    next = addTask(
      next,
      {
        title: task.title,
        priority: task.priority,
        dueDate: addDays(task.dueDate, 7),
        dueTime: task.dueTime,
        category: task.category,
        note: task.note,
        goalId: task.goalId,
        subtasks: task.subtasks.map((step) => ({ ...step, id: '', completed: false })),
        waiting: task.waiting,
        estimatedMinutes: task.estimatedMinutes,
      },
      uid(),
      now,
    );
  }
  return next;
}

/** Shift unfinished work from this week onto the same weekday next week. */
export function carryWeekLeftovers(state: PlannerState, today: string, now = nowIso()): PlannerState {
  if (!isValidISODate(today)) return state;
  const days = weekDates(today);
  let next = state;
  for (const task of state.tasks) {
    if (task.completed || !task.dueDate || !days.includes(task.dueDate) || task.dueDate > today) continue;
    next = moveTask(next, task.id, addDays(task.dueDate, 7), now);
  }
  return next;
}
