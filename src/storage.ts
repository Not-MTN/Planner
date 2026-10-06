import { ACCENTS, categoryById, HABIT_ICONS, NOTE_KINDS, PRIORITIES } from './constants';
import { isBase64 } from './shared/authContract';
import { isValidISODate, isValidTime, localDateFromTimestamp, timeToMinutes } from './dates';
import { REPEAT_SET } from './recurrence';
import { MAX_PLAN_DAYS } from './duration';
import { AI_PLAN_LIMIT, GOAL_STEPS_MAX, PRAISE_KEPT, createEmptyPanels, createEmptyState, isGradeLevel, type AIDeclined, type AIDeclinedKind, type AIMemory, type AttachmentRef, type AIMemoryCategory, type ChangeNote, type EventInput, type FixedCommitment, type FocusLog, type GoalAnswer, type GoalSuggestion, type GuardianKind, type GuardianLink, type GuardianNotice, type GuardianPlan, type HabitCompletion, type HabitInput, type MoodEntry, type MoodValue, type Panels, type PlanCadence, type PlanItem, type StudentGuardian, type StudentInbox, type StudentSubject, type Subtask, type TaskInput, type TaskRepeat, type WeekResults, type Goal, type Habit, type HabitFrequency, type HabitUnit, type Note, type PlannerEvent, type PlannerState, type SavedAIPlan, type Task, type WeekArchive } from './types';
import { t } from './i18n';
import { downloadBlob } from './download';

export const STORAGE_KEY = 'personal-planner.v1';
/** The message a failed write shows. A function, not a constant: dictionaries
 *  arrive after this module is evaluated (src/i18n.ts), so a string captured
 *  here would be English for every language. */
export function storageFullMessage(): string {
  return t("Browser storage is full, so that change was not saved.");
}
const MAX_BACKUP = 2_000_000;
const PRIORITY_SET = new Set<string>(PRIORITIES.map((item) => item.id));
const ACCENT_SET = new Set<string>(ACCENTS);
const KIND_SET = new Set<string>(NOTE_KINDS.map((item) => item.id));
const ICON_SET = new Set<string>(HABIT_ICONS.map((item) => item.id));
const AI_MEMORY_CATEGORY_SET = new Set<AIMemoryCategory>(['preference', 'person', 'routine', 'boundary', 'context']);
const AI_DECLINED_KIND_SET = new Set<AIDeclinedKind>(['task', 'event', 'habit']);

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
    repeat: REPEAT_SET.has(String(raw.repeat)) ? (raw.repeat as TaskRepeat) : null,
    subtasks: sanitizeSubtasks(raw.subtasks),
    completedAt: asString(raw.completedAt, 40) || null,
    waiting: asString(raw.waiting, 140)?.trim() || null,
    estimatedMinutes: sanitizeMinutes(raw.estimatedMinutes),
    spawnedId: asString(raw.spawnedId, 80),
  };
}

function sanitizeMinutes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const minutes = Math.round(value);
  return minutes >= 1 && minutes <= 1440 ? minutes : null;
}

function sanitizeUnit(value: unknown): HabitUnit | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const label = asString(raw.label, 20)?.trim().toLowerCase();
  const target = typeof raw.target === 'number' && Number.isFinite(raw.target) ? Math.round(raw.target) : 0;
  if (!label || target < 1 || target > 999) return null;
  return { label: label.slice(0, 20), target };
}

function sanitizeEventSource(value: unknown): PlannerEvent['source'] {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const url = asString(raw.url, 400)?.trim();
  const uid = asString(raw.uid, 200)?.trim();
  if (!url || !uid || !/^https?:\/\//i.test(url)) return null;
  return { url, uid };
}

function sanitizeSubtasks(value: unknown): Subtask[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const id = asString(raw.id, 80);
    const title = asString(raw.title, 140)?.trim();
    if (!id || !title || seen.has(id)) return [];
    seen.add(id);
    return [{ id, title, completed: raw.completed === true }];
  }).slice(0, 50);
}

function sanitizeFocusLog(value: unknown): FocusLog[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const id = asString(raw.id, 80);
    const date = asString(raw.date, 10);
    const minutes = typeof raw.minutes === 'number' && Number.isFinite(raw.minutes) ? Math.round(raw.minutes) : 0;
    if (!id || !date || !isValidISODate(date) || minutes < 1) return [];
    return [{
      id,
      taskId: asString(raw.taskId, 80),
      title: asString(raw.title, 140) || t("Focus"),
      minutes: Math.min(minutes, 600),
      date,
      endedAt: asString(raw.endedAt, 40) || new Date(0).toISOString(),
    }];
  }).slice(-2000);
}

