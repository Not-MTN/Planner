import { ACCENTS, HABIT_ICONS, NOTE_KINDS, PRIORITIES } from './constants';
import { isValidISODate, isValidTime, localDateFromTimestamp, timeToMinutes } from './dates';
import { createEmptyState, type FixedCommitment, type Goal, type Habit, type HabitFrequency, type Note, type PlannerEvent, type PlannerState, type Task } from './types';

export const STORAGE_KEY = 'personal-planner.v1';
const MAX_BACKUP = 2_000_000;
const PRIORITY_SET = new Set<string>(PRIORITIES.map((item) => item.id));
const ACCENT_SET = new Set<string>(ACCENTS);
const KIND_SET = new Set<string>(NOTE_KINDS.map((item) => item.id));
const ICON_SET = new Set<string>(HABIT_ICONS.map((item) => item.id));

export interface LoadResult {
  state: PlannerState;
  error: string | null;
  persist: boolean;
}

function asString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  return value.slice(0, max);
}

function sanitizeFrequency(value: unknown): HabitFrequency {
  if (!value || typeof value !== 'object') return { type: 'daily' };
  const raw = value as Record<string, unknown>;
  if (raw.type === 'weekdays') return { type: 'weekdays' };
  if (raw.type === 'custom' && Array.isArray(raw.days)) {
    const days = [
      ...new Set(
        raw.days.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6),
      ),
    ];
    return days.length ? { type: 'custom', days } : { type: 'daily' };
  }
  if (raw.type === 'weekly') {
    const times = typeof raw.times === 'number' && Number.isFinite(raw.times) ? Math.round(raw.times) : 3;
    return { type: 'weekly', times: Math.min(7, Math.max(1, times)) };
  }
  return { type: 'daily' };
}

function sanitizeTask(value: unknown): Task | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const title = asString(raw.title, 140)?.trim();
  if (!id || !title) return null;
  const dueDate = asString(raw.dueDate, 10);
  const dueTime = asString(raw.dueTime, 5);
  const goalId = asString(raw.goalId, 80);
  return {
    id,
    title,
    completed: raw.completed === true,
    priority: PRIORITY_SET.has(String(raw.priority)) ? (raw.priority as Task['priority']) : 'medium',
    dueDate: dueDate && isValidISODate(dueDate) ? dueDate : null,
    dueTime: dueTime && isValidTime(dueTime) ? dueTime : null,
    category: asString(raw.category, 40) || 'personal',
    note: asString(raw.note, 4000) ?? '',
    goalId,
    sortOrder: typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder) ? raw.sortOrder : 0,
    createdAt: asString(raw.createdAt, 40) || new Date(0).toISOString(),
    updatedAt: asString(raw.updatedAt, 40) || new Date(0).toISOString(),
  };
}

function sanitizeEvent(value: unknown): PlannerEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const title = asString(raw.title, 140)?.trim();
  const date = asString(raw.date, 10);
  const startTime = asString(raw.startTime, 5);
  if (!id || !title || !date || !isValidISODate(date) || !startTime || !isValidTime(startTime)) return null;
  const endTime = asString(raw.endTime, 5);
  return {
    id,
    title,
    date,
    startTime,
    endTime: endTime && isValidTime(endTime) ? endTime : null,
    category: asString(raw.category, 40) || 'personal',
    note: asString(raw.note, 4000) ?? '',
    important: raw.important === true,
    completed: raw.completed === true,
    sortOrder: typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder) ? raw.sortOrder : 0,
    createdAt: asString(raw.createdAt, 40) || new Date(0).toISOString(),
    updatedAt: asString(raw.updatedAt, 40) || new Date(0).toISOString(),
  };
}

function sanitizeFixedCommitment(value: unknown): FixedCommitment | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const title = asString(raw.title, 140)?.trim();
  const weekday = typeof raw.weekday === 'number' && Number.isInteger(raw.weekday) ? raw.weekday : -1;
  const startTime = asString(raw.startTime, 5);
  const endTime = asString(raw.endTime, 5);
  if (
    !id || !title || weekday < 0 || weekday > 6 || !startTime || !endTime ||
    !isValidTime(startTime) || !isValidTime(endTime) || timeToMinutes(endTime) <= timeToMinutes(startTime)
  ) return null;
  const createdAt = asString(raw.createdAt, 40) || new Date(0).toISOString();
  return {
    id,
    title,
    weekday,
    startTime,
    endTime,
    category: asString(raw.category, 40) || 'personal',
    note: asString(raw.note, 4000) ?? '',
    createdAt,
    updatedAt: asString(raw.updatedAt, 40) || createdAt,
  };
}

function sanitizeHabit(value: unknown): Habit | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const name = asString(raw.name, 60)?.trim();
  if (!id || !name) return null;
  const createdAt = asString(raw.createdAt, 40) || new Date(0).toISOString();
  const createdOn = asString(raw.createdOn, 10);
  const icon = asString(raw.icon, 20) || 'leaf';
  return {
    id,
    name,
    icon: ICON_SET.has(icon) ? icon : 'leaf',
    accent: ACCENT_SET.has(String(raw.accent)) ? (raw.accent as Habit['accent']) : 'sage',
    frequency: sanitizeFrequency(raw.frequency),
    essential: raw.essential === true,
    archived: raw.archived === true,
    createdOn: createdOn && isValidISODate(createdOn) ? createdOn : localDateFromTimestamp(createdAt),
    createdAt,
    updatedAt: asString(raw.updatedAt, 40) || createdAt,
  };
}

