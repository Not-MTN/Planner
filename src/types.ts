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

export type AIDeclinedKind = 'task' | 'event' | 'habit';

/**
 * A suggestion the AI made and the user did not keep.
 *
 * Kept so the same thing is not proposed again and again — but kept visibly:
 * these are listed in Memory where they can be read and forgotten one by one.
 * A preference learned silently and then acted on invisibly is not a
 * preference, it is a guess the user cannot correct.
 */
export interface AIDeclined {
  id: string;
  title: string;
  kind: AIDeclinedKind;
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
  /** Optional local time for a daily nudge on days when this habit is due. */
  reminderTime?: string | null;
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
  /**
   * Set when this goal arrived from a guardian and the student took it on, so
   * the guardian can be told how far it has got — and only how far, never the
   * words of the steps they wrote.
   */
  fromSuggestion?: { linkId: string; suggestionId: string } | null;
}

/**
 * A goal a guardian would like their student to take on.
 *
 * It travels as words and nothing else. Nothing appears in the student's
 * planner until they agree; a suggestion that is refused stays a sentence that
 * was once offered, and can be taken back.
 */
export interface GoalSuggestion {
  id: string;
  /** Who is asking, so the student knows who they are answering. */
  author: string;
  /** The link it travels on — the return address for the answer. */
  linkId: string;
  title: string;
  /** Why they are asking, in their own words. */
  note: string;
  /** A date to aim at, when there is one. */
  target: string | null;
  /** Steps in the order they should happen. Words until accepted. */
  steps: string[];
  createdAt: string;
}

/**
 * How a student answered a suggested goal, and how far they have got with it.
 * Counts travel back — not the steps, and not the title: a goal the student
 * made their own is theirs, and this is only a progress light.
 */
/** The most steps one goal can be broken into. More than this is a project. */
export const GOAL_STEPS_MAX = 6;
/** Suggestions kept per link, and answers remembered: a handful, not a ledger. */
export const PANEL_GOALS_KEPT = 5;
export const GOAL_ANSWERS_KEPT = 20;

export interface GoalAnswer {
  suggestionId: string;
  state: 'accepted' | 'declined';
  /** Steps finished, and how many there are. */
  done: number;
  total: number;
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

/**
 * How many declined suggestions are remembered, and for how long.
 *
 * Bounded on purpose: this is meant to stop an idea being proposed twice, not
 * to build a permanent file on the user. Forgetting is the fallback — a
 * preference held for six months without being revisited is a preference the
 * user never really had.
 */
export const AI_DECLINED_LIMIT = 40;
export const AI_DECLINED_MAX_AGE_DAYS = 180;

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
  /** Plans the student has deleted, so an active guardian's next sync won't restore them. */
  deletedPlanIds?: string[];
  /** Subjects the student tracks, with an optional exam date. */
  subjects: StudentSubject[];
  /** Why the student changed something significant. Detail kept for the active week only. */
  explanations: ChangeNote[];
  /** What guardians sent: short notices and day/week/month plans. */
  inbox: StudentInbox;
  /** Daily reports this student sent back, newest first. */
  reports?: DayReport[];
  /** Guardians' answers to daily reports, newest first. */
  acks?: ReportAck[];
  /** Student progress for classes assigned over a guardian link. */
  classProgress?: ClassProgress[];
  /** Homework submissions, newest first; approved submissions keep no images. */
  homeworkSubmissions?: HomeworkSubmission[];
  /** Open asks for a week plan, newest first. */
  requests?: PlanRequest[];
  /** Changes this student asked for on a plan, newest first — with the answers. */
  changeRequests?: PlanChangeRequest[];
  /** The chat threads with their guardians, oldest first. */
  chat?: ChatMessage[];
  /** How far each thread has been read, by link, so the count goes quiet. */
  chatSeen?: Record<string, string>;
  /** Exams this student sat, newest first. */
  examSubmissions?: ExamSubmission[];
  /**
   * Exams in progress, by exam id. Persisted (not just component state) so a
   * reload, a killed tab or a sleeping phone cannot reset the clock or the
   * answers the guardian's time limit is protecting.
   */
  examDrafts?: Record<string, StudentExamDraft>;
  /**
   * Kind words, kept. Praise is the one thing worth re-reading, so it does not
   * fall out of the inbox when more notes arrive.
   */
  praise: GuardianNotice[];
  /**
   * How each suggested goal was answered. Kept here rather than in the planner
   * because a goal that was refused is not the student's to carry, and a goal
   * that was accepted and later dropped should not look unanswered.
   */
  goalAnswers?: GoalAnswer[];
}