function sanitizeAIMemory(value: unknown): AIMemory[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const id = asString(raw.id, 80);
    const text = asString(raw.text, 500)?.trim();
    const category = asString(raw.category, 20);
    if (!id || !text || !category || !AI_MEMORY_CATEGORY_SET.has(category as AIMemoryCategory) || seen.has(id)) return [];
    seen.add(id);
    const createdAt = asString(raw.createdAt, 40) || new Date(0).toISOString();
    return [{
      id,
      text,
      category: category as AIMemoryCategory,
      createdAt,
      updatedAt: asString(raw.updatedAt, 40) || createdAt,
    }];
  }).slice(-100);
}

function sanitizeAIDeclined(value: unknown): AIDeclined[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const id = asString(raw.id, 80);
    const title = asString(raw.title, 140)?.trim();
    const kind = asString(raw.kind, 10);
    if (!id || !title || !kind || !AI_DECLINED_KIND_SET.has(kind as AIDeclinedKind) || seen.has(id)) return [];
    seen.add(id);
    const createdAt = asString(raw.createdAt, 40) || new Date(0).toISOString();
    return [{
      id,
      title,
      kind: kind as AIDeclinedKind,
      createdAt,
      updatedAt: asString(raw.updatedAt, 40) || createdAt,
    }];
  }).slice(-100);
}

function sanitizePlanTask(value: unknown): TaskInput | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const title = asString(raw.title, 140)?.trim();
  if (!title) return null;
  const dueDate = asString(raw.dueDate, 10);
  const dueTime = asString(raw.dueTime, 5);
  return {
    title,
    priority: PRIORITY_SET.has(String(raw.priority)) ? (raw.priority as TaskInput['priority']) : 'medium',
    dueDate: dueDate && isValidISODate(dueDate) ? dueDate : null,
    dueTime: dueTime && isValidTime(dueTime) ? dueTime : null,
    category: asString(raw.category, 40) || 'personal',
    note: asString(raw.note, 1000) ?? '',
    goalId: null,
  };
}

function sanitizePlanEvent(value: unknown): EventInput | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const title = asString(raw.title, 140)?.trim();
  const date = asString(raw.date, 10);
  const startTime = asString(raw.startTime, 5);
  const endTime = asString(raw.endTime, 5);
  if (!title || !date || !isValidISODate(date) || !startTime || !isValidTime(startTime)) return null;
  return {
    title,
    date,
    startTime,
    endTime: endTime && isValidTime(endTime) && timeToMinutes(endTime) > timeToMinutes(startTime) ? endTime : null,
    category: asString(raw.category, 40) || 'personal',
    note: asString(raw.note, 1000) ?? '',
    important: raw.important === true,
  };
}

function sanitizePlanHabit(value: unknown): HabitInput | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = asString(raw.name, 60)?.trim();
  if (!name) return null;
  return {
    name,
    icon: asString(raw.icon, 20) || 'leaf',
    accent: ACCENT_SET.has(String(raw.accent)) ? (raw.accent as HabitInput['accent']) : categoryById(asString(raw.category, 40) || 'personal').accent,
    frequency: sanitizeFrequency(raw.frequency),
  };
}

