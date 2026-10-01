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
  /** Planned effort in minutes; used by Plan my day, the board, and plan-vs-focus insights. */
  estimatedMinutes: number | null;
  /**
   * The next occurrence this task created when it was last completed.
   * Completing again replaces it; un-completing takes it back, so ticking a
   * repeating task on and off can never double the series up.
   */
  spawnedId?: string | null;
  /** Present on read-only dates generated from a repeating task (see logic.ts). */
  seriesTaskId?: string;
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
  /** Provenance for events imported from a subscribed calendar feed. */
  source?: { url: string; uid: string } | null;
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

/** Countable tracking for a habit, e.g. "8 glasses of water" or "2 km run". */
export interface HabitUnit {
  label: string;
  target: number;
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
  /** When set, a day counts as done once the recorded amount reaches the target. */
  unit: HabitUnit | null;
}

export interface HabitCompletion {
  habitId: string;
  date: string;
  /** Amount recorded for unit-based habits. Absent on older binary check-ins. */
  value?: number;
  /** A deliberate rest day: neutral — never breaks and never extends a streak. */
  skipped?: boolean;
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
  /** Files attached to this note; the bytes live in IndexedDB under file:<id>. */
  attachments?: AttachmentRef[];
}

/** A file uploaded into the app and stored locally in IndexedDB. */
export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  addedAt: string;
}

/** Where a saved AI plan came from. */
export type AIPlanSource = 'typed' | 'voice';

/** How many drafted plans the Plans page keeps; the oldest falls off. */
export const AI_PLAN_LIMIT = 30;

/** Lifecycle of a saved AI plan: drafted, then (optionally) added to the planner. */
export type AIPlanStatus = 'draft' | 'added';

/**
 * One AI-drafted plan kept on the Plans page. Draft items use the same input
 * shapes as the AI draft review card; ids are only assigned when it's added.
 */
export interface SavedAIPlan {
  id: string;
  /** Short, human label — the request in brief or "Voice plan". */
  title: string;
  /** What the user asked for ('' when the plan came from a picture or voice). */
  prompt: string;
  /** The AI's own overview of the draft. */
  summary: string;
  startDate: string;
  days: number;
  status: AIPlanStatus;
  source: AIPlanSource;
  tasks: TaskInput[];
  events: EventInput[];
  habits: HabitInput[];
  suggestions: string[];
  createdAt: string;
  updatedAt: string;
}

export type SavedAIPlanInput = Omit<SavedAIPlan, 'id' | 'status' | 'createdAt' | 'updatedAt'>;

export type MoodValue = 1 | 2 | 3 | 4 | 5;

/** One mood check-in per day (the latest wins). */
export interface MoodEntry {
  date: string;
  value: MoodValue;
  /** Optional link to the task that prompted the check-in. */
  taskId?: string;
  updatedAt: string;
}

/**
 * The two optional panels. Neither one replaces the personal planner: someone
 * may run the personal panel alone, add the student panel, add the guardian
 * panel, or both, and can turn a panel off again without losing the planner.
 */
export interface Panels {
  student: StudentPanel;
  guardian: GuardianPanel;
}

export interface StudentPanel {
  enabled: boolean;
  /** What they study — required the moment the panel is switched on. */
  field: string | null;
  /** Where they are in it: see GRADE_LEVELS. */
  grade: string | null;
  /** Guardians this student shares weekly results with. */
  guardians: StudentGuardian[];
  /** Subjects the student tracks, with an optional exam date. */
  subjects: StudentSubject[];
  /** Why the student changed something significant. Detail kept for the active week only. */
  explanations: ChangeNote[];
  /** What guardians sent: short notices and day/week/month plans. */
  inbox: StudentInbox;
}

/** Curated so a guardian can read it at a glance; 'other' keeps everyone included. */
export const GRADE_LEVELS = [
  'school-9',
  'school-10',
  'school-11',
  'school-12',
  'university',
  'postgrad',
  'other',
] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

export function isGradeLevel(value: unknown): value is GradeLevel {
  return typeof value === 'string' && (GRADE_LEVELS as readonly string[]).includes(value);
}

/** "Your advisor changed the plan for this week" — in-panel, never email. */
export interface GuardianNotice {
  id: string;
  /** The student it concerns, by username. */
  student: string;
  /** Who changed it. */
  author: string;
  /** What they said, in their own words. */
  summary: string;
  weekOf: string;
  createdAt: string;
  read: boolean;
}

export interface GuardianPanel {
  enabled: boolean;
  kind: GuardianKind | null;
  /** What they guide — required the moment the panel is switched on. */
  field: string | null;
  /** Students this guardian watches. Only weekly results travel, never detail. */
  links: GuardianLink[];
  /** What the other guardians of those students changed, newest first. */
  notices: GuardianNotice[];
}

