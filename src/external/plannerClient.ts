/**
 * PlannerClient — the high-level SDK an external project (Jarvis, a dashboard,
 * a bot) uses instead of touching the encrypted vault by hand.
 *
 * It composes the two secrets from Settings → Developer API:
 *   - the bearer token authenticates the account and its scope;
 *   - the base64 vault key decrypts and re-encrypts the planner locally.
 *
 * Reads return plain, widget-ready objects. Writes apply a mutator to a fresh
 * copy of the vault and push it with the same optimistic-concurrency rule the
 * apps use: a stale write answers 409 with the current blob, the client merges
 * by re-applying the mutator and retries, so a script can never silently
 * overwrite a phone's edit.
 *
 * Runtime imports are limited to the standalone crypto envelope. App types are
 * imported as types only, so this folder can be copied into another project
 * and compiled on its own.
 */
import { decryptEnvelope, encryptEnvelope, importVaultKey } from './cryptoEnvelope';
import type {
  Exam,
  FixedClass,
  GuardianPlan,
  HomeworkAssignment,
  HomeworkSubmission,
  PlannerEvent,
  PlannerState,
  Task,
} from '../types';
import type { Priority } from '../constants';

/* ------------------------------------------------------------- date helpers */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local calendar day as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay();
}

/** Local ISO timestamp for a day plus an optional HH:MM time; null when untimed. */
function atTime(iso: string, time: string | null | undefined): string | null {
  if (!time) return null;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

function newId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ errors */

export class PlannerApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null) {
    super(message);
    this.name = 'PlannerApiError';
    this.status = status;
    this.code = code;
  }
}

/** A 409: another device wrote first; `current` is its encrypted vault. */
export class ConflictError extends PlannerApiError {
  readonly current: { version: number; ciphertext: string } | null;
  constructor(current: { version: number; ciphertext: string } | null) {
    super(409, 'Another device synced first.', 'conflict');
    this.name = 'ConflictError';
    this.current = current;
  }
}

/* -------------------------------------------------------------------- types */

export interface PlannerClientOptions {
  /** Deployment origin, e.g. https://planner.example.com (no trailing slash needed). */
  baseUrl: string;
  /** Personal access token from Settings → Developer API. */
  token: string;
  /** Base64 256-bit vault key from the same settings section. */
  vaultKey: string;
  /** Injection point for tests and unusual runtimes. */
  fetchImpl?: typeof fetch;
}

export interface MeResponse {
  account: { id: string; username: string; displayName: string; role: string };
  token: { id: string; label: string; scope: 'read' | 'readwrite'; expiresAt: string | null };
}

export interface Reminder {
  kind: 'task' | 'event' | 'fixed-class' | 'plan-item';
  id: string;
  title: string;
  /** ISO day the reminder belongs to. */
  date: string;
  /** HH:MM when it has a time, otherwise null. */
  time: string | null;
  /** Full local ISO timestamp when timed, otherwise the day itself. */
  startsAt: string;
  end: string | null;
  note?: string;
}

export interface AgendaLesson {
  planId: string;
  planTitle: string;
  title: string;
  time: string | null;
  end: string | null;
  done: boolean;
}

export interface AgendaDay {
  date: string;
  weekday: number;
  /** Open tasks due this exact day. */
  tasksDue: Task[];
  /** Still-open tasks from earlier days. */
  overdue: Task[];
  events: PlannerEvent[];
  fixedClasses: FixedClass[];
  planItems: AgendaLesson[];
}

export interface StudentPlanSummary {
  id: string;
  title: string;
  author: string;
  cadence: GuardianPlan['cadence'];
  start: string;
  end: string;
  itemCount: number;
  doneCount: number;
}

export interface StudentHomeworkView {
  id: string;
  title: string;
  subject: string;
  dueAt: string | null;
  submitted: boolean;
  approved: boolean;
}

export interface StudentExamView {
  id: string;
  title: string;
  subject: string;
  dueAt: string | null;
  sat: boolean;
}

export interface StudentPanelView {
  enabled: boolean;
  field: string | null;
  grade: string | null;
  subjects: Array<{ name: string; examDate: string | null }>;
  guardians: Array<{ name: string; linkId: string | null }>;
  plans: StudentPlanSummary[];
  homework: StudentHomeworkView[];
  exams: StudentExamView[];
  fixedClasses: FixedClass[];
}

export interface WidgetBundle {
  generatedAt: string;
  today: string;
  openTasks: number;
  overdueTasks: number;
  completedToday: number;
  eventsToday: number;
  planLessonsToday: number;
  nextReminders: Reminder[];
  student: {
    enabled: boolean;
    activePlans: number;
    openHomework: number;
    upcomingExams: number;
    fixedClasses: number;
  } | null;
}