function sanitizeAIPlans(value: unknown): SavedAIPlan[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const id = asString(raw.id, 80);
    const startDate = asString(raw.startDate, 10);
    const days = typeof raw.days === 'number' && Number.isFinite(raw.days) ? Math.round(raw.days) : 0;
    if (!id || !startDate || !isValidISODate(startDate) || days < 1 || seen.has(id)) return [];
    seen.add(id);
    const summary = asString(raw.summary, 400) ?? '';
    const prompt = asString(raw.prompt, 2400) ?? '';
    const createdAt = asString(raw.createdAt, 40) || new Date(0).toISOString();
    const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(sanitizePlanTask).filter((task): task is TaskInput => task !== null).slice(0, 40) : [];
    const events = Array.isArray(raw.events) ? raw.events.map(sanitizePlanEvent).filter((event): event is EventInput => event !== null).slice(0, 40) : [];
    const habits = Array.isArray(raw.habits) ? raw.habits.map(sanitizePlanHabit).filter((habit): habit is HabitInput => habit !== null).slice(0, 12) : [];
    const suggestions = Array.isArray(raw.suggestions)
      ? raw.suggestions.flatMap((entry) => { const text = asString(entry, 240)?.trim(); return text ? [text] : []; }).slice(0, 5)
      : [];
    const plan: SavedAIPlan = {
      id,
      title: asString(raw.title, 140)?.trim() || summary.slice(0, 60) || prompt.slice(0, 60),
      prompt,
      summary,
      startDate,
      days: Math.min(days, MAX_PLAN_DAYS),
      status: raw.status === 'added' ? 'added' : 'draft',
      source: raw.source === 'voice' ? 'voice' : 'typed',
      tasks,
      events,
      habits,
      suggestions,
      createdAt,
      updatedAt: asString(raw.updatedAt, 40) || createdAt,
    };
    return [plan];
  }).slice(0, AI_PLAN_LIMIT);
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
    repeat: REPEAT_SET.has(String(raw.repeat)) ? (raw.repeat as PlannerEvent['repeat']) : null,
    source: sanitizeEventSource(raw.source),
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
    unit: sanitizeUnit(raw.unit),
    reminderTime: typeof raw.reminderTime === 'string' && isValidTime(raw.reminderTime) ? raw.reminderTime : null,
  };
}

function sanitizeGoal(value: unknown): Goal | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const title = asString(raw.title, 140)?.trim();
  if (!id || !title) return null;
  const deadline = asString(raw.deadline, 10);
  const origin = (raw.fromSuggestion ?? null) as { linkId?: unknown; suggestionId?: unknown } | null;
  const originLink = origin ? asString(origin.linkId, 64) : null;
  const originId = origin ? asString(origin.suggestionId, 80) : null;
  const suggestedFrom = originLink && originId ? { linkId: originLink, suggestionId: originId } : null;
  const milestones = Array.isArray(raw.milestones)
    ? raw.milestones.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const step = item as Record<string, unknown>;
        const stepId = asString(step.id, 80);
        const stepTitle = asString(step.title, 140)?.trim();
        if (!stepId || !stepTitle) return [];
        const due = asString(step.dueDate, 10);
        return [{ id: stepId, title: stepTitle, completed: step.completed === true, dueDate: due && isValidISODate(due) ? due : null }];
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
    // Where the goal came from, when it came from a guardian — without it the
    // guardian's question goes unanswered.
    ...(suggestedFrom ? { fromSuggestion: suggestedFrom } : {}),
  };
}

function sanitizeAttachment(value: unknown): AttachmentRef | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 64);
  const name = asString(raw.name, 180)?.trim();
  if (!id || !name) return null;
  const size = Number(raw.size);
  return {
    id,
    name,
    mime: asString(raw.mime, 80) || 'application/octet-stream',
    size: Number.isFinite(size) && size >= 0 ? Math.round(size) : 0,
    addedAt: asString(raw.addedAt, 40) || new Date(0).toISOString(),
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
    title: title || t("Untitled note"),
    body,
    kind: KIND_SET.has(kind) ? (kind as Note['kind']) : 'quick',
    date: date && isValidISODate(date) ? date : null,
    pinned: raw.pinned === true,
    createdAt: asString(raw.createdAt, 40) || new Date(0).toISOString(),
    updatedAt: asString(raw.updatedAt, 40) || new Date(0).toISOString(),
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map(sanitizeAttachment).filter((item): item is AttachmentRef => item !== null)
      : undefined,
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
  const aiMemory = sanitizeAIMemory(source.aiMemory);
  const aiDeclined = sanitizeAIDeclined(source.aiDeclined);
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
        const rawValue = typeof rawItem.value === 'number' && Number.isFinite(rawItem.value) ? Math.round(rawItem.value) : null;
        const entry: HabitCompletion = { habitId, date };
        if (rawValue !== null && rawValue >= 0 && rawValue <= 999) entry.value = rawValue;
        if (rawItem.skipped === true) entry.skipped = true;
        return [entry];
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
  const moodSeen = new Set<string>();
  const moods = (Array.isArray(source.moods) ? source.moods : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const rawItem = item as Record<string, unknown>;
    const date = asString(rawItem.date, 10);
    const value = typeof rawItem.value === 'number' ? Math.round(rawItem.value) : 0;
    if (!date || !isValidISODate(date) || value < 1 || value > 5 || moodSeen.has(date)) return [];
    moodSeen.add(date);
    const entry: MoodEntry = { date, value: value as MoodValue, updatedAt: asString(rawItem.updatedAt, 40) || new Date(0).toISOString() };
    if (typeof rawItem.taskId === 'string' && rawItem.taskId.length <= 80) entry.taskId = rawItem.taskId;
    return [entry];
  });
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
    aiMemory,
    aiDeclined,
    aiPlans: sanitizeAIPlans(source.aiPlans),
    habits,
    completions,
    goals,
    notes,
    moods,
    intentions,
    focusLog: sanitizeFocusLog(source.focusLog),
    archives: sanitizeArchives(source.archives),
    panels: sanitizePanels(source.panels),
  };
}