/** A guardian this student accepted. The key for their results lives in the vault. */
export interface StudentGuardian {
  linkId: string;
  guardianUsername: string;
  guardianDisplayName: string;
  /** base64 — the results key, wrapped by this vault's key. */
  wrappedShareKey: string;
  /** Week these results were last sent for. */
  sharedWeek: string | null;
}

export type GuardianKind = 'advisor' | 'parent';

export interface StudentSubject {
  id: string;
  name: string;
  accent: string;
  examDate: string | null;
  /** Target study time per week, in minutes. */
  targetMinutes: number | null;
}

/** A short explanation the student writes for a significant change. */
export interface ChangeNote {
  id: string;
  createdAt: string;
  /** Monday of the week this belongs to. */
  weekOf: string;
  summary: string;
  reason: string;
}

/** How far a plan stretches: one day, one week, or one month. */
export type PlanCadence = 'day' | 'week' | 'month';

/** One step in a guardian's plan. The student ticks these off. */
export interface PlanItem {
  id: string;
  title: string;
  /** Day within the plan this is for (ISO), or null when it fits anywhere. */
  date: string | null;
  /** Suggested time, in minutes. */
  minutes: number | null;
  /** Subject name, when the guardian tied it to one. */
  subject: string | null;
  done: boolean;
}

/**
 * A plan a guardian makes for their student — a day, a week, or a month of it.
 * It travels over the same encrypted link as everything else; the server only
 * ever sees ciphertext. The student sees it in their panel and ticks items off,
 * and the ticks travel back so the guardian can track how it is going.
 */
export interface GuardianPlan {
  id: string;
  /** Who wrote it, so the student knows which guardian sent it. */
  author: string;
  /** The link it travels on — the return address for the student's ticks. */
  linkId: string;
  cadence: PlanCadence;
  /** First day the plan covers (ISO): today, Monday of the week, or the 1st. */
  start: string;
  title: string;
  note: string;
  items: PlanItem[];
  createdAt: string;
  updatedAt: string;
}

/** What a guardian has sent this student: brief notices and full plans. */
export interface StudentInbox {
  /** Newest first. */
  notices: GuardianNotice[];
  /** Active plans, newest first. */
  plans: GuardianPlan[];
}

/** One week of results: all a guardian ever sees of a student's planner. */
/** Minutes per subject, most-focused first. Counts only — never task titles. */
export interface WeekSubjectMinutes {
  name: string;
  minutes: number;
}

export interface WeekResults {
  weekOf: string;
  planned: number;
  done: number;
  focusMinutes: number;
  /** Where the focused time went, top four subjects. */
  subjects: WeekSubjectMinutes[];
  /** The student's own words about the week, if they wrote any. */
  headline: string | null;
  updatedAt: string;
}

export interface GuardianLink {
  id: string;
  username: string;
  displayName: string;
  status: 'pending' | 'linked';
  /** The last weeks of results, newest first. Capped: nothing accumulates. */
  history: WeekResults[];
  /** The server's id for this request, once it exists. */
  linkId: string | null;
  /** The pairing code to hand to the student. Gone from here once accepted. */
  code: string | null;
  /** base64 — the results key, wrapped by this vault's key. */
  wrappedShareKey: string | null;
  /** Latest weekly results. Replaced every week — never accumulated. */
  results: WeekResults | null;
  /** Plans sent to this student, newest first. Ticks come back and land on items. */
  plans: GuardianPlan[];
}

export interface PlannerState {
  tasks: Task[];
  events: PlannerEvent[];
  fixedCommitments: FixedCommitment[];
  /** Explicit, user-controlled context for the AI. */
  aiMemory: AIMemory[];
  /** AI-drafted plans waiting on the Plans page. */
  aiPlans: SavedAIPlan[];
  habits: Habit[];
  completions: HabitCompletion[];
  goals: Goal[];
  notes: Note[];
  moods: MoodEntry[];
  intentions: Record<string, string>;
  focusLog: FocusLog[];
  panels: Panels;
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
  estimatedMinutes?: number | null;
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
  source?: { url: string; uid: string } | null;
}

export interface HabitInput {
  name: string;
  icon: string;
  accent: Accent;
  frequency: HabitFrequency;
  essential?: boolean;
  unit?: HabitUnit | null;
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
  attachments?: AttachmentRef[];
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

export type DotState = 'done' | 'open' | 'future' | 'optional' | 'skipped' | 'off';

export function createEmptyState(): PlannerState {
  return {
    tasks: [],
    events: [],
    fixedCommitments: [],
    aiMemory: [],
    aiPlans: [],
    habits: [],
    completions: [],
    goals: [],
    notes: [],
    intentions: {},
    moods: [],
    focusLog: [],
    panels: createEmptyPanels(),
  };
}

export function createEmptyPanels(): Panels {
  return {
    student: {
      enabled: false,
      field: null,
      grade: null,
      guardians: [],
      subjects: [],
      explanations: [],
      inbox: { notices: [], plans: [] },
    },
    guardian: { enabled: false, kind: null, field: null, links: [], notices: [] },
  };
}