/** Curated so a guardian can read it at a glance; 'other' keeps everyone included. */
/**
 * Where a student is.
 *
 * 'konkur' is not a year of school: it is the entrance-exam year, when a
 * twelfth-year student — or one who has finished — is studying for کنکور
 * instead. It gets its own entry because it plans differently: the built-in
 * lessons for it span three years (see `curriculum.ts`).
 */
export const GRADE_LEVELS = [
  'school-9',
  'school-10',
  'school-11',
  'school-12',
  'konkur',
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
  /**
   * Praise, rather than something to act on. Kept apart because the two are
   * read at different times: a note on a Sunday, kind words on a bad Thursday.
   */
  kind?: 'note' | 'praise' | 'request' | 'nudge';
}

/** Praise worth keeping: a note for a bad week, not a task for a good one. */
export const PRAISE_KEPT = 20;

export interface GuardianPanel {
  enabled: boolean;
  kind: GuardianKind | null;
  /** What they guide — required the moment the panel is switched on. */
  field: string | null;
  /** Students this guardian watches. Only weekly results travel, never detail. */
  links: GuardianLink[];
  /** What the other guardians of those students changed, newest first. */
  notices: GuardianNotice[];
  /** Plans that could not be sent yet — the wire picks them up when it can. */
  queuedPlans?: QueuedPlan[];
  /** The chat threads with their students, oldest first. */
  chat?: ChatMessage[];
  /** How far each thread has been read, by link, so the count goes quiet. */
  chatSeen?: Record<string, string>;
}

/** A plan waiting for a signal: the whole draft, exactly as the guardian left it. */
export interface QueuedPlan {
  id: string;
  linkId: string;
  draft: PlanDraft;
  createdAt: string;
}

/** How many unsent plans a guardian can keep waiting. */
export const QUEUED_PLANS_KEPT = 10;

export interface PlanDraft {
  cadence: GuardianPlan['cadence'];
  /** First day the plan covers (ISO). */
  start: string;
  title: string;
  note: string;
  items: Array<Pick<PlanItem, 'title' | 'date' | 'time' | 'end' | 'minutes' | 'subject' | 'url'>>;
  /** Curriculum field id, when the week was planned from built-in lessons. */
  field?: string | null;
  /** Grade id the week was planned for. */
  grade?: string | null;
  /** Weekdays (0 = Sunday) that need no daily report. */
  restDays?: number[];
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
  /** Start time (HH:MM), or null when the lesson fits anywhere in the day. Week plans sort by it. */
  time?: string | null;
  /**
   * End time (HH:MM), so "maths from 9 to 11" is what the plan says rather
   * than a start nobody can measure. Null when the guardian gave a start only.
   */
  end?: string | null;
  /** Suggested time, in minutes. */
  minutes: number | null;
  /** Subject name, when the guardian tied it to one. */
  subject: string | null;
  /** One prep link per lesson — a video, a worksheet — or null when there is none. */
  url?: string | null;
  done: boolean;
}

/** A prep link fits in a tap and a sync — longer is almost certainly a paste gone wrong. */
export const LESSON_URL_MAX = 500;

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
  /** Curriculum field id when the week was planned from built-in lessons (see curriculum.ts). */
  field?: string | null;
  /** Grade id the week was planned for (see GRADE_LEVELS). */
  grade?: string | null;
  /** Weekdays (0 = Sunday) that need no daily report. Guardian-chosen rest days. */
  restDays?: number[];
  items: PlanItem[];
  /** A guardian's sign-off closes this period and hides item-level detail. */
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A student's report for one planned day: which lessons got done, in their own
 * words when they add any. It travels back over the same encrypted link as the
 * plan's ticks, so the guardian sees the day as the student lived it.
 */