/**
 * Week archives, read back defensively.
 *
 * An archive is a small number of numbers, and a corrupted one should cost the
 * week it describes — not the whole planner. Anything that is not a shape this
 * app wrote is dropped rather than repaired.
 */
function sanitizeArchives(value: unknown): WeekArchive[] {
  if (!Array.isArray(value)) return [];
  const number = (input: unknown, max = 1_000_000) =>
    typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(0, Math.round(input))) : 0;
  const seen = new Set<string>();
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const raw = entry as Record<string, unknown>;
      const weekStart = asString(raw.weekStart, 10);
      if (!weekStart || !isValidISODate(weekStart) || seen.has(weekStart)) return [];
      seen.add(weekStart);
      const days = (Array.isArray(raw.days) ? raw.days : []).flatMap((day) => {
        if (!day || typeof day !== 'object') return [];
        const item = day as Record<string, unknown>;
        const date = asString(item.date, 10);
        if (!date || !isValidISODate(date)) return [];
        const ratio = typeof item.ratio === 'number' && Number.isFinite(item.ratio) ? Math.min(1, Math.max(0, item.ratio)) : null;
        const mood = typeof item.mood === 'number' && item.mood >= 1 && item.mood <= 5 ? Math.round(item.mood) : null;
        return [{
          date,
          ratio,
          mood,
          plannedMinutes: number(item.plannedMinutes, 100_000),
          focusMinutes: number(item.focusMinutes, 100_000),
        }];
      }).slice(0, 7);
      const habits = (Array.isArray(raw.habits) ? raw.habits : []).flatMap((habit) => {
        if (!habit || typeof habit !== 'object') return [];
        const item = habit as Record<string, unknown>;
        const habitId = asString(item.habitId, 80);
        const name = asString(item.name, 60)?.trim();
        if (!habitId || !name) return [];
        return [{
          habitId,
          name,
          done: number(item.done, 1000),
          target: number(item.target, 1000),
          streakEnd: number(item.streakEnd, 1000),
        }];
      }).slice(0, 40);
      const goals = (Array.isArray(raw.goals) ? raw.goals : []).flatMap((goal) => {
        if (!goal || typeof goal !== 'object') return [];
        const item = goal as Record<string, unknown>;
        const goalId = asString(item.goalId, 80);
        const title = asString(item.title, 140)?.trim();
        if (!goalId || !title) return [];
        return [{
          goalId,
          title,
          milestoneDone: number(item.milestoneDone, 1000),
          milestoneTotal: number(item.milestoneTotal, 1000),
        }];
      }).slice(0, 40);
      const moodAverage =
        typeof raw.moodAverage === 'number' && Number.isFinite(raw.moodAverage)
          ? Math.min(5, Math.max(1, Math.round(raw.moodAverage * 10) / 10))
          : null;
      return [{
        weekStart,
        days,
        tasksDone: number(raw.tasksDone, 10_000),
        tasksTotal: number(raw.tasksTotal, 10_000),
        eventsDone: number(raw.eventsDone, 10_000),
        eventsTotal: number(raw.eventsTotal, 10_000),
        habits,
        focusMinutes: number(raw.focusMinutes, 1_000_000),
        focusSessions: number(raw.focusSessions, 10_000),
        moodAverage,
        goals,
      }];
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-520); // ten years of weeks; beyond that something is wrong, not old
}

const PANEL_EXPLANATION_LIMIT = 200;
const PANEL_SUBJECT_LIMIT = 40;
const PANEL_LINK_LIMIT = 20;
/** Suggested goals kept per link: a handful is a conversation, a list is a chore. */
const PANEL_GOAL_LIMIT = 5;