export interface NewTaskInput {
  title: string;
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  category?: string;
  note?: string;
  estimatedMinutes?: number | null;
}

export interface NewEventInput {
  title: string;
  date: string;
  startTime: string;
  endTime?: string | null;
  category?: string;
  note?: string;
  important?: boolean;
}

/* ------------------------------------------------------------- plan helpers */

/** Last covered day of a plan — mirrors planEnd() in src/panels.ts. */
function planEnd(plan: Pick<GuardianPlan, 'cadence' | 'start'>): string {
  if (plan.cadence === 'day') return plan.start;
  if (plan.cadence === 'week') return addDaysISO(plan.start, 6);
  const [y, m] = plan.start.split('-').map(Number) as [number, number];
  const last = new Date(y, m, 0);
  return `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
}

/** The app's own deletion rule: former guardians' plans, or plans ended a week ago. */
export function studentCanDeletePlan(
  plan: GuardianPlan,
  currentGuardianLinkIds: string[],
  today: string = todayISO(),
): boolean {
  return !currentGuardianLinkIds.includes(plan.linkId) || addDaysISO(planEnd(plan), 7) <= today;
}

/* --------------------------------------------------------------- pure views */

function plansOf(state: PlannerState): GuardianPlan[] {
  return state.panels?.student?.inbox?.plans ?? [];
}

/** Everything on one day: tasks, events, locked classes and planned lessons. */
export function agendaForDay(state: PlannerState, date: string = todayISO()): AgendaDay {
  const openTasks = state.tasks.filter((task) => !task.completed && task.dueDate && task.dueDate <= date);
  const fixedClasses = (state.panels?.student?.fixedClasses ?? []).filter((item) => item.weekday === weekdayOf(date));
  const planItems: AgendaLesson[] = [];
  for (const plan of plansOf(state)) {
    for (const item of plan.items) {
      if (item.date !== date) continue;
      planItems.push({
        planId: plan.id,
        planTitle: plan.title,
        title: item.title,
        time: item.time ?? null,
        end: item.end ?? null,
        done: item.done,
      });
    }
  }
  return {
    date,
    weekday: weekdayOf(date),
    tasksDue: openTasks.filter((task) => task.dueDate === date),
    overdue: openTasks.filter((task) => (task.dueDate ?? '') < date),
    events: state.events.filter((event) => event.date === date),
    fixedClasses,
    planItems,
  };
}

/**
 * What is coming up, timed first. Fixed classes contribute their next
 * occurrence from `from`; everything else is read straight from the vault.
 */
export function upcomingReminders(
  state: PlannerState,
  options: { from?: string; withinMinutes?: number; limit?: number } = {},
): Reminder[] {
  const from = options.from ?? todayISO();
  const horizon = options.withinMinutes ?? 7 * 24 * 60;
  const limit = options.limit ?? 20;
  const out: Reminder[] = [];

  for (const task of state.tasks) {
    if (task.completed || !task.dueDate || task.dueDate < from) continue;
    const startsAt = atTime(task.dueDate, task.dueTime) ?? `${task.dueDate}T23:59:00.000Z`;
    out.push({ kind: 'task', id: task.id, title: task.title, date: task.dueDate, time: task.dueTime, startsAt, end: null, note: task.note || undefined });
  }
  for (const event of state.events) {
    if (event.date < from || event.completed) continue;
    const startsAt = atTime(event.date, event.startTime) ?? `${event.date}T00:00:00.000Z`;
    out.push({ kind: 'event', id: event.id, title: event.title, date: event.date, time: event.startTime || null, startsAt, end: event.endTime, note: event.note || undefined });
  }
  for (const plan of plansOf(state)) {
    for (const item of plan.items) {
      if (!item.date || item.date < from || item.done) continue;
      const startsAt = atTime(item.date, item.time) ?? `${item.date}T00:00:00.000Z`;
      out.push({ kind: 'plan-item', id: `${plan.id}:${item.id}`, title: item.title, date: item.date, time: item.time ?? null, startsAt, end: item.end ?? null });
    }
  }
  for (const fixed of state.panels?.student?.fixedClasses ?? []) {
    let date = from;
    for (let guard = 0; guard < 14 && weekdayOf(date) !== fixed.weekday; guard += 1) date = addDaysISO(date, 1);
    if (weekdayOf(date) !== fixed.weekday) continue;
    const startsAt = atTime(date, fixed.startTime) ?? `${date}T00:00:00.000Z`;
    out.push({ kind: 'fixed-class', id: fixed.id, title: fixed.title, date, time: fixed.startTime, startsAt, end: fixed.endTime });
  }

  const fromTs = new Date(from).getTime();
  return out
    .filter((reminder) => new Date(reminder.startsAt).getTime() - fromTs <= horizon * 60_000)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
}

/** A structured, de-nested view of the student panel for external screens. */
export function studentPanelView(state: PlannerState): StudentPanelView | null {
  const student = state.panels?.student;
  if (!student?.enabled) return null;

  const submissions = new Map<string, HomeworkSubmission>(
    (student.homeworkSubmissions ?? []).map((entry) => [entry.assignmentId, entry]),
  );
  const satExamIds = new Set((student.examSubmissions ?? []).map((entry) => entry.examId));

  const homework: StudentHomeworkView[] = (student.inbox.homework ?? []).map((item: HomeworkAssignment) => {
    const submission = submissions.get(item.id);
    return {
      id: item.id,
      title: item.title,
      subject: item.subject,
      dueAt: item.dueAt,
      submitted: Boolean(submission),
      approved: submission?.status === 'approved',
    };
  });

  const exams: StudentExamView[] = (student.inbox.exams ?? []).map((item: Exam) => ({
    id: item.id,
    title: item.title,
    subject: item.subject,
    dueAt: item.dueAt,
    sat: satExamIds.has(item.id),
  }));

  const plans: StudentPlanSummary[] = plansOf(state).map((plan) => ({
    id: plan.id,
    title: plan.title,
    author: plan.author,
    cadence: plan.cadence,
    start: plan.start,
    end: planEnd(plan),
    itemCount: plan.items.length,
    doneCount: plan.items.filter((item) => item.done).length,
  }));

  return {
    enabled: true,
    field: student.field,
    grade: student.grade,
    subjects: student.subjects.map((subject) => ({ name: subject.name, examDate: subject.examDate ?? null })),
    guardians: student.guardians.map((guardian) => ({
      name: guardian.guardianDisplayName,
      linkId: guardian.linkId,
    })),
    plans,
    homework,
    exams,
    fixedClasses: student.fixedClasses ?? [],
  };
}

/** One compact payload a dashboard or widget can render without more calls. */
export function widgetBundle(state: PlannerState, now: Date = new Date()): WidgetBundle {
  const today = todayISO(now);
  const agenda = agendaForDay(state, today);
  const open = state.tasks.filter((task) => !task.completed);
  const student = state.panels?.student?.enabled
    ? {
        enabled: true,
        activePlans: plansOf(state).length,
        openHomework: (state.panels.student.inbox.homework ?? []).length,
        upcomingExams: (state.panels.student.inbox.exams ?? []).filter((exam) => !exam.dueAt || exam.dueAt >= today).length,
        fixedClasses: (state.panels.student.fixedClasses ?? []).length,
      }
    : null;
  return {
    generatedAt: now.toISOString(),
    today,
    openTasks: open.length,
    overdueTasks: agenda.overdue.length,
    completedToday: state.tasks.filter((task) => task.completed && task.completedAt?.slice(0, 10) === today).length,
    eventsToday: agenda.events.length,
    planLessonsToday: agenda.planItems.length,
    nextReminders: upcomingReminders(state, { from: today, limit: 5 }),
    student,
  };
}

/* ------------------------------------------------------------------ client */

export class PlannerClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly vaultKey: string;
  private readonly fetchImpl: typeof fetch;
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(options: PlannerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.vaultKey = options.vaultKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private key(): Promise<CryptoKey> {
    this.keyPromise ??= importVaultKey(this.vaultKey);
    return this.keyPromise;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string }; current?: { version: number; ciphertext: string } }
      | T
      | null;
    if (!response.ok) {
      const errorBody = body as { error?: { message?: string; code?: string }; current?: { version: number; ciphertext: string } } | null;
      if (response.status === 409) {
        throw new ConflictError(errorBody?.current ?? null);
      }
      throw new PlannerApiError(
        response.status,
        errorBody?.error?.message ?? `Request failed with ${response.status}.`,
        errorBody?.error?.code ?? null,
      );
    }
    return body as T;
  }

  /** Verifies the token and reports the account, scope and expiry. */
  me(): Promise<MeResponse> {
    return this.request<MeResponse>('/api/external/me');
  }

  /** Pulls the vault, decrypts it, and returns the planner state with its version. */
  async pull(): Promise<{ version: number; state: PlannerState }> {
    const vault = await this.request<{ version: number; ciphertext: string }>('/api/external/vault');
    const key = await this.key();
    const state = JSON.parse(await decryptEnvelope(vault.ciphertext, key)) as PlannerState;
    return { version: vault.version, state };
  }

  /** Encrypts and writes a full vault. Prefer `mutate` for ordinary changes. */
  async push(state: PlannerState, baseVersion: number): Promise<number> {
    const key = await this.key();
    const ciphertext = await encryptEnvelope(JSON.stringify(state), key);
    const result = await this.request<{ version: number }>('/api/external/vault', {
      method: 'PUT',
      body: JSON.stringify({ baseVersion, ciphertext }),
    });
    return result.version;
  }

  /**
   * Apply one change to a fresh vault copy and write it. On a 409 the latest
   * vault is pulled and the mutator is re-applied, up to `retries` times —
   * the same merge-and-retry contract the apps follow.
   */
  async mutate(mutator: (state: PlannerState) => void, retries = 3): Promise<number> {
    let { version, state } = await this.pull();
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const draft = deepClone(state);
      mutator(draft);
      try {
        return await this.push(draft, version);
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt === retries || !error.current) throw error;
        const key = await this.key();
        version = error.current.version;
        state = JSON.parse(await decryptEnvelope(error.current.ciphertext, key)) as PlannerState;
      }
    }
    throw new PlannerApiError(409, 'The vault changed repeatedly while writing.', 'conflict');
  }

  /* ------------------------------------------------------------- task writes */

  addTask(input: NewTaskInput): Promise<number> {
    const now = new Date().toISOString();
    return this.mutate((state) => {
      const task: Task = {
        id: newId('task'),
        title: input.title.trim(),
        completed: false,
        priority: input.priority ?? 'medium',
        dueDate: input.dueDate ?? null,
        dueTime: input.dueTime ?? null,
        category: input.category ?? '',
        note: input.note ?? '',
        goalId: null,
        sortOrder: state.tasks.reduce((max, task) => Math.max(max, task.sortOrder), 0) + 1,
        createdAt: now,
        updatedAt: now,
        repeat: null,
        subtasks: [],
        waiting: null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        completedAt: null,
      };
      state.tasks.push(task);
    });
  }

  updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'priority' | 'dueDate' | 'dueTime' | 'category' | 'note' | 'estimatedMinutes' | 'waiting'>>): Promise<number> {
    return this.mutate((state) => {
      const task = state.tasks.find((entry) => entry.id === id);
      if (!task) throw new PlannerApiError(404, `No task with id ${id}.`, 'not_found');
      Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    });
  }

  completeTask(id: string, done = true): Promise<number> {
    return this.mutate((state) => {
      const task = state.tasks.find((entry) => entry.id === id);
      if (!task) throw new PlannerApiError(404, `No task with id ${id}.`, 'not_found');
      task.completed = done;
      task.completedAt = done ? new Date().toISOString() : null;
      task.updatedAt = new Date().toISOString();
    });
  }

  removeTask(id: string): Promise<number> {
    return this.mutate((state) => {
      const before = state.tasks.length;
      state.tasks = state.tasks.filter((entry) => entry.id !== id);
      if (state.tasks.length === before) throw new PlannerApiError(404, `No task with id ${id}.`, 'not_found');
    });
  }

  /* ------------------------------------------------------------ event writes */

  addEvent(input: NewEventInput): Promise<number> {
    const now = new Date().toISOString();
    return this.mutate((state) => {
      const event: PlannerEvent = {
        id: newId('event'),
        title: input.title.trim(),
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime ?? null,
        category: input.category ?? '',
        note: input.note ?? '',
        important: input.important ?? false,
        completed: false,
        sortOrder: state.events.reduce((max, event) => Math.max(max, event.sortOrder), 0) + 1,
        createdAt: now,
        updatedAt: now,
        repeat: null,
        source: null,
      };
      state.events.push(event);
    });
  }

  removeEvent(id: string): Promise<number> {
    return this.mutate((state) => {
      const before = state.events.length;
      state.events = state.events.filter((entry) => entry.id !== id);
      if (state.events.length === before) throw new PlannerApiError(404, `No event with id ${id}.`, 'not_found');
    });
  }

  /* ----------------------------------------------------- student plan writes */

  /**
   * Remove a plan from the student panel, respecting the app's own rule: only
   * a former guardian's plan, or one that ended at least a week ago. The
   * removal is remembered in `deletedPlanIds` exactly as the app does, so a
   * guardian's next sync cannot resurrect it.
   */
  removeStudentPlan(planId: string): Promise<number> {
    return this.mutate((state) => {
      const student = state.panels.student;
      const plan = student.inbox.plans.find((entry) => entry.id === planId);
      if (!plan) throw new PlannerApiError(404, `No plan with id ${planId}.`, 'not_found');
      const linkIds = student.guardians.map((guardian) => guardian.linkId).filter((id): id is string => Boolean(id));
      if (!studentCanDeletePlan(plan, linkIds)) {
        throw new PlannerApiError(403, 'That plan is from an active guardian and its week has not ended yet.', 'forbidden');
      }
      student.deletedPlanIds = [...new Set([...(student.deletedPlanIds ?? []), planId])].slice(-200);
      student.inbox.plans = student.inbox.plans.filter((entry) => entry.id !== planId);
    });
  }
}