export interface DayReport {
  id: string;
  /** The plan this day belongs to — the return address for the report. */
  planId: string;
  /** The link it travels on. */
  linkId: string;
  /** The reported day (ISO). */
  date: string;
  /** Plan item ids finished that day. */
  doneIds: string[];
  /** The student's own words about the day, when they wrote any. */
  note: string;
  /**
   * A streak repair: the week's one mulligan, filed instead of a report for a
   * day that got away. It counts as reported — the panel unlocks and the
   * streak survives — but reads as kept, not done, on both sides.
   */
  repair?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Daily reports kept on each side, and how many ride along in one outbox write. */
/** Ten week plans can hold seventy reportable days; retain them while a student catches up. */
export const DAY_REPORTS_KEPT = 70;
export const DAY_REPORTS_WIRE = 70;
/** A report note is a few sentences, not an essay. */
export const DAY_REPORT_NOTE_MAX = 280;

/**
 * A guardian's answer to one daily report: seen, with a line back when there
 * is something to say. It travels guardian to student, the way the report
 * came — reports stay immutable once sent, so the day as filed is never
 * rewritten, only acknowledged.
 */
export interface ReportAck {
  id: string;
  reportId: string;
  planId: string;
  linkId: string;
  date: string;
  /** The line back, or '' for a bare seen. */
  text: string;
  /** Quick emoji taps on the report — only ACK_REACTIONS can ever appear here. */
  reactions: string[];
  /** Set once by the guardian; approval cannot be taken back. */
  approvedAt?: string | null;
  createdAt: string;
}

/** The whole reaction vocabulary: offered as buttons, enforced on the wire. */
export const ACK_REACTIONS = ['🎉', '💪', '❤️'] as const;

/** One externally hosted lesson assigned to one student over one guardian link. */
export interface ClassAssignment {
  id: string;
  linkId: string;
  author: string;
  title: string;
  subject: string;
  description: string;
  /** A link to an existing video host; Planner never stores the video bytes. */
  videoUrl: string;
  createdAt: string;
}

/** A student's completion mark for one assigned class. */
export interface ClassProgress {
  classId: string;
  linkId: string;
  completedAt: string | null;
  updatedAt: string;
}

/** Guardian-authored homework. A deadline is optional. */
export interface HomeworkAssignment {
  id: string;
  linkId: string;
  author: string;
  title: string;
  instructions: string;
  subject: string;
  dueAt: string | null;
  createdAt: string;
}

/** Encrypted image bytes are hosted outside the planner database. */
export interface HomeworkPhoto {
  url: string;
  publicId: string;
  name: string;
  mime: string;
  bytes: number;
}

/** One immutable student submission; guardian approval removes every photo. */
export interface HomeworkSubmission {
  id: string;
  assignmentId: string;
  linkId: string;
  photos: HomeworkPhoto[];
  submittedAt: string;
  status: 'submitted' | 'approved';
  guardianNote: string;
  reviewedAt: string | null;
}

/** Guardian's signed decision sent back to the student. */
export interface HomeworkReview {
  id: string;
  assignmentId: string;
  submissionId: string;
  linkId: string;
  note: string;
  approvedAt: string;
}

export const HOMEWORK_PHOTOS_MAX = 3;
export const HOMEWORK_NOTE_MAX = 280;
export const HOMEWORK_ITEMS_KEPT = 30;

/**
 * A student asking for a week plan. Broadcast to every linked guardian; each
 * one reads it as a notice with the lesson planner one tap away. Open requests
 * ride the student outbox until the student cancels or they go stale.
 */
export interface PlanRequest {
  id: string;
  linkId: string;
  /** What the student asked for, in their own words. */
  note: string;
  createdAt: string;
}

/** Open requests kept per student, and how many ride one outbox write. */
export const PLAN_REQUESTS_KEPT = 5;
export const PLAN_REQUESTS_WIRE = 5;
/** An unanswered ask stops travelling after two weeks. */
export const PLAN_REQUEST_DAYS = 14;
/** A line back is a sentence, not a letter. */
export const ACK_TEXT_MAX = 140;

/** What the student is asking for: a lesson put in, or one taken off. */
export type PlanChangeKind = 'add' | 'remove';

/**
 * A student asking for one change to a plan that has already been sent.
 *
 * The plan belongs to the guardian, so this is a request and never an edit:
 * the student says what they would like on a day that has not gone by, and the
 * guardian approves it — which makes the change on both sides — or declines it
 * with a line back. It travels on the same encrypted link as the plan's ticks,
 * and the answer travels home on the guardian's.
 */
export interface PlanChangeRequest {
  id: string;
  /** The link it travels on. */
  linkId: string;
  /** The plan being changed. */
  planId: string;
  /** The day the change is for (ISO). Always today or later. */
  date: string | null;
  kind: PlanChangeKind;
  /** The lesson being asked for, or the one being asked to drop. */
  title: string;
  /** The lesson a removal points at, so an approval drops the right one. */
  itemId?: string | null;
  /** When the added lesson should run. Both null when it fits anywhere. */
  time?: string | null;
  end?: string | null;
  /** The student's reason, in their own words. */
  note: string;
  /** Open until a guardian answers; the answer lands on the same record. */
  state: 'open' | 'approved' | 'declined';
  /** What the guardian wrote back. */
  reply?: string;
  answeredAt?: string | null;
  createdAt: string;
}

/** Change requests kept on each side, and how many ride one outbox write. */
export const PLAN_CHANGES_KEPT = 12;
export const PLAN_CHANGES_WIRE = 12;
/** A reason for a change is a sentence, not a letter. */
export const PLAN_CHANGE_NOTE_MAX = 140;
/** A lesson name asked for is the same length as one the guardian types. */
export const PLAN_CHANGE_TITLE_MAX = 120;
/** An unanswered change request stops travelling after two weeks. */
export const PLAN_CHANGE_DAYS = 14;

/* ------------------------------------------------------------------- chat */

/**
 * One message between a guardian and one student.
 *
 * A notice is a one-way note that lands in an inbox and is read once. This is
 * the other thing: a thread, where either side can answer. It travels on the
 * same encrypted link as everything else, is capped on both sides so nothing
 * accumulates forever, and carries nothing but words.
 */
export interface ChatMessage {
  id: string;
  /** The link the thread belongs to. */
  linkId: string;
  /** Who wrote it, as the panel names them. */
  author: string;
  /** Which side of the link wrote it. */
  from: ChatSide;
  text: string;
  createdAt: string;
}

export type ChatSide = 'guardian' | 'student';

/** A message is a paragraph, not an essay. */
export const CHAT_TEXT_MAX = 600;
/** Messages kept on each side, and how many ride one outbox write. */
export const CHAT_KEPT = 80;
export const CHAT_WIRE = 40;

/* ------------------------------------------------------------------ exams */

/**
 * One question on an exam a guardian set.
 *
 * A question with options is marked on submission, against the option the
 * guardian marked right. A question with none is a written answer: it is never
 * marked here, only read — the score the student sees leaves it out and says
 * so, because a number that quietly counts an unread answer as wrong is a
 * number nobody should trust.
 */
export interface ExamQuestion {
  id: string;
  prompt: string;
  /** Two to five options. Empty makes this a written answer. */
  choices: string[];
  /** The right option, by index. Null on a written answer. */
  answer: number | null;
  points: number;
}

/** Which way an exam works: instant-graded test, or uploaded answer paper. */
export type ExamKind = 'test' | 'paper';
/** Multiple choice, or a true/false question. */
export type ExamQuestionType = 'single' | 'boolean';

/**
 * An encrypted file that travels over a link — a question paper or a scanned
 * answer sheet. The bytes are encrypted on the sender's device; only this
 * pointer ever enters the outbox.
 */
export interface ExamFile {
  url: string;
  publicId: string;
  name: string;
  mime: string;
  bytes: number;
}

/** One graded question on a test variant, with its answer key. */
export interface ExamKeyQuestion {
  id: string;
  type: ExamQuestionType;
  /** Single choice: 2–5 options. Boolean: the two True/False labels. */
  options: string[];
  /** Correct option index. Boolean uses 0 for True, 1 for False. */
  answer: number | null;
  points: number;
}

/** One paper of a test exam: its own file, questions and answer key. */
export interface ExamVariant {
  id: string;
  label: string;
  file: ExamFile | null;
  questions: ExamKeyQuestion[];
}

/** An exam a guardian set for one student. */
export interface Exam {
  id: string;
  linkId: string;
  author: string;
  title: string;
  subject: string;
  note: string;
  /** Minutes allowed. Null for no clock. */
  minutes: number | null;
  /** When it stops being open (ISO). Null for whenever. */
  dueAt: string | null;
  /**
   * Legacy in-app questions. New exams use `kind` + `variants` (test) or
   * `paperFile` (paper); this stays so exams sent before the change keep
   * working untouched.
   */
  questions: ExamQuestion[];
  createdAt: string;
  /** Missing means a legacy test built on `questions`. */
  kind?: ExamKind;
  /** Test exams: one or more variants. The student answers one of them. */
  variants?: ExamVariant[];
  /** Paper exams: the question file the student downloads. */
  paperFile?: ExamFile | null;
  /** Minutes allowed for uploading the answer paper after time is up. */
  uploadMinutes?: number | null;
}

/** Where a sitting is in its one allowed life. */
export type ExamSittingStatus =
  | 'sitting'
  | 'uploading'
  | 'submitted'
  | 'missed'
  | 'reviewed';

/**
 * A student's in-progress exam, persisted on their device.
 *
 * For a test it holds the answers being chosen; for a paper exam the clock and
 * upload-window bookkeeping. It never syncs — only the finished submission
 * does — but it must survive a reload because the timer it carries is the
 * guardian's limit, not the tab's.
 */
export interface StudentExamDraft {
  examId: string;
  linkId: string;
  kind: ExamKind;
  startedAt: string;
  /** Chosen option index per question id (test exams). */
  answers: Record<string, number>;
  /** Which variant was assigned, once the exam is opened. */
  variantId: string | null;
  /** Paper exams: when the answer upload window closes. */
  uploadDeadline: string | null;
  /** The last phase derived on this device, for quick rendering. */
  phase: ExamSittingStatus;
  /**
   * Paper exams: answer files already encrypted and uploaded, but not yet
   * handed in. Persisted so closing the modal never loses an upload.
   */
  pendingFiles?: ExamFile[];
}

/** One student's sitting of one exam. */
export interface ExamSubmission {
  id: string;
  examId: string;
  linkId: string;
  /** The option chosen per question, by question id. */
  answers: Record<string, number>;
  /** What was written for the written questions, by question id. */
  written: Record<string, string>;
  /** Marked points, and the points that could be marked. */
  score: number;
  marked: number;
  submittedAt: string;
  /** The guardian's words back, once they have read it. */
  feedback?: string;
  reviewedAt?: string | null;
  /** New lifecycle fields; absent on sittings from before the file exams. */
  status?: ExamSittingStatus;
  kind?: ExamKind;
  /** Which variant the student answered. */
  variantId?: string | null;
  /** Uploaded answer papers (paper exams), newest last. */
  files?: ExamFile[];
  /** When the student pressed Start (ISO). */
  startedAt?: string | null;
  /** When the upload window shuts (ISO). */
  uploadDeadline?: string | null;
  /** The answer paper missed its window and had to be re-granted. */
  late?: boolean;
  /** Guardian-entered total for a manually marked paper. */
  maxScore?: number | null;
  /** When the guardian re-opened an upload window. */
  resubmitGrantedAt?: string | null;
  /** When the sealed answer key was released to this device (audit). */
  keyReleasedAt?: string | null;
  /** Question ids by verdict, recorded at the instant a sealed key graded it. */
  right?: string[];
  wrong?: string[];
  blank?: string[];
}

export const EXAMS_KEPT = 12;
export const EXAMS_WIRE = 8;
export const EXAM_QUESTIONS_MAX = 25;
export const EXAM_CHOICES_MAX = 5;
export const EXAM_PROMPT_MAX = 400;
export const EXAM_CHOICE_MAX = 200;
export const EXAM_TITLE_MAX = 120;
export const EXAM_NOTE_MAX = 280;
export const EXAM_WRITTEN_MAX = 600;
export const EXAM_FEEDBACK_MAX = 280;
export const EXAM_RESULTS_KEPT = 30;
export const EXAM_RESULTS_WIRE = 12;
export const EXAM_VARIANTS_MAX = 6;
export const EXAM_FILES_MAX = 12;
/** The fixed answer-paper upload window after the exam clock ends. */
export const EXAM_UPLOAD_WINDOW_MIN = 10;
export const EXAM_UPLOAD_MIN_MIN = 1;
export const EXAM_UPLOAD_MIN_MAX = 60;
export const EXAM_FILE_BYTES_MAX = 20 * 1024 * 1024;
export const EXAM_VARIANT_LABEL_MAX = 40;
export const EXAM_POINTS_MAX = 100;

/** What a guardian has sent this student: brief notices and full plans. */
export interface StudentInbox {
  /** Newest first. */
  notices: GuardianNotice[];
  /** Active plans, newest first. */
  plans: GuardianPlan[];
  /** Classes sent specifically to this student. */
  classes?: ClassAssignment[];
  /** Homework set by this student's guardians. */
  homework?: HomeworkAssignment[];
  /** Goals a guardian would like them to take on, newest first. */
  goals?: GoalSuggestion[];
  /** Exams a guardian set for this student, newest first. */
  exams?: Exam[];
  /**
   * Plans from more than a month ago, rolled up. The lessons are gone; this is
   * the week they added up to. See `src/planRetention.ts`.
   */
  planReviews?: PlanReview[];
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
  /**
   * Plans older than a month, rolled up: the week in numbers rather than the
   * lessons themselves. See `PlanReview` and `src/planRetention.ts`.
   */
  planReviews?: PlanReview[];
  /** Plans sent to this student, newest first. Ticks come back and land on items. */
  plans: GuardianPlan[];
  /** Daily reports this student sent back, newest first. */
  reports?: DayReport[];
  /** Answers sent to this student's daily reports, newest first. */
  acks?: ReportAck[];
  /** Goals suggested to this student, newest first. */
  goals?: GoalSuggestion[];
  /** Classes assigned to this student over this link. */
  classes?: ClassAssignment[];
  /** Homework assigned to this student over this link. */
  homework?: HomeworkAssignment[];
  /** Progress marks returned for assigned classes. */
  classProgress?: ClassProgress[];
  /** Homework images/approvals returned over the encrypted link. */
  homeworkSubmissions?: HomeworkSubmission[];
  homeworkReviews?: HomeworkReview[];
  /** How this student answered them, newest last write wins. */
  goalAnswers?: GoalAnswer[];
  /** Changes this student asked for on a sent plan, newest first. */
  changeRequests?: PlanChangeRequest[];
  /** The thread with this student, oldest first. */
  chat?: ChatMessage[];
  /** Exams set for this student, newest first. */
  exams?: Exam[];
  /** How this student answered them, newest first. */
  examResults?: ExamSubmission[];
  /** When a pending code stops working. Null once accepted, or if unknown. */
  expiresAt?: string | null;
}

/**
 * A week that has left the retention window, kept as numbers.
 *
 * Deliberately content-free: counts, minutes and averages only, the same shape
 * §11 specifies. Old charts read these instead of raw history, which is what
 * lets the detail behind them be dropped without the past disappearing.
 */
export interface ArchivedDay {
  date: string;
  ratio: number | null;
  mood: number | null;
  plannedMinutes: number;
  focusMinutes: number;
}

export interface ArchivedHabit {
  habitId: string;
  name: string;
  done: number;
  target: number;
  streakEnd: number;
}

export interface ArchivedGoal {
  goalId: string;
  title: string;
  milestoneDone: number;
  milestoneTotal: number;
}

export interface WeekArchive {
  weekStart: string;
  days: ArchivedDay[];
  tasksDone: number;
  tasksTotal: number;
  eventsDone: number;
  eventsTotal: number;
  habits: ArchivedHabit[];
  focusMinutes: number;
  focusSessions: number;
  moodAverage: number | null;
  goals: ArchivedGoal[];
}

/**
 * A finished plan, after its month at full detail.
 *
 * A week that is done and signed off is not a thing anyone opens lesson by
 * lesson again — what they come back for is "how did that week go". So the plan
 * keeps its full item list for a month (long enough to re-read it while it is
 * still recent, and to answer a question about a specific lesson), and after
 * that the items are dropped and this stays: the shape of the week in numbers,
 * not the week itself.
 *
 * Deterministic and idempotent like `WeekArchive`: two devices rolling up the
 * same plan write the same review.
 */
export interface PlanReview {
  /** The plan's own id, so a review is never mistaken for a plan that exists. */
  id: string;
  linkId: string;
  /** Monday of the week the plan covered. */
  weekOf: string;
  title: string;
  author: string;
  /** The guardian's sign-off, when there was one. */
  approvedAt: string | null;
  /** When the detail was let go. */
  reviewedAt: string;
  lessons: number;
  /** Lessons the student actually ticked. */
  done: number;
  minutes: number;
  /** Subjects that ran that week, heaviest first. */
  subjects: PlanReviewSubject[];
  /** The guardian's note, trimmed — the one line of prose worth keeping. */
  note: string;
}

export interface PlanReviewSubject {
  name: string;
  lessons: number;
  done: number;
  minutes: number;
}

export interface PlannerState {
  tasks: Task[];
  events: PlannerEvent[];
  fixedCommitments: FixedCommitment[];
  /** Explicit, user-controlled context for the AI. */
  aiMemory: AIMemory[];
  /** AI suggestions this user did not keep, so they stop being proposed. */
  aiDeclined: AIDeclined[];
  /** AI-drafted plans waiting on the Plans page. */
  aiPlans: SavedAIPlan[];
  habits: Habit[];
  completions: HabitCompletion[];
  goals: Goal[];
  notes: Note[];
  moods: MoodEntry[];
  intentions: Record<string, string>;
  focusLog: FocusLog[];
  /** Weeks that have left the retention window, newest last. See src/retention.ts. */
  archives?: WeekArchive[];
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
  /** Optional HH:MM reminder, delivered only on days when the habit is due. */
  reminderTime?: string | null;
}

export interface GoalInput {
  title: string;
  description: string;
  horizon: GoalHorizon;
  deadline: string | null;
  /** The first step, when a goal is written one line at a time. */
  milestone?: string;
  milestoneDue?: string | null;
  /** Several steps at once, when a goal arrives with more than one. */
  milestones?: Array<{ title: string; dueDate?: string | null }>;
  /** Set when the goal came from a guardian's suggestion. */
  fromSuggestion?: { linkId: string; suggestionId: string } | null;
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
    aiDeclined: [],
    aiPlans: [],
    habits: [],
    completions: [],
    goals: [],
    notes: [],
    intentions: {},
    moods: [],
    focusLog: [],
    archives: [],
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
      deletedPlanIds: [],
      subjects: [],
      explanations: [],
      inbox: { notices: [], plans: [], goals: [] },
      goalAnswers: [],
      praise: [],
    },
    guardian: { enabled: false, kind: null, field: null, links: [], notices: [] },
  };
}