function sanitizeSubject(value: unknown): StudentSubject | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const name = asString(raw.name, 60)?.trim();
  if (!id || !name) return null;
  const examDate = asString(raw.examDate, 10);
  const target = typeof raw.targetMinutes === 'number' && Number.isFinite(raw.targetMinutes) ? Math.round(raw.targetMinutes) : null;
  return {
    id,
    name,
    accent: ACCENT_SET.has(String(raw.accent)) ? String(raw.accent) : 'sage',
    examDate: examDate && isValidISODate(examDate) ? examDate : null,
    targetMinutes: target === null ? null : Math.min(6_000, Math.max(0, target)),
  };
}

function sanitizeChangeNote(value: unknown): ChangeNote | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const summary = asString(raw.summary, 140)?.trim();
  const weekOf = asString(raw.weekOf, 10);
  if (!id || !summary || !weekOf || !isValidISODate(weekOf)) return null;
  return {
    id,
    createdAt: asString(raw.createdAt, 40) || new Date(0).toISOString(),
    weekOf,
    summary,
    reason: (asString(raw.reason, 400) ?? '').trim(),
  };
}

function sanitizeWeekResults(value: unknown): WeekResults | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const weekOf = asString(raw.weekOf, 10);
  if (!weekOf || !isValidISODate(weekOf)) return null;
  const number = (input: unknown, max: number) => (typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(0, Math.round(input))) : 0);
  return {
    weekOf,
    planned: number(raw.planned, 10_000),
    done: number(raw.done, 10_000),
    focusMinutes: number(raw.focusMinutes, 100_000),
    subjects: (Array.isArray(raw.subjects) ? raw.subjects : []).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      const name = asString(item.name, 40)?.trim();
      if (!name) return [];
      return [{ name, minutes: Math.max(0, Math.round(Number(item.minutes) || 0)) }];
    }).slice(0, 4),
    headline: (asString(raw.headline, 160) ?? '').trim() || null,
    updatedAt: asString(raw.updatedAt, 40) || new Date(0).toISOString(),
  };
}

/** How many weeks of results a guardian keeps: enough to see a trend, no more. */
const WEEKS_KEPT = 12;

function sanitizeGuardianNotice(value: unknown): GuardianNotice | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const student = asString(raw.student, 40)?.trim().toLowerCase();
  if (!id || !student) return null;
  return {
    id,
    student,
    author: (asString(raw.author, 60) ?? '').trim() || t('A guardian'),
    summary: (asString(raw.summary, 160) ?? '').trim(),
    weekOf: asString(raw.weekOf, 10) ?? '',
    createdAt: asString(raw.createdAt, 40) ?? new Date(0).toISOString(),
    read: raw.read === true,
    kind: raw.kind === 'praise' ? 'praise' : 'note',
  };
}

function sanitizePlanItem(value: unknown): PlanItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const title = asString(raw.title, 120)?.trim();
  if (!id || !title) return null;
  const minutes = typeof raw.minutes === 'number' && Number.isFinite(raw.minutes) ? Math.max(0, Math.round(raw.minutes)) : null;
  return {
    id,
    title,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date ?? '')) ? String(raw.date) : null,
    minutes,
    subject: asString(raw.subject, 60)?.trim() || null,
    done: raw.done === true,
  };
}

function sanitizeGuardianPlan(value: unknown): GuardianPlan | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const cadence = raw.cadence === 'day' || raw.cadence === 'week' || raw.cadence === 'month' ? (raw.cadence as PlanCadence) : null;
  const start = asString(raw.start, 10) ?? '';
  if (!id || !cadence || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  return {
    id,
    author: (asString(raw.author, 60) ?? '').trim() || t('A guardian'),
    linkId: asString(raw.linkId, 64) ?? '',
    cadence,
    start,
    title: (asString(raw.title, 120) ?? '').trim() || t('Plan'),
    note: (asString(raw.note, 400) ?? '').trim(),
    items: uniqueBy(
      (Array.isArray(raw.items) ? raw.items : []).flatMap((item) => {
        const planItem = sanitizePlanItem(item);
        return planItem ? [planItem] : [];
      }),
      (item) => item.id,
    ).slice(0, 60),
    createdAt: asString(raw.createdAt, 40) ?? new Date(0).toISOString(),
    updatedAt: asString(raw.updatedAt, 40) ?? new Date(0).toISOString(),
  };
}

