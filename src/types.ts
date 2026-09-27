import type { Accent, HabitIconId, ItemType, NoteKind, Priority } from './constants';

export type GoalHorizon = 'short' | 'long';

export type HabitFrequency =
  | { type: 'daily' }
  | { type: 'weekdays' }
  | { type: 'custom'; days: number[] }
  | { type: 'weekly'; times: number };

export type TaskRepeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  category: string;
  note: string;
  goalId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Repeat rule. Completing a repeating task schedules the next occurrence. */
  repeat: TaskRepeat | null;
  subtasks: Subtask[];
  /** Set when the task was completed; used by insights. */
  completedAt?: string | null;
  /** If set, this is waiting on someone/something and is not treated as overdue. */
  waiting: string | null;
}

export interface FocusLog {
  id: string;
  taskId: string | null;
  title: string;
  minutes: number;
  date: string;
  endedAt: string;
}

/** A user-written fact or preference that the AI may use when planning. */
export type AIMemoryCategory = 'preference' | 'person' | 'routine' | 'boundary' | 'context';

export interface AIMemory {
  id: string;
  text: string;
  category: AIMemoryCategory;
  createdAt: string;
  updatedAt: string;
}

export interface AIMemoryInput {
  text: string;
  category: AIMemoryCategory;
}

export interface PlannerEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string | null;
  category: string;
  note: string;
  important: boolean;
  completed: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  repeat: TaskRepeat | null;
  /** Present on read-only weekly occurrences generated from a protected time block. */
  fixedCommitmentId?: string;
  /** Present on read-only dates generated from a repeating event. */
  seriesEventId?: string;
}

export interface FixedCommitment {
  id: string;
  title: string;
  weekday: number;
  startTime: string;
  endTime: string;
  category: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface FixedCommitmentInput {
  title: string;
  weekday: number;
  startTime: string;
  endTime: string;
  category: string;
  note: string;
}

export interface Habit {
  id: string;
  name: string;
  icon: HabitIconId | string;
  accent: Accent;
  frequency: HabitFrequency;
  essential: boolean;
  archived: boolean;
  createdOn: string;
  createdAt: string;
  updatedAt: string;
}

export interface HabitCompletion {
  habitId: string;
  date: string;
}

export interface Milestone {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  horizon: GoalHorizon;
  deadline: string | null;
  milestones: Milestone[];
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  kind: NoteKind;
  date: string | null;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerState {
  tasks: Task[];
  events: PlannerEvent[];
  fixedCommitments: FixedCommitment[];
  /** Explicit, user-controlled context for the AI. */
  aiMemory: AIMemory[];
  habits: Habit[];
  completions: HabitCompletion[];
  goals: Goal[];
  notes: Note[];
  intentions: Record<string, string>;
  focusLog: FocusLog[];
}

export interface TaskInput {
  title: string;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  category: string;
  note: string;
  goalId: string | null;
  repeat?: TaskRepeat | null;
  subtasks?: Subtask[];
  waiting?: string | null;
}

export interface EventInput {
  title: string;
  date: string;
  startTime: string;
  endTime: string | null;
  category: string;
  note: string;
  important: boolean;
  repeat?: TaskRepeat | null;
}

export interface HabitInput {
  name: string;
  icon: string;
  accent: Accent;
  frequency: HabitFrequency;
  essential?: boolean;
}

export interface GoalInput {
  title: string;
  description: string;
  horizon: GoalHorizon;
  deadline: string | null;
  milestone: string;
  milestoneDue?: string | null;
}

export interface NoteInput {
  title: string;
  body: string;
  kind: NoteKind;
  date: string | null;
  pinned?: boolean;
}

export type ComposerState =
  | { mode: 'create'; type: ItemType; date?: string; horizon?: GoalHorizon }
  | { mode: 'edit'; type: ItemType; id: string };

export interface DayScore {
  tasksDone: number;
  tasksTotal: number;
  eventsDone: number;
  eventsTotal: number;
  habitsDone: number;
  habitsTotal: number;
  done: number;
  total: number;
  ratio: number | null;
}

export type DotState = 'done' | 'open' | 'future' | 'optional' | 'off';

export function createEmptyState(): PlannerState {
  return {
    tasks: [],
    events: [],
    fixedCommitments: [],
    aiMemory: [],
    habits: [],
    completions: [],
    goals: [],
    notes: [],
    intentions: {},
    focusLog: [],
  };
}
