import type { Accent, HabitIconId, ItemType, NoteKind, Priority } from './constants';

export type GoalHorizon = 'short' | 'long';

export type HabitFrequency =
  | { type: 'daily' }
  | { type: 'weekdays' }
  | { type: 'custom'; days: number[] }
  | { type: 'weekly'; times: number };

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
  /** Present on read-only weekly occurrences generated from a protected time block. */
  fixedCommitmentId?: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface PlannerState {
  tasks: Task[];
  events: PlannerEvent[];
  fixedCommitments: FixedCommitment[];
  habits: Habit[];
  completions: HabitCompletion[];
  goals: Goal[];
  notes: Note[];
  intentions: Record<string, string>;
}

export interface TaskInput {
  title: string;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  category: string;
  note: string;
  goalId: string | null;
}

export interface EventInput {
  title: string;
  date: string;
  startTime: string;
  endTime: string | null;
  category: string;
  note: string;
  important: boolean;
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
}

export interface NoteInput {
  title: string;
  body: string;
  kind: NoteKind;
  date: string | null;
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
    habits: [],
    completions: [],
    goals: [],
    notes: [],
    intentions: {},
  };
}