/** Kept as words only: a suggestion is a sentence until the student says yes. */
function sanitizeGoalSuggestion(value: unknown): GoalSuggestion | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const title = asString(raw.title, 120)?.trim();
  if (!id || !title) return null;
  const target = asString(raw.target, 10);
  return {
    id,
    author: (asString(raw.author, 60) ?? '').trim(),
    linkId: asString(raw.linkId, 64) ?? '',
    title,
    note: (asString(raw.note, 400) ?? '').trim(),
    target: target && /^\d{4}-\d{2}-\d{2}$/.test(target) ? target : null,
    steps: (Array.isArray(raw.steps) ? raw.steps : [])
      .flatMap((step) => {
        const text = asString(step, 140)?.trim();
        return text ? [text] : [];
      })
      .slice(0, GOAL_STEPS_MAX),
    createdAt: asString(raw.createdAt, 40) ?? new Date(0).toISOString(),
  };
}

function sanitizeGoalAnswer(value: unknown): GoalAnswer | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const suggestionId = asString(raw.suggestionId, 80);
  if (!suggestionId) return null;
  if (raw.state !== 'accepted' && raw.state !== 'declined') return null;
  const total = typeof raw.total === 'number' && Number.isFinite(raw.total) ? Math.max(0, Math.min(GOAL_STEPS_MAX, Math.round(raw.total))) : 0;
  const done = typeof raw.done === 'number' && Number.isFinite(raw.done) ? Math.max(0, Math.min(total, Math.round(raw.done))) : 0;
  return {
    suggestionId,
    state: raw.state,
    done,
    total,
    updatedAt: asString(raw.updatedAt, 40) ?? new Date(0).toISOString(),
  };
}

function sanitizeStudentInbox(value: unknown): StudentInbox {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const notices = uniqueBy(
    (Array.isArray(raw.notices) ? raw.notices : []).flatMap((item) => {
      const notice = sanitizeGuardianNotice(item);
      return notice ? [notice] : [];
    }),
    (item) => item.id,
  )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
  const plans = uniqueBy(
    (Array.isArray(raw.plans) ? raw.plans : []).flatMap((item) => {
      const plan = sanitizeGuardianPlan(item);
      return plan ? [plan] : [];
    }),
    (item) => item.id,
  )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
  const goals = uniqueBy(
    (Array.isArray(raw.goals) ? raw.goals : []).flatMap((item) => {
      const goal = sanitizeGoalSuggestion(item);
      return goal ? [goal] : [];
    }),
    (item) => item.id,
  )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, PANEL_GOAL_LIMIT);
  return { notices, plans, goals };
}

function sanitizeGuardianLink(value: unknown): GuardianLink | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id, 80);
  const username = asString(raw.username, 40)?.trim().toLowerCase();
  if (!id || !username) return null;
  const linkId = asString(raw.linkId, 64);
  return {
    id,
    username,
    displayName: (asString(raw.displayName, 60) ?? '').trim() || username,
    status: raw.status === 'linked' ? 'linked' : 'pending',
    history: (Array.isArray(raw.history) ? raw.history : [])
      .flatMap((week) => {
        const result = sanitizeWeekResults(week);
        return result ? [result] : [];
      })
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf))
      .slice(0, WEEKS_KEPT),
    linkId: linkId && /^[a-f0-9-]{8,64}$/.test(linkId) ? linkId : null,
    code: asString(raw.code, 40),
    wrappedShareKey: isBase64(raw.wrappedShareKey, 44, 512) ? String(raw.wrappedShareKey) : null,
    results: sanitizeWeekResults(raw.results),
    plans: uniqueBy(
      (Array.isArray(raw.plans) ? raw.plans : []).flatMap((item) => {
        const plan = sanitizeGuardianPlan(item);
        return plan ? [plan] : [];
      }),
      (item) => item.id,
    )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10),
    goals: uniqueBy(
      (Array.isArray(raw.goals) ? raw.goals : []).flatMap((item) => {
        const goal = sanitizeGoalSuggestion(item);
        return goal ? [goal] : [];
      }),
      (item) => item.id,
    )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, PANEL_GOAL_LIMIT),
    goalAnswers: uniqueBy(
      (Array.isArray(raw.goalAnswers) ? raw.goalAnswers : []).flatMap((item) => {
        const answer = sanitizeGoalAnswer(item);
        return answer ? [answer] : [];
      }),
      (item) => item.suggestionId,
    ).slice(0, PANEL_GOAL_LIMIT * 2),
  };
}