function sanitizeGoal(value: unknown): Goal | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const title = asString(raw.title, 140)?.trim();
  if (!id || !title) return null;
  const deadline = asString(raw.deadline, 10);
  const milestones = Array.isArray(raw.milestones)
    ? raw.milestones.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const step = item as Record<string, unknown>;
        const stepId = asString(step.id, 80);
        const stepTitle = asString(step.title, 140)?.trim();
        if (!stepId || !stepTitle) return [];
        return [{ id: stepId, title: stepTitle, completed: step.completed === true }];
      })
    : [];
  return {
    id,
    title,
    description: asString(raw.description, 2000) ?? '',
    horizon: raw.horizon === 'long' ? 'long' : 'short',
    deadline: deadline && isValidISODate(deadline) ? deadline : null,
    milestones,
    createdAt: asString(raw.createdAt, 40) || new Date(0).toISOString(),
    updatedAt: asString(raw.updatedAt, 40) || new Date(0).toISOString(),
  };
}

function sanitizeNote(value: unknown): Note | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const title = asString(raw.title, 140)?.trim();
  const body = asString(raw.body, 20000) ?? '';
  if (!id || (!title && !body.trim())) return null;
  const date = asString(raw.date, 10);
  const kind = asString(raw.kind, 20) || 'quick';
  return {
    id,
    title: title || 'Untitled note',
    body,
    kind: KIND_SET.has(kind) ? (kind as Note['kind']) : 'quick',
    date: date && isValidISODate(date) ? date : null,
    createdAt: asString(raw.createdAt, 40) || new Date(0).toISOString(),
    updatedAt: asString(raw.updatedAt, 40) || new Date(0).toISOString(),
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function sanitizeState(raw: unknown): PlannerState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const tasks = uniqueBy(Array.isArray(source.tasks) ? source.tasks.flatMap((item) => {
    const task = sanitizeTask(item);
    return task ? [task] : [];
  }) : [], (item) => item.id);
  const events = uniqueBy(Array.isArray(source.events) ? source.events.flatMap((item) => {
    const event = sanitizeEvent(item);
    return event ? [event] : [];
  }) : [], (item) => item.id);
  const fixedCommitments = uniqueBy(Array.isArray(source.fixedCommitments) ? source.fixedCommitments.flatMap((item) => {
    const commitment = sanitizeFixedCommitment(item);
    return commitment ? [commitment] : [];
  }) : [], (item) => item.id);
  const habits = uniqueBy(Array.isArray(source.habits) ? source.habits.flatMap((item) => {
    const habit = sanitizeHabit(item);
    return habit ? [habit] : [];
  }) : [], (item) => item.id);
  const habitIds = new Set(habits.map((habit) => habit.id));
  const completionSeen = new Set<string>();
  const completions = Array.isArray(source.completions)
    ? source.completions.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const rawItem = item as Record<string, unknown>;
        const habitId = asString(rawItem.habitId, 80);
        const date = asString(rawItem.date, 10);
        if (!habitId || !date || !habitIds.has(habitId) || !isValidISODate(date)) return [];
        const key = `${habitId}|${date}`;
        if (completionSeen.has(key)) return [];
        completionSeen.add(key);
        return [{ habitId, date }];
      })
    : [];
  const goals = uniqueBy(Array.isArray(source.goals) ? source.goals.flatMap((item) => {
    const goal = sanitizeGoal(item);
    return goal ? [goal] : [];
  }) : [], (item) => item.id);
  const goalIds = new Set(goals.map((goal) => goal.id));
  const notes = uniqueBy(Array.isArray(source.notes) ? source.notes.flatMap((item) => {
    const note = sanitizeNote(item);
    return note ? [note] : [];
  }) : [], (item) => item.id);
  const intentions: Record<string, string> = {};
  if (source.intentions && typeof source.intentions === 'object' && !Array.isArray(source.intentions)) {
    for (const [key, value] of Object.entries(source.intentions)) {
      if (!isValidISODate(key) || typeof value !== 'string' || !value.trim()) continue;
      intentions[key] = value.slice(0, 160);
    }
  }
  return {
    tasks: tasks.map((task) => ({ ...task, goalId: task.goalId && goalIds.has(task.goalId) ? task.goalId : null })),
    events,
    fixedCommitments,
    habits,
    completions,
    goals,
    notes,
    intentions,
  };
}

export function serialize(state: PlannerState, exportedAt = new Date().toISOString()): string {
  return JSON.stringify({ version: 1, exportedAt, ...state }, null, 2);
}

export function parseBackup(text: string): { ok: true; state: PlannerState } | { ok: false; error: string } {
  if (text.length > MAX_BACKUP) return { ok: false, error: 'That backup is too large.' };
  try {
    const state = sanitizeState(JSON.parse(text) as unknown);
    if (!state) return { ok: false, error: 'That file is not a planner backup.' };
    return { ok: true, state };
  } catch {
    return { ok: false, error: 'That file could not be read.' };
  }
}

export function loadFrom(storage: Pick<Storage, 'getItem'>): LoadResult {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { state: createEmptyState(), error: null, persist: true };
    const state = sanitizeState(JSON.parse(raw) as unknown);
    if (!state) {
      return {
        state: createEmptyState(),
        error: 'Saved planner data was unreadable. Start fresh, or import a backup. The old data is still stored until you do.',
        persist: false,
      };
    }
    return { state, error: null, persist: true };
  } catch {
    return {
      state: createEmptyState(),
      error: 'Planner data could not be loaded from this browser.',
      persist: false,
    };
  }
}

export function saveTo(storage: Pick<Storage, 'setItem'>, state: PlannerState): string | null {
  try {
    storage.setItem(STORAGE_KEY, serialize(state));
    return null;
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
    if (name === 'QuotaExceededError') return 'Browser storage is full, so that change was not saved.';
    return 'That change could not be saved in this browser.';
  }
}

export function downloadState(state: PlannerState, date: string): void {
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `planner-${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