function sanitizeStudentGuardian(value: unknown): StudentGuardian | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const linkId = asString(raw.linkId, 64);
  const guardianUsername = asString(raw.guardianUsername, 40)?.trim().toLowerCase();
  if (!linkId || !guardianUsername) return null;
  if (!/^[a-f0-9-]{8,64}$/.test(linkId)) return null;
  const wrapped = raw.wrappedShareKey;
  return {
    linkId,
    guardianUsername,
    guardianDisplayName: (asString(raw.guardianDisplayName, 60) ?? '').trim() || guardianUsername,
    wrappedShareKey: isBase64(wrapped, 44, 512) ? String(wrapped) : '',
    sharedWeek: asString(raw.sharedWeek, 10),
  };
}

/** Panels are opt-in and additive: turning one off never touches the planner itself. */
export function sanitizePanels(value: unknown): Panels {
  const empty = createEmptyPanels();
  if (!value || typeof value !== 'object') return empty;
  const raw = value as Record<string, unknown>;
  const student = (raw.student ?? {}) as Record<string, unknown>;
  const guardian = (raw.guardian ?? {}) as Record<string, unknown>;
  const subjects = uniqueBy(
    (Array.isArray(student.subjects) ? student.subjects : []).flatMap((item) => {
      const subject = sanitizeSubject(item);
      return subject ? [subject] : [];
    }),
    (item) => item.id,
  ).slice(0, PANEL_SUBJECT_LIMIT);
  const explanations = uniqueBy(
    (Array.isArray(student.explanations) ? student.explanations : []).flatMap((item) => {
      const note = sanitizeChangeNote(item);
      return note ? [note] : [];
    }),
    (item) => item.id,
  )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, PANEL_EXPLANATION_LIMIT);
  const links = uniqueBy(
    (Array.isArray(guardian.links) ? guardian.links : []).flatMap((item) => {
      const link = sanitizeGuardianLink(item);
      return link ? [link] : [];
    }),
    (item) => item.id,
  ).slice(0, PANEL_LINK_LIMIT);
  const kind = guardian.kind === 'advisor' || guardian.kind === 'parent' ? (guardian.kind as GuardianKind) : null;
  const field = (value: unknown) => {
    const text = asString(value, 60)?.trim();
    return text ? text : null;
  };
  const grade = isGradeLevel(student.grade) ? student.grade : null;
  const guardians = uniqueBy(
    (Array.isArray(student.guardians) ? student.guardians : []).flatMap((item) => {
      const guardian = sanitizeStudentGuardian(item);
      return guardian && guardian.wrappedShareKey ? [guardian] : [];
    }),
    (item) => item.linkId,
  ).slice(0, 20);
  const notices = uniqueBy(
    (Array.isArray(guardian.notices) ? guardian.notices : []).flatMap((item) => {
      const notice = sanitizeGuardianNotice(item);
      return notice ? [notice] : [];
    }),
    (item) => item.id,
  )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);

  return {
    student: {
      enabled: student.enabled === true,
      field: field(student.field),
      grade,
      guardians,
      subjects,
      explanations,
      inbox: sanitizeStudentInbox(student.inbox),
      goalAnswers: uniqueBy(
        (Array.isArray(student.goalAnswers) ? student.goalAnswers : []).flatMap((item) => {
          const answer = sanitizeGoalAnswer(item);
          return answer ? [answer] : [];
        }),
        (item) => item.suggestionId,
      ).slice(0, PANEL_GOAL_LIMIT * 2),
      praise: uniqueBy(
        (Array.isArray(student.praise) ? student.praise : []).flatMap((item) => {
          const notice = sanitizeGuardianNotice(item);
          return notice && notice.kind === 'praise' ? [notice] : [];
        }),
        (item) => item.id,
      )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, PRAISE_KEPT),
    },
    guardian: { enabled: guardian.enabled === true && kind !== null, kind, field: field(guardian.field), links, notices },
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
    if (name === 'QuotaExceededError') return storageFullMessage();
    return t("That change could not be saved in this browser.");
  }
}

export function downloadState(state: PlannerState, date: string): void {
  downloadBlob(new Blob([serialize(state)], { type: 'application/json' }), `planner-${date}.json`);
}
