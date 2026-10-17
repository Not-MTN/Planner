/**
 * Linking a guardian to a student, and moving weekly results between them.
 *
 * The exchange has one secret — the pairing code the guardian hands over — and
 * the server never sees it, only its hash:
 *
 *   guardian                 server                    student
 *   ────────                 ──────                    ───────
 *   code  = random 12 chars
 *   key   = HKDF(code)
 *   share = random 32B   ──► codeHash, share sealed ──► types the code
 *                            with `key`                 key    = HKDF(code)
 *                                                       share  = open(sealed)
 *                                                       share sealed with vault key
 *
 * From then on the student encrypts weekly results with `share` and the guardian
 * decrypts them with the same key, held inside their own vault. The server moves
 * ciphertext it can never open.
 */
import {
  createShareKey,
  decryptJson,
  encryptJson,
  formatLinkCode,
  importDek,
  keyFromLinkCode,
  linkCodeHash,
  unwrapKeyRaw,
  wrapKey,
} from './crypto';
import { AuthError, getActiveSession, request } from './session';
import { newId, weekOf, weekResults, withGoalAnswer, withLinkAck, withLinkChangeRequests, withLinkGoal, withLinkPlan, withoutLinkGoal, withoutLinkPlan, withoutQueuedPlan } from '../panels';
import { t } from '../i18n';
import { todayISO } from '../dates';
import { deleteHomeworkPhotoAssets } from '../homeworkMedia';
import {
  normalizeClassVideoUrl,
  sanitizeClassAssignment,
  sanitizeClassProgress,
  sanitizeHomeworkAssignment,
  sanitizeHomeworkReview,
  sanitizeHomeworkSubmission,
  withGuardianHomeworkReview,
  withLinkClass,
  withLinkHomework,
  withoutLinkClass,
  withStudentHomeworkSubmission,
} from '../learning';
import {
  answeredChangeRequest,
  applyChangeRequest,
  canApprovePlanPeriod,
  canEditPlanDay,
  changeRequestNotice,
  diffPlanDay,
  itemsForDay,
  mergeAcks,
  mergeChangeRequests,
  openChangeRequests,
  mergeLinkReports,
  normalizeLessonEnd,
  normalizeLessonUrl,
  openRequests,
  planDayChangeSummary,
  requestNotice,
  withPlanDaysRewritten,
  type PlanDayEdit,
} from '../weekPlans';
import { ACK_REACTIONS, ACK_TEXT_MAX, DAY_REPORT_NOTE_MAX, DAY_REPORTS_WIRE, GOAL_ANSWERS_KEPT, GOAL_STEPS_MAX, HOMEWORK_ITEMS_KEPT, HOMEWORK_NOTE_MAX, PANEL_GOALS_KEPT, PLAN_CHANGES_KEPT, PLAN_CHANGES_WIRE, PLAN_CHANGE_NOTE_MAX, PLAN_CHANGE_TITLE_MAX, PLAN_REQUESTS_WIRE, PRAISE_KEPT } from '../types';
import type { ClassAssignment, ClassProgress, DayReport, Goal, GoalAnswer, GoalSuggestion, GuardianLink, GuardianNotice, GuardianPlan, HomeworkAssignment, HomeworkPhoto, HomeworkReview, HomeworkSubmission, Panels, PlanChangeRequest, PlanDraft, PlanItem, PlanRequest, PlannerState, ReportAck, StudentGuardian, WeekResults, WeekSubjectMinutes } from '../types';
/** Matches the cap in storage.ts, so the vault and the view agree. */
const WEEKS_KEPT = 12;
import type { AcceptLinkResponse, LinksResponse, OutgoingLink, ShareResponse } from '../shared/authContract';

export class LinkError extends Error {}

async function requireSession() {
  const session = getActiveSession();
  if (!session) throw new LinkError('Sign in to do that.');
  return session;
}

/* ---------------------------------------------------------------- guardian */

export interface Invitation {
  link: GuardianLink;
  /** Show this to the student once; it is never stored on the server. */
  code: string;
  /** When the code stops working. Comes from the server, so it is the truth. */
  expiresAt: string | null;
}

/** True when a pending code has stopped working. */
export function isInviteExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  return Number.isFinite(at) && at <= now;
}

/**
 * Guardian: ask a student to be followed. Returns the invitation to hand over.
 * The vault still has to be saved with the returned panels.
 */
export async function inviteStudent(panels: Panels, username: string, displayName?: string): Promise<{ panels: Panels; invitation: Invitation }> {
  const session = await requireSession();
  const clean = username.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(clean)) throw new LinkError('That username does not look right.');
  if (clean === session.user.username.toLowerCase()) throw new LinkError('You cannot follow yourself.');

  const code = formatLinkCode();
  const shareKey = await createShareKey();
  const codeKey = await keyFromLinkCode(code);
  const wrappedShare = await wrapKey(shareKey, codeKey);
  const wrappedShareKey = await wrapKey(shareKey, session.dek);

  const result = await request<{ link: OutgoingLink }>('/api/auth/links', {
    method: 'POST',
    body: JSON.stringify({ username: clean, codeHash: await linkCodeHash(code), wrappedShare }),
  });
  const expiresAt = result.link.expiresAt ?? null;

  const link: GuardianLink = {
    id: newId('link'),
    username: clean,
    displayName: displayName?.trim() || clean,
    status: 'pending',
    history: [],
    linkId: result.link.id,
    code,
    wrappedShareKey,
    results: null,
    plans: [],
    expiresAt,
  };
  return {
    panels: { ...panels, guardian: { ...panels.guardian, links: [...panels.guardian.links, link] } },
    invitation: { link, code, expiresAt },
  };
}

/** Guardian: pull the newest results for every linked student. */
export async function refreshResults(panels: Panels): Promise<{ panels: Panels; changed: boolean }> {
  const session = await requireSession();
  const links = panels.guardian.links;
  let changed = false;

  const next: GuardianLink[] = [];
  for (const link of links) {
    if (link.status !== 'linked' || !link.linkId || !link.wrappedShareKey) {
      next.push(link);
      continue;
    }
    try {
      const share = await request<ShareResponse>(`/api/auth/share?linkId=${encodeURIComponent(link.linkId)}`);
      if (!share.ciphertext) {
        next.push(link);
        continue;
      }
      const raw = await unwrapKeyRaw(link.wrappedShareKey, session.dek);
      const shareKey = await importDek(raw, false);
      const results = await decryptJson<WeekResults>(share.ciphertext, shareKey);
      // Only results are kept: no tasks, no notes, no reasons beyond the headline.
      const clean: WeekResults = {
        weekOf: typeof results.weekOf === 'string' ? results.weekOf : weekOf(),
        planned: Number(results.planned) || 0,
        done: Number(results.done) || 0,
        focusMinutes: Number(results.focusMinutes) || 0,
        subjects: (Array.isArray(results.subjects) ? results.subjects : [])
          .filter((item): item is WeekSubjectMinutes => !!item && typeof item.name === 'string')
          .map((item) => ({ name: String(item.name).slice(0, 40), minutes: Math.max(0, Math.round(Number(item.minutes) || 0)) }))
          .slice(0, 4),
        headline: typeof results.headline === 'string' ? results.headline.slice(0, 160) : null,
        updatedAt: typeof results.updatedAt === 'string' ? results.updatedAt : new Date().toISOString(),
      };
      if (JSON.stringify(clean) !== JSON.stringify(link.results)) changed = true;
      // A week that has moved on joins the history, so the charts have a past.
      const history =
        link.history[0]?.weekOf === clean.weekOf
          ? [clean, ...link.history.slice(1)]
          : [clean, ...link.history.filter((week) => week.weekOf !== clean.weekOf)];
      next.push({ ...link, results: clean, history: history.slice(0, WEEKS_KEPT) });
    } catch {
      next.push(link);
    }
  }

  return { panels: { ...panels, guardian: { ...panels.guardian, links: next } }, changed };
}

/** Guardian or student: end a link. It disappears from both sides. */
export async function removeLink(panels: Panels, linkId: string): Promise<Panels> {
  try {
    await request('/api/auth/links', { method: 'DELETE', body: JSON.stringify({ linkId }) });
  } catch {
    /* removing it locally is still the right outcome */
  }
  return {
    ...panels,
    guardian: { ...panels.guardian, links: panels.guardian.links.filter((link) => link.linkId !== linkId) },
    student: { ...panels.student, guardians: panels.student.guardians.filter((guardian) => guardian.linkId !== linkId) },
  };
}

/* ---------------------------------------------------------------- mailbox */

async function shareKeyFor(dek: CryptoKey, wrapped: string): Promise<CryptoKey> {
  const raw = await unwrapKeyRaw(wrapped, dek);
  return importDek(raw, false);
}

/** How a plan's ticks travel back: which items the student has finished. */
interface PlanTick {
  planId: string;
  doneIds: string[];
  updatedAt: string;
}

/**
 * Each link owns two encrypted slots the server can never read:
 *
 *   note_to_student — the guardian's outbox: notices and plans for the student
 *   note_to_guardian — the student's outbox: plan ticks, daily reports,
 *                      plus whatever the other guardians said, so the adults
 *                      stay in step
 *
 * Both writers send full state rather than one-shot messages, so nothing is
 * lost to a well-timed overwrite — a reader who misses a poll simply catches
 * up on the next one.
 */
interface GuardianOutbox {
  v: 3;
  notices: Array<Omit<GuardianNotice, 'read'>>;
  plans: GuardianPlan[];
  /** Goals suggested to this student. Words only, until they say yes. */
  goals: GoalSuggestion[];
  /** Answers and approvals for the student's daily reports, newest first. */
  acks: ReportAck[];
  /** Classes assigned specifically to this student. */
  classes: ClassAssignment[];
  /** Homework assigned specifically to this student. */
  homework: HomeworkAssignment[];
  /** Guardian approval decisions retained for synchronization. */
  homeworkReviews: HomeworkReview[];
  /**
   * Answers to the student's change requests, newest first. They ride here so
   * an approval or a decline reaches the student on their next pull, exactly
   * as the answers to daily reports do.
   */
  changeAnswers: PlanChangeRequest[];
}

interface StudentOutbox {
  v: 3;
  relayed: Array<Omit<GuardianNotice, 'read'>>;
  progress: PlanTick[];
  /** How the suggested goals were answered, and how far each has got. */
  answers: GoalAnswer[];
  /** Daily reports for this guardian's week plans, newest first. */
  reports: DayReport[];
  /** Student's progress on this guardian's classes. */
  classProgress: ClassProgress[];
  /** Homework photo pointers and submission status for this guardian. */
  homeworkSubmissions: HomeworkSubmission[];
  /** Open asks for a week plan. */
  requests: PlanRequest[];
  /** Asks for one change to a plan that has already been sent. */
  changes: PlanChangeRequest[];
}

const OUTBOX_PLANS = 5;
const OUTBOX_NOTICES = 10;
/** A week holds seven days of lessons; sixty is eight a day with room to spare. */
const PLAN_ITEMS_MAX = 60;
/** Lesson times ride the wire as 24-hour HH:MM. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const OUTBOX_GOALS = 5;
const OUTBOX_CLASSES = 20;
const OUTBOX_HOMEWORK = HOMEWORK_ITEMS_KEPT;

function wireTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function wireNotice(value: unknown): Omit<GuardianNotice, 'read'> | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) return null;
  return {
    id: String(raw.id ?? '').slice(0, 80) || 'note',
    student: String(raw.student ?? '').slice(0, 40),
    author: String(raw.author ?? '').slice(0, 60),
    summary: raw.summary.trim().slice(0, 160),
    weekOf: String(raw.weekOf ?? '').slice(0, 10),
    createdAt: String(raw.createdAt ?? new Date().toISOString()).slice(0, 40),
    kind:
      raw.kind === 'praise' ? 'praise' : raw.kind === 'request' ? 'request' : raw.kind === 'nudge' ? 'nudge' : 'note',
  };
}

function wirePlan(value: unknown): GuardianPlan | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const cadence = raw.cadence === 'day' || raw.cadence === 'week' || raw.cadence === 'month' ? (raw.cadence as GuardianPlan['cadence']) : null;
  const start = String(raw.start ?? '');
  if (!cadence || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .flatMap((item): PlanItem[] => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      if (typeof entry.title !== 'string' || !entry.title.trim()) return [];
      return [{
        id: String(entry.id ?? '').slice(0, 80) || 'item',
        title: entry.title.trim().slice(0, 120),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date ?? '')) ? String(entry.date) : null,
        time: TIME_RE.test(String(entry.time ?? '')) ? String(entry.time) : null,
        end: normalizeLessonEnd(
          TIME_RE.test(String(entry.time ?? '')) ? String(entry.time) : null,
          TIME_RE.test(String(entry.end ?? '')) ? String(entry.end) : null,
        ),
        minutes: typeof entry.minutes === 'number' && Number.isFinite(entry.minutes) ? Math.max(0, Math.round(entry.minutes)) : null,
        subject: typeof entry.subject === 'string' && entry.subject.trim() ? entry.subject.trim().slice(0, 60) : null,
        url: typeof entry.url === 'string' ? normalizeLessonUrl(entry.url) : null,
        done: entry.done === true,
      }];
    })
    .slice(0, PLAN_ITEMS_MAX);
  return {
    id: String(raw.id ?? '').slice(0, 80) || 'plan',
    author: String(raw.author ?? '').slice(0, 60),
    linkId: String(raw.linkId ?? '').slice(0, 64),
    cadence,
    start,
    title: String(raw.title ?? '').trim().slice(0, 120) || 'Plan',
    note: String(raw.note ?? '').trim().slice(0, 400),
    field: typeof raw.field === 'string' && raw.field.trim() ? raw.field.trim().slice(0, 60) : null,
    grade: typeof raw.grade === 'string' && raw.grade.trim() ? raw.grade.trim().slice(0, 60) : null,
    restDays: [...new Set((Array.isArray(raw.restDays) ? raw.restDays : []).filter((day): day is number => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6))],
    items,
    approvedAt: wireTimestamp(raw.approvedAt),
    createdAt: String(raw.createdAt ?? new Date().toISOString()).slice(0, 40),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()).slice(0, 40),
  };
}

/** A suggestion is only words, so a malformed one is dropped rather than guessed at. */
function wireGoalSuggestion(value: unknown): GoalSuggestion | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '').slice(0, 80);
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
  if (!id || !title) return null;
  const target = String(raw.target ?? '');
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .flatMap((step) => (typeof step === 'string' && step.trim() ? [step.trim().slice(0, 140)] : []))
    .slice(0, GOAL_STEPS_MAX);
  return {
    id,
    author: String(raw.author ?? '').slice(0, 60),
    linkId: String(raw.linkId ?? '').slice(0, 64),
    title,
    note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 400) : '',
    target: /^\d{4}-\d{2}-\d{2}$/.test(target) ? target : null,
    steps,
    createdAt: String(raw.createdAt ?? new Date().toISOString()).slice(0, 40),
  };
}

function wireGoalAnswer(value: unknown): GoalAnswer | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const suggestionId = String(raw.suggestionId ?? '').slice(0, 80);
  if (!suggestionId) return null;
  if (raw.state !== 'accepted' && raw.state !== 'declined') return null;
  const total = typeof raw.total === 'number' && Number.isFinite(raw.total) ? Math.max(0, Math.min(GOAL_STEPS_MAX, Math.round(raw.total))) : 0;
  const done = typeof raw.done === 'number' && Number.isFinite(raw.done) ? Math.max(0, Math.min(total, Math.round(raw.done))) : 0;
  return {
    suggestionId,
    state: raw.state,
    done,
    total,
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()).slice(0, 40),
  };
}

/** An answer to a daily report; malformed ones are dropped, never guessed at. */
function wireReportAck(value: unknown): ReportAck | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '').slice(0, 80);
  const reportId = String(raw.reportId ?? '').slice(0, 80);
  const planId = String(raw.planId ?? '').slice(0, 80);
  const date = String(raw.date ?? '');
  if (!id || !reportId || !planId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    id,
    reportId,
    planId,
    linkId: String(raw.linkId ?? '').slice(0, 64),
    date,
    text: typeof raw.text === 'string' ? raw.text.trim().slice(0, ACK_TEXT_MAX) : '',
    reactions: sanitizeReactions(raw.reactions),
    approvedAt: wireTimestamp(raw.approvedAt),
    createdAt: String(raw.createdAt ?? new Date().toISOString()).slice(0, 40),
  };
}

/** Only the offered emoji survive the wire, each once — eight is far more than three. */
function sanitizeReactions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(ACK_REACTIONS);
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && allowed.has(entry)))].slice(
    0,
    8,
  );
}

/** An ask for a week plan; stale ones are filtered when the outbox is built, not here. */
function wirePlanRequest(value: unknown): PlanRequest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '').slice(0, 80);
  if (!id) return null;
  return {
    id,
    linkId: String(raw.linkId ?? '').slice(0, 64),
    note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 140) : '',
    createdAt: String(raw.createdAt ?? new Date().toISOString()).slice(0, 40),
  };
}

/**
 * An ask for one change to a plan. Malformed ones are dropped rather than
 * guessed at, and an answer that arrives on the same record travels back with
 * it — the student reads the decision on their next pull.
 */
function wirePlanChangeRequest(value: unknown): PlanChangeRequest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '').slice(0, 80);
  const planId = String(raw.planId ?? '').slice(0, 80);
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, PLAN_CHANGE_TITLE_MAX) : '';
  if (!id || !planId || !title) return null;
  if (raw.kind !== 'add' && raw.kind !== 'remove') return null;
  const date = String(raw.date ?? '');
  const time = TIME_RE.test(String(raw.time ?? '')) ? String(raw.time) : null;
  const end = TIME_RE.test(String(raw.end ?? '')) ? String(raw.end) : null;
  return {
    id,
    planId,
    linkId: String(raw.linkId ?? '').slice(0, 64),
    kind: raw.kind,
    title,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    itemId: typeof raw.itemId === 'string' && raw.itemId ? raw.itemId.slice(0, 80) : null,
    time,
    end: normalizeLessonEnd(time, end),
    note: typeof raw.note === 'string' ? raw.note.trim().slice(0, PLAN_CHANGE_NOTE_MAX) : '',
    state: raw.state === 'approved' ? 'approved' : raw.state === 'declined' ? 'declined' : 'open',
    reply: typeof raw.reply === 'string' ? raw.reply.trim().slice(0, PLAN_CHANGE_NOTE_MAX) : '',
    answeredAt: wireTimestamp(raw.answeredAt),
    createdAt: String(raw.createdAt ?? new Date().toISOString()).slice(0, 40),
  };
}

/** A student's report for one planned day; a malformed one is dropped, never guessed at. */
function wireDayReport(value: unknown): DayReport | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '').slice(0, 80);
  const planId = String(raw.planId ?? '').slice(0, 80);
  const linkId = String(raw.linkId ?? '').slice(0, 64);
  const date = String(raw.date ?? '');
  if (!id || !planId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    id,
    planId,
    linkId,
    date,
    doneIds: (Array.isArray(raw.doneIds) ? raw.doneIds : []).filter((entry): entry is string => typeof entry === 'string').slice(0, PLAN_ITEMS_MAX),
    note: typeof raw.note === 'string' ? raw.note.trim().slice(0, DAY_REPORT_NOTE_MAX) : '',
    repair: raw.repair === true,
    createdAt: String(raw.createdAt ?? new Date().toISOString()).slice(0, 40),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()).slice(0, 40),
  };
}

/**
 * `outgoing` reads what this account put out there rather than what it was
 * sent. Needed before writing: the two are different slots, and adding to the
 * wrong one loses whatever was already there.
 */
async function readSlot(
  linkId: string,
  wrappedShareKey: string,
  dek: CryptoKey,
  outgoing = false,
): Promise<unknown> {
  const key = await shareKeyFor(dek, wrappedShareKey);
  const query = `/api/auth/note?linkId=${encodeURIComponent(linkId)}${outgoing ? '&dir=out' : ''}`;
  const incoming = await request<{ ciphertext: string | null }>(query);
  if (!incoming.ciphertext) return null;
  return decryptJson<unknown>(incoming.ciphertext, key);
}

async function writeSlot(linkId: string, wrappedShareKey: string, dek: CryptoKey, payload: unknown): Promise<void> {
  const key = await shareKeyFor(dek, wrappedShareKey);
  const ciphertext = await encryptJson(payload, key);
  await request('/api/auth/note', {
    method: 'PUT',
    body: JSON.stringify({ linkId, ciphertext, weekOf: weekOf() }),
  });
}

/** The guardian's outbox for one link; a legacy single note folds in as one notice. */
function asGuardianOutbox(payload: unknown): Omit<GuardianOutbox, 'v'> {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const legacy = wireNotice(payload);
  const notices = [
    ...(Array.isArray(raw.notices) ? raw.notices.flatMap((item) => (wireNotice(item) ? [wireNotice(item)!] : [])) : []),
    ...(legacy && !Array.isArray(raw.notices) ? [legacy] : []),
  ].slice(0, OUTBOX_NOTICES);
  const plans = (Array.isArray(raw.plans) ? raw.plans : [])
    .flatMap((item) => (wirePlan(item) ? [wirePlan(item)!] : []))
    .slice(0, OUTBOX_PLANS);
  const goals = (Array.isArray(raw.goals) ? raw.goals : [])
    .flatMap((item) => (wireGoalSuggestion(item) ? [wireGoalSuggestion(item)!] : []))
    .slice(0, OUTBOX_GOALS);
  const acks = (Array.isArray(raw.acks) ? raw.acks : [])
    .flatMap((item) => (wireReportAck(item) ? [wireReportAck(item)!] : []))
    .slice(0, DAY_REPORTS_WIRE);
  const classes = (Array.isArray(raw.classes) ? raw.classes : [])
    .flatMap((item) => {
      const clean = sanitizeClassAssignment(item);
      return clean ? [clean] : [];
    })
    .slice(0, OUTBOX_CLASSES);
  const homework = (Array.isArray(raw.homework) ? raw.homework : [])
    .flatMap((item) => {
      const clean = sanitizeHomeworkAssignment(item);
      return clean ? [clean] : [];
    })
    .slice(0, OUTBOX_HOMEWORK);
  const homeworkReviews = (Array.isArray(raw.homeworkReviews) ? raw.homeworkReviews : [])
    .flatMap((item) => {
      const clean = sanitizeHomeworkReview(item);
      return clean ? [clean] : [];
    })
    .slice(-HOMEWORK_ITEMS_KEPT);
  const changeAnswers = (Array.isArray(raw.changeAnswers) ? raw.changeAnswers : [])
    .flatMap((item) => (wirePlanChangeRequest(item) ? [wirePlanChangeRequest(item)!] : []))
    .slice(0, PLAN_CHANGES_WIRE);
  return { notices, plans, goals, acks, classes, homework, homeworkReviews, changeAnswers };
}

/** The student's outbox for one link; a legacy relayed note folds in too. */
function asStudentOutbox(payload: unknown): Omit<StudentOutbox, 'v'> {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const legacy = wireNotice(payload);
  const relayed = [
    ...(Array.isArray(raw.relayed) ? raw.relayed.flatMap((item) => (wireNotice(item) ? [wireNotice(item)!] : [])) : []),
    ...(legacy && !Array.isArray(raw.relayed) ? [legacy] : []),
  ].slice(0, OUTBOX_NOTICES);
  const progress = (Array.isArray(raw.progress) ? raw.progress : [])
    .flatMap((item): PlanTick[] => {
      if (!item || typeof item !== 'object') return [];
      const tick = item as Record<string, unknown>;
      if (typeof tick.planId !== 'string' || !tick.planId) return [];
      return [{
        planId: tick.planId.slice(0, 80),
        doneIds: (Array.isArray(tick.doneIds) ? tick.doneIds : []).filter((id): id is string => typeof id === 'string').slice(0, PLAN_ITEMS_MAX),
        updatedAt: String(tick.updatedAt ?? new Date().toISOString()).slice(0, 40),
      }];
    })
    .slice(0, OUTBOX_PLANS);
  const answers = (Array.isArray(raw.answers) ? raw.answers : [])
    .flatMap((item) => (wireGoalAnswer(item) ? [wireGoalAnswer(item)!] : []))
    .slice(0, OUTBOX_GOALS);
  const reports = (Array.isArray(raw.reports) ? raw.reports : [])
    .flatMap((item) => (wireDayReport(item) ? [wireDayReport(item)!] : []))
    .slice(0, DAY_REPORTS_WIRE);
  const classProgress = (Array.isArray(raw.classProgress) ? raw.classProgress : [])
    .flatMap((item) => {
      const clean = sanitizeClassProgress(item);
      return clean ? [clean] : [];
    })
    .slice(0, OUTBOX_CLASSES);
  const homeworkSubmissions = (Array.isArray(raw.homeworkSubmissions) ? raw.homeworkSubmissions : [])
    .flatMap((item) => {
      const clean = sanitizeHomeworkSubmission(item);
      return clean ? [clean] : [];
    })
    .slice(0, HOMEWORK_ITEMS_KEPT);
  const requests = (Array.isArray(raw.requests) ? raw.requests : [])
    .flatMap((item) => (wirePlanRequest(item) ? [wirePlanRequest(item)!] : []))
    .slice(0, PLAN_REQUESTS_WIRE);
  const changes = (Array.isArray(raw.changes) ? raw.changes : [])
    .flatMap((item) => (wirePlanChangeRequest(item) ? [wirePlanChangeRequest(item)!] : []))
    .slice(0, PLAN_CHANGES_WIRE);
  return { relayed, progress, answers, reports, classProgress, homeworkSubmissions, requests, changes };
}

/**
 * Guardian: tell the student and the other adults following them what you
 * changed. The note lands in the student's inbox and in their next relay.
 */
export async function postNotice(panels: Panels, linkId: string, summary: string): Promise<Panels> {
  return postToStudent(panels, linkId, summary, 'note');
}

/**
 * Guardian: send encouragement rather than instruction.
 *
 * Same channel as a note, and deliberately so — a parent should not have to
 * learn a second screen to say well done. It is marked so the student's panel
 * can keep it apart: a note is read once and acted on, praise is read again
 * on the week nothing went right.
 */
export async function postPraise(panels: Panels, linkId: string, summary: string): Promise<Panels> {
  return postToStudent(panels, linkId, summary, 'praise');
}

/**
 * Guardian: nudge about missing daily reports. The words are fixed — a nudge
 * sent in frustration should still read kindly on arrival — and the view
 * allows one a day (see `nudgedToday`). Same channel as any other notice.
 */
export async function postNudge(panels: Panels, linkId: string): Promise<Panels> {
  return postToStudent(
    panels,
    linkId,
    t('A gentle nudge — your daily reports are still missing. How is it going?'),
    'nudge',
  );
}

async function postToStudent(
  panels: Panels,
  linkId: string,
  summary: string,
  kind: 'note' | 'praise' | 'nudge',
): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  const text = summary.trim().slice(0, 160);
  if (!text) return panels;

  const note = {
    id: newId(kind === 'praise' ? 'praise' : kind === 'nudge' ? 'nudge' : 'note'),
    student: link.username,
    author: session.user.displayName || session.user.username,
    summary: text,
    weekOf: weekOf(),
    createdAt: new Date().toISOString(),
    kind,
  };
  // Full-state write: whatever plans and goals are already out there must survive.
  let outbox: GuardianOutbox = { v: 3, notices: [note], plans: [], goals: [], acks: [], classes: [], homework: [], homeworkReviews: [], changeAnswers: [] };
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
    outbox = {
      v: 3,
      notices: [note, ...current.notices.filter((item) => item.id !== note.id)].slice(0, OUTBOX_NOTICES),
      acks: current.acks,
      plans: current.plans,
      goals: current.goals,
      classes: current.classes,
      homework: current.homework,
      homeworkReviews: current.homeworkReviews,
      changeAnswers: current.changeAnswers,
    };
  } catch {
    /* first write, or the slot is empty */
  }
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  // The author sees their own words straight away, marked as read.
  const notice: GuardianNotice = { ...note, read: true };
  return { ...panels, guardian: { ...panels.guardian, notices: [notice, ...panels.guardian.notices].slice(0, 20) } };
}

/**
 * Guardian: put a day, week, or month plan in the student's inbox. The student
 * sees it in their panel, ticks items off, and the ticks travel back.
 */
export async function sendPlan(panels: Panels, linkId: string, draft: PlanDraft): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');

  const now = new Date().toISOString();
  const plan: GuardianPlan = {
    id: newId('plan'),
    author: session.user.displayName || session.user.username,
    linkId,
    cadence: draft.cadence,
    start: draft.start,
    title: draft.title.trim().slice(0, 120) || t('Plan'),
    note: draft.note.trim().slice(0, 400),
    field: draft.field?.trim() ? draft.field.trim().slice(0, 60) : null,
    grade: draft.grade?.trim() ? draft.grade.trim().slice(0, 20) : null,
    restDays: [...new Set((draft.restDays ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))],
    items: draft.items.slice(0, PLAN_ITEMS_MAX).map((item) => ({
      id: newId('item'),
      title: item.title.trim().slice(0, 120),
      date: item.date ?? null,
      time: item.time && TIME_RE.test(item.time) ? item.time : null,
      end: normalizeLessonEnd(
        item.time && TIME_RE.test(item.time) ? item.time : null,
        item.end && TIME_RE.test(item.end) ? item.end : null,
      ),
      minutes: item.minutes,
      subject: item.subject?.trim() ? item.subject.trim().slice(0, 60) : null,
      url: item.url ? normalizeLessonUrl(item.url) : null,
      done: false,
    })),
    createdAt: now,
    updatedAt: now,
  };

  let outbox: GuardianOutbox = { v: 3, notices: [], plans: [plan], goals: [], acks: [], classes: [], homework: [], homeworkReviews: [], changeAnswers: [] };
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
    outbox = {
      v: 3,
      notices: current.notices,
      plans: [plan, ...current.plans.filter((item) => item.id !== plan.id)].slice(0, OUTBOX_PLANS),
      acks: current.acks,
      goals: current.goals,
      classes: current.classes,
      homework: current.homework,
      homeworkReviews: current.homeworkReviews,
      changeAnswers: current.changeAnswers,
    };
  } catch {
    /* first write */
  }
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  return withLinkPlan(panels, linkId, plan);
}

/**
 * Guardian: change one day of a plan that is still running.
 *
 * A week stays editable while it is open, but only from today onwards: a day
 * that has gone by holds the ticks and the report that answered it, and
 * rewriting it would quietly undo a filing the student already made. The rest
 * of the week moves as the guardian asks, the plan keeps its id so nothing is
 * orphaned, and the student reads what changed as a notice beside the plan.
 */
export async function updatePlanDays(
  panels: Panels,
  linkId: string,
  planId: string,
  edits: PlanDayEdit[],
  today = todayISO(),
): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  const local = link.plans.find((item) => item.id === planId);
  if (!local) throw new LinkError('That plan is no longer available.');

  let outbox: GuardianOutbox = {
    v: 3,
    notices: [],
    plans: [local],
    goals: [],
    acks: [],
    classes: [],
    homework: [],
    homeworkReviews: [],
    changeAnswers: [],
  };
  let plan = local;
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
    // The slot is the shared truth: another guardian may have changed this week
    // already, and it is their version that gets rewritten, not a stale copy.
    plan = current.plans.find((item) => item.id === planId) ?? local;
    outbox = { v: 3, ...current, plans: current.plans.length > 0 ? current.plans : [local] };
  } catch {
    /* first write, or the slot is empty */
  }

  if (plan.approvedAt) throw new LinkError('This period is closed. Nothing in it can change any more.');
  if (edits.length === 0) throw new LinkError('Nothing to change yet.');
  if (edits.some((edit) => !canEditPlanDay(plan, edit.date, today))) {
    throw new LinkError('That day has gone by. Only the rest of the plan can change.');
  }
  const updated = withPlanDaysRewritten(plan, edits, today);
  if (!updated) throw new LinkError('A week plan can hold up to 60 lessons.');
  const summary = edits
    .map((edit) =>
      planDayChangeSummary(edit.date, diffPlanDay(itemsForDay(plan, edit.date), itemsForDay(updated, edit.date))),
    )
    .join(' · ')
    .slice(0, 160);
  const note: Omit<GuardianNotice, 'read'> = {
    id: newId('change'),
    student: link.username,
    author: session.user.displayName || session.user.username,
    summary: summary.slice(0, 160),
    weekOf: weekOf(),
    createdAt: new Date().toISOString(),
    kind: 'note',
  };
  await writeSlot(linkId, link.wrappedShareKey, session.dek, {
    ...outbox,
    notices: [note, ...outbox.notices.filter((item) => item.id !== note.id)].slice(0, OUTBOX_NOTICES),
    plans: [updated, ...outbox.plans.filter((item) => item.id !== planId)].slice(0, OUTBOX_PLANS),
  } satisfies GuardianOutbox);
  // The author sees their own line straight away, marked as read.
  const noticed: Panels = {
    ...panels,
    guardian: {
      ...panels.guardian,
      notices: [{ ...note, read: true }, ...panels.guardian.notices].slice(0, 20),
    },
  };
  return withLinkPlan(noticed, linkId, updated);
}

/**
 * Guardian: answer a student's ask for a change to the plan.
 *
 * Approving makes the change here and on the student's side through the same
 * `applyChangeRequest`, so a week is never half-changed while the two panels
 * catch up with each other. Declining leaves the plan exactly as it was and
 * carries a line back — a refusal with no reason is the one answer a student
 * cannot learn anything from.
 */
export async function answerChangeRequest(
  panels: Panels,
  linkId: string,
  requestId: string,
  decision: 'approved' | 'declined',
  reply = '',
  today = todayISO(),
): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  const request = (link.changeRequests ?? []).find((item) => item.id === requestId);
  if (!request) throw new LinkError('That request is no longer waiting.');
  if (request.state !== 'open') return panels;
  const plan = link.plans.find((item) => item.id === request.planId);
  if (!plan) throw new LinkError('That plan is no longer available.');

  const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
  // The slot is the shared truth, so an approval lands on the week as it
  // actually stands rather than on this device's copy of it.
  const base = current.plans.find((item) => item.id === request.planId) ?? plan;
  let updated = base;
  if (decision === 'approved') {
    const changed = applyChangeRequest(base, request, today);
    if (!changed) {
      throw new LinkError('That ask can no longer be made — the day has gone by, or the lesson is already ticked off.');
    }
    updated = changed;
  }
  const answered = answeredChangeRequest({ ...request, linkId }, decision, reply);
  const note: Omit<GuardianNotice, 'read'> = {
    id: newId('answer'),
    student: link.username,
    author: session.user.displayName || session.user.username,
    summary: `${decision === 'approved' ? t('Change approved: {0}', { 0: request.title }) : t('Change declined: {0}', { 0: request.title })}${
      answered.reply ? ` — ${answered.reply}` : ''
    }`.slice(0, 160),
    weekOf: weekOf(),
    createdAt: new Date().toISOString(),
    kind: 'note',
  };
  await writeSlot(linkId, link.wrappedShareKey, session.dek, {
    v: 3,
    ...current,
    notices: [note, ...current.notices.filter((item) => item.id !== note.id)].slice(0, OUTBOX_NOTICES),
    plans: [updated, ...current.plans.filter((item) => item.id !== updated.id)].slice(0, OUTBOX_PLANS),
    changeAnswers: [answered, ...current.changeAnswers.filter((item) => item.id !== answered.id)].slice(
      0,
      PLAN_CHANGES_WIRE,
    ),
  } satisfies GuardianOutbox);
  const noticed: Panels = {
    ...panels,
    guardian: {
      ...panels.guardian,
      notices: [{ ...note, read: true }, ...panels.guardian.notices].slice(0, 20),
    },
  };
  return withLinkChangeRequests(withLinkPlan(noticed, linkId, updated), linkId, [answered]);
}

/** Guardian: finish an ended period. A week waits for each daily report to be approved. */
export async function approvePlanPeriod(panels: Panels, linkId: string, planId: string): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  const plan = link?.plans.find((item) => item.id === planId);
  if (!link?.wrappedShareKey || !plan) throw new LinkError('That plan is no longer available.');
  if (plan.approvedAt) return panels;
  if (!canApprovePlanPeriod(plan, link.reports ?? [], link.acks ?? [])) {
    throw new LinkError('Wait for this period to end and approve every submitted daily report first.');
  }
  const now = new Date().toISOString();
  const approved: GuardianPlan = { ...plan, approvedAt: now, updatedAt: now };
  const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
  const outbox: GuardianOutbox = {
    v: 3,
    ...current,
    plans: [approved, ...current.plans.filter((item) => item.id !== planId)].slice(0, OUTBOX_PLANS),
  };
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  return withLinkPlan(panels, linkId, approved);
}

export interface ClassDraft {
  title: string;
  subject: string;
  description: string;
  videoUrl: string;
}

/** Guardian: assign one externally-hosted class to exactly one linked student. */
export async function sendClass(panels: Panels, linkId: string, draft: ClassDraft): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey || link.status !== 'linked') throw new LinkError('That student link is not ready yet.');
  const videoUrl = normalizeClassVideoUrl(draft.videoUrl);
  if (!draft.title.trim() || !videoUrl) throw new LinkError('Add a class name and a secure video link.');
  const assignment = sanitizeClassAssignment({
    id: newId('class'),
    linkId,
    author: session.user.displayName || session.user.username,
    title: draft.title,
    subject: draft.subject,
    description: draft.description,
    videoUrl,
    createdAt: new Date().toISOString(),
  });
  if (!assignment) throw new LinkError('That class could not be saved. Check its details and video link.');
  const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
  const outbox: GuardianOutbox = {
    v: 3,
    ...current,
    classes: [assignment, ...current.classes.filter((item) => item.id !== assignment.id)].slice(0, OUTBOX_CLASSES),
  };
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  return withLinkClass(panels, linkId, assignment);
}

/** Guardian: remove this class from the student and the guardian's own assignment list. */
export async function dropClass(panels: Panels, linkId: string, classId: string): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That student link is not ready yet.');
  const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
  await writeSlot(linkId, link.wrappedShareKey, session.dek, {
    v: 3,
    ...current,
    classes: current.classes.filter((item) => item.id !== classId),
  } satisfies GuardianOutbox);
  return withoutLinkClass(panels, linkId, classId);
}

export interface HomeworkDraft {
  title: string;
  instructions: string;
  subject: string;
  dueAt: string | null;
}

/** Student: file one submission for an assigned task; approval later clears photos. */
export function submitHomework(
  panels: Panels,
  assignmentId: string,
  photos: HomeworkPhoto[],
): Panels {
  const assignment = (panels.student.inbox.homework ?? []).find((item) => item.id === assignmentId);
  if (!assignment || panels.student.homeworkSubmissions?.some((item) => item.assignmentId === assignmentId)) return panels;
  if (photos.length < 1 || photos.length > 3) throw new LinkError('Add one to three homework photos.');
  const now = new Date().toISOString();
  const submission = sanitizeHomeworkSubmission({
    id: newId('homework-submission'),
    assignmentId,
    linkId: assignment.linkId,
    photos,
    submittedAt: now,
    status: 'submitted',
    guardianNote: '',
    reviewedAt: null,
  });
  if (!submission || submission.photos.length !== photos.length) throw new LinkError('One of those photos is not valid.');
  return withStudentHomeworkSubmission(panels, submission);
}

/** Guardian: assign optional-deadline homework to exactly one linked student. */
export async function sendHomeworkAssignment(panels: Panels, linkId: string, draft: HomeworkDraft): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey || link.status !== 'linked') throw new LinkError('That student link is not ready yet.');
  const assignment = sanitizeHomeworkAssignment({
    id: newId('homework'),
    linkId,
    author: session.user.displayName || session.user.username,
    title: draft.title,
    instructions: draft.instructions,
    subject: draft.subject,
    dueAt: draft.dueAt,
    createdAt: new Date().toISOString(),
  });
  if (!assignment) throw new LinkError('Add a homework title and check its due time.');
  const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
  const outbox: GuardianOutbox = {
    v: 3,
    ...current,
    homework: [assignment, ...current.homework.filter((item) => item.id !== assignment.id)].slice(0, OUTBOX_HOMEWORK),
  };
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  return withLinkHomework(panels, linkId, assignment);
}

/** Guardian: approve a homework submission only after its encrypted photos are deleted. */
export async function approveHomeworkSubmission(
  panels: Panels,
  linkId: string,
  submissionId: string,
  note: string,
): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey || link.status !== 'linked') throw new LinkError('That student link is not ready yet.');
  const submission = (link.homeworkSubmissions ?? []).find((item) => item.id === submissionId);
  if (!submission) throw new LinkError('That homework submission is no longer available.');
  if (submission.status === 'approved') return panels;
  const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
  const existingReview = current.homeworkReviews.find((item) => item.submissionId === submissionId);
  if (existingReview) return withGuardianHomeworkReview(panels, existingReview);
  await deleteHomeworkPhotoAssets(linkId, submission.photos);
  const review: HomeworkReview = {
    id: newId('homework-review'),
    assignmentId: submission.assignmentId,
    submissionId: submission.id,
    linkId,
    note: note.trim().slice(0, HOMEWORK_NOTE_MAX),
    approvedAt: new Date().toISOString(),
  };
  const cleanReview = sanitizeHomeworkReview(review);
  if (!cleanReview) throw new LinkError('The homework approval could not be saved.');
  const outbox: GuardianOutbox = {
    v: 3,
    ...current,
    homeworkReviews: [cleanReview, ...current.homeworkReviews.filter((item) => item.submissionId !== submissionId)].slice(0, HOMEWORK_ITEMS_KEPT),
  };
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  return withGuardianHomeworkReview(panels, cleanReview);
}

let planQueueFlushing = false;

/**
 * Guardian: send what is waiting, oldest first. One at a time, stopping at
 * the first failure so a dead link cannot eat the plans behind it — and never
 * attempted without a signal. Re-entry returns the panels untouched.
 */
export async function flushPlanQueue(panels: Panels): Promise<Panels> {
  const waiting = panels.guardian.queuedPlans ?? [];
  if (waiting.length === 0 || planQueueFlushing) return panels;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return panels;
  planQueueFlushing = true;
  try {
    let current = panels;
    for (const queued of waiting) {
      try {
        current = withoutQueuedPlan(await sendPlan(current, queued.linkId, queued.draft), queued.id);
      } catch {
        break;
      }
    }
    return current;
  } finally {
    planQueueFlushing = false;
  }
}

export interface GoalDraft {
  title: string;
  /** Why they are asking. Shown to the student, so it is worth writing. */
  note: string;
  /** A date to aim at, or null when there isn't one. */
  target: string | null;
  /** Steps in order. Empty is allowed: a goal can be one line. */
  steps: string[];
}

/**
 * Guardian: suggest a goal. Nothing reaches the student's planner until they
 * agree — this is a question travelling, not work being handed over.
 */
export async function sendGoal(panels: Panels, linkId: string, draft: GoalDraft): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  const title = draft.title.trim().slice(0, 120);
  if (!title) throw new LinkError('Give the goal a name.');

  const goal: GoalSuggestion = {
    id: newId('goal'),
    author: session.user.displayName || session.user.username,
    linkId,
    title,
    note: draft.note.trim().slice(0, 400),
    target: draft.target && /^\d{4}-\d{2}-\d{2}$/.test(draft.target) ? draft.target : null,
    steps: draft.steps
      .map((step) => step.trim().slice(0, 140))
      .filter((step) => step)
      .slice(0, GOAL_STEPS_MAX),
    createdAt: new Date().toISOString(),
  };

  let outbox: GuardianOutbox = { v: 3, notices: [], plans: [], goals: [goal], acks: [], classes: [], homework: [], homeworkReviews: [], changeAnswers: [] };
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
    outbox = {
      v: 3,
      notices: current.notices,
      plans: current.plans,
      goals: [goal, ...current.goals.filter((item) => item.id !== goal.id)].slice(0, OUTBOX_GOALS),
      acks: current.acks,
      classes: current.classes,
      homework: current.homework,
      homeworkReviews: current.homeworkReviews,
      changeAnswers: current.changeAnswers,
    };
  } catch {
    /* first write */
  }
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  return withLinkGoal(panels, linkId, goal);
}

/**
 * Guardian: take a suggestion back. The student's panel drops it on the next
 * pull — and if they had already said yes, the goal they made is theirs and
 * stays.
 */
export async function dropGoal(panels: Panels, linkId: string, goalId: string): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
    await writeSlot(linkId, link.wrappedShareKey, session.dek, {
      v: 3,
      notices: current.notices,
      plans: current.plans,
      goals: current.goals.filter((item) => item.id !== goalId),
      acks: current.acks,
      classes: current.classes,
      homework: current.homework,
      homeworkReviews: current.homeworkReviews,
      changeAnswers: current.changeAnswers,
    } satisfies GuardianOutbox);
  } catch {
    /* dropping locally is still the right outcome */
  }
  return withoutLinkGoal(panels, linkId, goalId);
}

/** Guardian: take a plan back (the student's panel drops it on the next pull). */
export async function dropPlan(panels: Panels, linkId: string, planId: string): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
    await writeSlot(linkId, link.wrappedShareKey, session.dek, {
      v: 3,
      notices: current.notices,
      plans: current.plans.filter((item) => item.id !== planId),
      acks: current.acks,
      goals: current.goals,
      classes: current.classes,
      homework: current.homework,
      homeworkReviews: current.homeworkReviews,
      changeAnswers: [],
    } satisfies GuardianOutbox);
  } catch {
    /* dropping locally is still the right outcome */
  }
  return withoutLinkPlan(panels, linkId, planId);
}

/**
 * Guardian: answer a daily report — seen, with a line back when there is
 * something to say. The report it points at stays exactly as the student
 * filed it.
 */
export async function sendAck(
  panels: Panels,
  linkId: string,
  draft: { reportId: string; planId: string; date: string; text: string; reactions?: string[]; id?: string; approve?: boolean },
): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  const localPrevious = (link.acks ?? []).find((item) => item.reportId === draft.reportId);
  const report = (link.reports ?? []).find((item) => item.id === draft.reportId);
  if (!report || report.planId !== draft.planId || report.date !== draft.date || report.linkId !== linkId) {
    throw new LinkError('That daily report could not be found. Sync and try again.');
  }
  // Read the canonical encrypted outbox before every write. A stale second
  // guardian device must not be able to change a day that has been approved.
  const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
  const remotePrevious = current.acks.find((item) => item.reportId === draft.reportId);
  if (localPrevious?.approvedAt || remotePrevious?.approvedAt) throw new LinkError('This approved daily report is locked.');
  const previous = remotePrevious ?? localPrevious;
  const now = new Date().toISOString();
  const ack: ReportAck = {
    // One answer per submitted report: replies, reactions and approval update
    // the same record instead of creating conflicting decisions.
    id: draft.id?.slice(0, 80) || previous?.id || newId('ack'),
    reportId: draft.reportId.slice(0, 80),
    planId: draft.planId.slice(0, 80),
    linkId,
    date: draft.date,
    text: draft.text.trim().slice(0, ACK_TEXT_MAX) || previous?.text || '',
    reactions: draft.reactions ? sanitizeReactions(draft.reactions) : previous?.reactions ?? [],
    approvedAt: draft.approve ? now : previous?.approvedAt ?? null,
    createdAt: previous?.createdAt ?? now,
  };
  const outbox: GuardianOutbox = {
    v: 3,
    ...current,
    acks: [ack, ...current.acks.filter((item) => item.reportId !== ack.reportId)].slice(0, DAY_REPORTS_WIRE),
  };
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  return withLinkAck(panels, linkId, ack);
}

/**
 * Student: collect what the guardians left (notices and plans), pass each
 * guardian's note to the others, and send everyone the ticks for their own
 * plans. Only the student holds every link's key, so they are the only one who
 * can translate a note from one guardian into the other's language.
 */
export async function syncStudentInbox(
  panels: Panels,
  /**
   * The student's goals, so a goal they took on can report how far it has got.
   * Optional because the caller may only have the panels to hand; without it,
   * answers already recorded are still sent.
   */
  goals: Goal[] = [],
): Promise<{ panels: Panels; added: { notices: GuardianNotice[]; plans: GuardianPlan[]; goals: GoalSuggestion[] }; relayed: number; changed: boolean }> {
  const session = await requireSession();
  const guardians = panels.student.guardians;
  if (guardians.length === 0) return { panels, added: { notices: [], plans: [], goals: [] }, relayed: 0, changed: false };

  let notices = panels.student.inbox.notices;
  const deletedPlanIds = new Set(panels.student.deletedPlanIds ?? []);
  let plans = panels.student.inbox.plans.filter((plan) => !deletedPlanIds.has(plan.id));
  let acks = panels.student.acks ?? [];
  let suggestions = panels.student.inbox.goals ?? [];
  let classes = panels.student.inbox.classes ?? [];
  let homework = panels.student.inbox.homework ?? [];
  let classProgress = panels.student.classProgress ?? [];
  let homeworkSubmissions = panels.student.homeworkSubmissions ?? [];
  let praise = panels.student.praise ?? [];
  let changeRequests = panels.student.changeRequests ?? [];
  let changed = plans.length !== panels.student.inbox.plans.length;
  const added: { notices: GuardianNotice[]; plans: GuardianPlan[]; goals: GoalSuggestion[] } = { notices: [], plans: [], goals: [] };

  for (const source of guardians) {
    let outbox: Omit<GuardianOutbox, 'v'>;
    try {
      outbox = asGuardianOutbox(await readSlot(source.linkId, source.wrappedShareKey, session.dek));
    } catch {
      continue;
    }
    for (const notice of outbox.notices) {
      // Tag the id with its source link, so relays stay deduplicated.
      const id = `${notice.id}-${source.linkId.slice(0, 4)}`;
      if (notices.some((item) => item.id === id)) continue;
      const received: GuardianNotice = { ...notice, id, student: session.user.username, read: false };
      notices = [received, ...notices];
      added.notices.push(received);
      changed = true;
      // Praise is kept as well as delivered: it is the one message worth
      // reading twice, and the inbox is not — twenty notes and it is gone.
      if (received.kind === 'praise' && !(panels.student.praise ?? []).some((item) => item.id === id)) {
        praise = [{ ...received, read: true }, ...praise];
        changed = true;
      }
    }
    for (const plan of outbox.plans) {
      if (deletedPlanIds.has(plan.id)) continue;
      const existing = plans.find((item) => item.id === plan.id);
      if (!existing) {
        plans = [plan, ...plans];
        added.plans.push(plan);
        changed = true;
        continue;
      }
      if (plan.updatedAt === existing.updatedAt) continue;
      // The guardian edited it: take their items but keep finished ticks.
      const done = new Set(existing.items.filter((item) => item.done).map((item) => item.id));
      const merged: GuardianPlan = {
        ...plan,
        items: plan.items.map((item) => (done.has(item.id) ? { ...item, done: true } : item)),
      };
      plans = plans.map((item) => (item.id === plan.id ? merged : item));
      changed = true;
    }
    const assignedClasses = outbox.classes
      .filter((item) => item.linkId === source.linkId)
      .map((item) => ({ ...item, linkId: source.linkId }));
    for (const assignment of assignedClasses) {
      const existing = classes.find((item) => item.id === assignment.id);
      if (existing && JSON.stringify(existing) === JSON.stringify(assignment)) continue;
      classes = [assignment, ...classes.filter((item) => item.id !== assignment.id)];
      changed = true;
    }
    const offeredClassIds = new Set(assignedClasses.map((item) => item.id));
    const keptClasses = classes.filter((item) => item.linkId !== source.linkId || offeredClassIds.has(item.id));
    if (keptClasses.length !== classes.length) {
      classes = keptClasses;
      classProgress = classProgress.filter((item) => item.linkId !== source.linkId || offeredClassIds.has(item.classId));
      changed = true;
    }
    const assignedHomework = outbox.homework
      .filter((item) => item.linkId === source.linkId)
      .map((item) => ({ ...item, linkId: source.linkId }));
    for (const assignment of assignedHomework) {
      const existing = homework.find((item) => item.id === assignment.id);
      if (existing && JSON.stringify(existing) === JSON.stringify(assignment)) continue;
      homework = [assignment, ...homework.filter((item) => item.id !== assignment.id)];
      changed = true;
    }
    const offeredHomeworkIds = new Set(assignedHomework.map((item) => item.id));
    const keptHomework = homework.filter((item) => item.linkId !== source.linkId || offeredHomeworkIds.has(item.id));
    if (keptHomework.length !== homework.length) {
      homework = keptHomework;
      changed = true;
    }
    for (const review of outbox.homeworkReviews.filter((item) => item.linkId === source.linkId)) {
      const previous = homeworkSubmissions.find((item) => item.id === review.submissionId);
      if (!previous) continue;
      const approved: HomeworkSubmission = {
        ...previous,
        status: 'approved',
        photos: [],
        guardianNote: review.note,
        reviewedAt: review.approvedAt,
      };
      if (JSON.stringify(previous) !== JSON.stringify(approved)) {
        homeworkSubmissions = homeworkSubmissions.map((item) => item.id === approved.id ? approved : item);
        changed = true;
      }
    }
    for (const goal of outbox.goals) {
      // Answered suggestions are kept, not dropped: the answer has to keep
      // travelling back until the guardian takes the suggestion away. Hiding
      // them is the panel's job, not the wire's.
      if (suggestions.some((item) => item.id === goal.id)) continue;
      suggestions = [{ ...goal, linkId: source.linkId }, ...suggestions];
      added.goals.push(goal);
      changed = true;
    }
    // One the guardian withdrew disappears again.
    const offered = new Set(outbox.goals.map((item) => item.id));
    const kept = suggestions.filter((item) => item.linkId !== source.linkId || offered.has(item.id));
    if (kept.length !== suggestions.length) {
      suggestions = kept;
      changed = true;
    }
    // A plan the guardian took back disappears too — the promise dropPlan
    // makes, kept here where the student's panel actually listens.
    const offeredPlans = new Set(outbox.plans.map((item) => item.id));
    const keptPlans = plans.filter((item) => item.linkId !== source.linkId || offeredPlans.has(item.id));
    if (keptPlans.length !== plans.length) {
      plans = keptPlans;
      changed = true;
    }
    // Answers to daily reports land beside the reports they answer.
    if (outbox.acks.length > 0) {
      const merged = mergeAcks(acks, outbox.acks.filter((entry) => entry.linkId === source.linkId));
      if (JSON.stringify(merged) !== JSON.stringify(acks)) {
        acks = merged;
        changed = true;
      }
    }
    // An answer to a change request lands on the ask it answers, so the student
    // reads an approval or a decline where they asked the question.
    if (outbox.changeAnswers.length > 0) {
      const merged = mergeChangeRequests(
        changeRequests,
        outbox.changeAnswers.filter((entry) => entry.linkId === source.linkId),
      );
      if (JSON.stringify(merged) !== JSON.stringify(changeRequests)) {
        changeRequests = merged;
        changed = true;
      }
    }
  }

  notices = notices.slice(0, 20);
  plans = plans.slice(0, 10);
  suggestions = suggestions.slice(0, PANEL_GOALS_KEPT * 2);
  praise = praise.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, PRAISE_KEPT);

  // Everyone gets a full-state outbox: what the others said, and the ticks for
  // their own plans. One guardian being offline never blocks the rest.
  let relayed = 0;
  for (const target of guardians) {
    const tag = `-${target.linkId.slice(0, 4)}`;
    const passed = notices
      .filter((notice) => !notice.id.endsWith(tag))
      .slice(0, OUTBOX_NOTICES)
      .map(({ read: _read, ...rest }) => rest);
    const progress: PlanTick[] = plans
      .filter((plan) => plan.linkId === target.linkId)
      .map((plan) => ({
        planId: plan.id,
        doneIds: plan.items.filter((item) => item.done).map((item) => item.id),
        updatedAt: new Date().toISOString(),
      }));
    // Goals this guardian suggested: how far the student has got. Counts only —
    // they wrote the steps, but the goal is the student's now.
    const answers: GoalAnswer[] = suggestions
      .filter((suggestion) => suggestion.linkId === target.linkId)
      .flatMap((suggestion): GoalAnswer[] => {
        const goal = goals.find((item) => item.fromSuggestion?.suggestionId === suggestion.id);
        if (goal) {
          return [{
            suggestionId: suggestion.id,
            state: 'accepted' as const,
            done: goal.milestones.filter((step) => step.completed).length,
            total: goal.milestones.length,
            updatedAt: goal.updatedAt,
          }];
        }
        const remembered = (panels.student.goalAnswers ?? []).find((item) => item.suggestionId === suggestion.id);
        return remembered ? [remembered] : [];
      })
      .slice(0, GOAL_ANSWERS_KEPT);
    // Daily reports for this guardian's plans ride along — the newest first.
    const reports = (panels.student.reports ?? [])
      .filter((entry) => entry.linkId === target.linkId)
      .slice(0, DAY_REPORTS_WIRE);
    const classProgressForLink = classProgress
      .filter((entry) => entry.linkId === target.linkId)
      .slice(0, OUTBOX_CLASSES);
    const homeworkSubmissionsForLink = homeworkSubmissions
      .filter((entry) => entry.linkId === target.linkId)
      .slice(0, HOMEWORK_ITEMS_KEPT);
    // Open asks for a week plan keep travelling until they go stale.
    const requests = openRequests(panels.student.requests ?? [])
      .filter((entry) => entry.linkId === target.linkId)
      .slice(-PLAN_REQUESTS_WIRE);
    // Asks for one change to a plan travel until they go stale too. An answered
    // one keeps riding along a little longer, so a second guardian device sees
    // the decision rather than an ask nobody has answered.
    const changes = openChangeRequests(changeRequests)
      .filter((entry) => entry.linkId === target.linkId)
      .slice(-PLAN_CHANGES_WIRE);
    const outbox: StudentOutbox = {
      v: 3,
      relayed: passed,
      progress,
      answers,
      reports,
      classProgress: classProgressForLink,
      homeworkSubmissions: homeworkSubmissionsForLink,
      requests,
      changes,
    };
    try {
      await writeSlot(target.linkId, target.wrappedShareKey, session.dek, outbox);
      relayed += passed.length;
    } catch {
      /* best effort */
    }
  }

  return {
    panels: {
      ...panels,
      student: {
        ...panels.student,
        inbox: { notices, plans, goals: suggestions, classes, homework },
        praise,
        acks,
        classProgress,
        homeworkSubmissions,
        changeRequests: changeRequests.slice(0, PLAN_CHANGES_KEPT),
      },
    },
    added,
    relayed,
    changed,
  };
}

/** Guardian: pick up whatever the others left for you, and the plan ticks. */
export async function readNotices(panels: Panels): Promise<{ panels: Panels; changed: boolean }> {
  const session = await requireSession();
  const known = new Set(panels.guardian.notices.map((notice) => notice.id));
  const found: GuardianNotice[] = [];
  let changed = false;

  const links = [...panels.guardian.links];

  for (let index = 0; index < links.length; index += 1) {
    // Re-read each time: the loop updates the entry as answers land on it.
    let link = links[index]!;
    if (link.status !== 'linked' || !link.linkId || !link.wrappedShareKey) continue;
    let outbox: Omit<StudentOutbox, 'v'>;
    try {
      outbox = asStudentOutbox(await readSlot(link.linkId, link.wrappedShareKey, session.dek));
    } catch {
      /* an unreadable outbox is skipped, not fatal */
      continue;
    }
    for (const note of outbox.relayed) {
      if (!note.summary || known.has(note.id)) continue;
      found.push({ ...note, student: note.student || link.username, read: false });
    }
    for (const request of outbox.requests) {
      if (request.linkId !== link.linkId) continue;
      const notice = requestNotice(request, link.displayName, link.username);
      if (known.has(notice.id)) continue;
      found.push(notice);
    }
    // An ask to change a plan is worth a line in the roster: it is waiting on
    // this guardian, and only an open one is — an answered ask is history.
    for (const request of outbox.changes) {
      if (request.linkId !== link.linkId || request.state !== 'open') continue;
      const notice = changeRequestNotice(request, link.displayName, link.username);
      if (known.has(notice.id)) continue;
      found.push(notice);
    }
    if (outbox.changes.length > 0) {
      const merged = mergeChangeRequests(
        link.changeRequests ?? [],
        outbox.changes.filter((entry) => entry.linkId === link.linkId),
      );
      if (JSON.stringify(merged) !== JSON.stringify(link.changeRequests ?? [])) {
        changed = true;
        links[index] = { ...link, changeRequests: merged };
        link = links[index]!;
      }
    }
    // Ticks land back on the plans they belong to.
    if ((outbox.progress.length > 0 || outbox.reports.length > 0) && link.plans.length > 0) {
      const incomingReports = outbox.reports.filter((report) => report.linkId === link.linkId);
      const syncedReports = mergeLinkReports(link.reports ?? [], incomingReports);
      const plans = link.plans.map((plan) => {
        if (plan.approvedAt) return plan;
        const tick = outbox.progress.find((item) => item.planId === plan.id);
        const reportsByDate = new Map(
          syncedReports.filter((report) => report.planId === plan.id).map((report) => [report.date, new Set(report.doneIds)]),
        );
        if (!tick && reportsByDate.size === 0) return plan;
        const done = tick ? new Set(tick.doneIds) : null;
        const next: GuardianPlan = {
          ...plan,
          items: plan.items.map((item) => {
            if (!item.date) return item;
            const filed = reportsByDate.get(item.date);
            if (filed) return { ...item, done: filed.has(item.id) };
            return done ? { ...item, done: done.has(item.id) } : item;
          }),
        };
        return next;
      });
      if (JSON.stringify(plans) !== JSON.stringify(link.plans)) {
        changed = true;
        links[index] = { ...link, plans };
        link = links[index]!;
      }
    }
    // Answers land on the suggestions they belong to. Only counts come back:
    // the guardian learns whether the goal moved, not what the student made of it.
    if (outbox.answers.length > 0) {
      const answers = [...outbox.answers];
      const goalAnswers = [
        ...(link.goalAnswers ?? []).map((item) => answers.find((answer) => answer.suggestionId === item.suggestionId) ?? item),
        ...answers.filter((answer) => !(link.goalAnswers ?? []).some((item) => item.suggestionId === answer.suggestionId)),
      ].slice(0, GOAL_ANSWERS_KEPT);
      if (JSON.stringify(goalAnswers) !== JSON.stringify(link.goalAnswers ?? [])) {
        changed = true;
        links[index] = { ...link, goalAnswers };
        link = links[index]!;
      }
    }
    // Daily reports land on the link they were written for.
    if (outbox.reports.length > 0) {
      const merged = mergeLinkReports(link.reports ?? [], outbox.reports.filter((entry) => entry.linkId === link.linkId));
      if (JSON.stringify(merged) !== JSON.stringify(link.reports ?? [])) {
        changed = true;
        links[index] = { ...link, reports: merged };
        link = links[index]!;
      }
    }
    if (outbox.classProgress.length > 0) {
      const progressByClass = new Map((link.classProgress ?? []).map((item) => [item.classId, item]));
      const assignedIds = new Set((link.classes ?? []).map((item) => item.id));
      for (const progress of outbox.classProgress) {
        if (progress.linkId !== link.linkId || !assignedIds.has(progress.classId)) continue;
        const previous = progressByClass.get(progress.classId);
        if (!previous || progress.updatedAt >= previous.updatedAt) progressByClass.set(progress.classId, progress);
      }
      const classProgress = [...progressByClass.values()].slice(-OUTBOX_CLASSES);
      if (JSON.stringify(classProgress) !== JSON.stringify(link.classProgress ?? [])) {
        changed = true;
        links[index] = { ...link, classProgress };
        link = links[index]!;
      }
    }
    if (outbox.homeworkSubmissions.length > 0) {
      const assignmentIds = new Set((link.homework ?? []).map((item) => item.id));
      const submissionsById = new Map((link.homeworkSubmissions ?? []).map((item) => [item.id, item]));
      for (const incoming of outbox.homeworkSubmissions) {
        if (incoming.linkId !== link.linkId || !assignmentIds.has(incoming.assignmentId)) continue;
        const prior = submissionsById.get(incoming.id);
        const review = (link.homeworkReviews ?? []).find((item) => item.submissionId === incoming.id);
        const clean: HomeworkSubmission = review || prior?.status === 'approved'
          ? {
              ...incoming,
              status: 'approved',
              photos: [],
              guardianNote: review?.note ?? prior?.guardianNote ?? '',
              reviewedAt: review?.approvedAt ?? prior?.reviewedAt ?? null,
            }
          : incoming;
        submissionsById.set(clean.id, clean);
      }
      const homeworkSubmissions = [...submissionsById.values()]
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .slice(0, HOMEWORK_ITEMS_KEPT);
      if (JSON.stringify(homeworkSubmissions) !== JSON.stringify(link.homeworkSubmissions ?? [])) {
        changed = true;
        links[index] = { ...link, homeworkSubmissions };
        link = links[index]!;
      }
    }
  }

  if (found.length > 0) {
    changed = true;
  }
  const notices = [...found, ...panels.guardian.notices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  return {
    panels: {
      ...panels,
      guardian: {
        ...panels.guardian,
        links: [...links],
        notices: found.length > 0 ? notices : panels.guardian.notices,
      },
    },
    changed,
  };
}

/**
 * Student: let go of one piece of praise. Kept words are theirs to keep or not
 * — including the ones that have stopped helping.
 */
export function forgetPraise(panels: Panels, praiseId: string): Panels {
  if (!(panels.student.praise ?? []).some((item) => item.id === praiseId)) return panels;
  return {
    ...panels,
    student: { ...panels.student, praise: (panels.student.praise ?? []).filter((item) => item.id !== praiseId) },
  };
}

/** Guardian: mark every notice as read. */
export function markNoticesRead(panels: Panels): Panels {
  if (panels.guardian.notices.every((notice) => notice.read)) return panels;
  return {
    ...panels,
    guardian: { ...panels.guardian, notices: panels.guardian.notices.map((notice) => ({ ...notice, read: true })) },
  };
}

/* ----------------------------------------------------------------- student */

/** Student: redeem the code a guardian gave them. */
export async function acceptInvitation(panels: Panels, code: string): Promise<Panels> {
  const session = await requireSession();
  let result: AcceptLinkResponse;
  try {
    result = await request<AcceptLinkResponse>('/api/auth/link-accept', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim() }),
    });
  } catch (caught) {
    // Distinct from a typo, and worth its own sentence: retyping will never
    // work, and "check the code" would send someone hunting for a mistake
    // that is not there. Ask for a new invitation instead.
    if (caught instanceof AuthError && caught.code === 'invite_expired') {
      throw new LinkError(t('That invitation is too old to use. Ask for a new code.'));
    }
    throw caught;
  }

  const codeKey = await keyFromLinkCode(code);
  const raw = await unwrapKeyRaw(result.wrappedShare, codeKey);
  const shareKey = await importDek(raw, true);
  const wrappedShareKey = await wrapKey(shareKey, session.dek);
  raw.fill(0);

  const guardian: StudentGuardian = {
    linkId: result.linkId,
    guardianUsername: result.guardianUsername,
    guardianDisplayName: result.guardianDisplayName || result.guardianUsername,
    wrappedShareKey,
    sharedWeek: null,
  };
  if (panels.student.guardians.some((item) => item.linkId === guardian.linkId)) return panels;
  return { ...panels, student: { ...panels.student, guardians: [...panels.student.guardians, guardian] } };
}

/**
 * Student: say yes or not now to a suggested goal.
 *
 * The answer goes out on the next sync. Saying yes does not itself create
 * anything in the planner — the caller does that, so the goal is made exactly
 * the way every other goal is made, and can be undone like one.
 */
export function answerGoalSuggestion(panels: Panels, suggestion: GoalSuggestion, state: 'accepted' | 'declined'): Panels {
  // Already answered: the second click on a slow panel must not flip the answer.
  const prior = (panels.student.goalAnswers ?? []).find((item) => item.suggestionId === suggestion.id);
  if (prior?.state === state) return panels;
  return withGoalAnswer(panels, {
    suggestionId: suggestion.id,
    state,
    done: 0,
    total: 0,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Student: send this week's results to everyone they accepted. Results only —
 * counts, focused minutes, and the headline they chose to explain a change.
 */
export async function shareWeeklyResults(
  state: PlannerState,
  panels: Panels,
  force = false,
  week = weekOf(),
): Promise<{ panels: Panels; sent: number }> {
  const session = await requireSession();
  if (panels.student.guardians.length === 0) return { panels, sent: 0 };

  const results = weekResults(state, week);
  let sent = 0;
  const guardians: StudentGuardian[] = [];
  for (const guardian of panels.student.guardians) {
    if (!force && guardian.sharedWeek === week) {
      guardians.push(guardian);
      continue;
    }
    try {
      const raw = await unwrapKeyRaw(guardian.wrappedShareKey, session.dek);
      const key = await importDek(raw, false);
      const payload = await encryptJson(results, key);
      raw.fill(0);
      await request('/api/auth/share', {
        method: 'PUT',
        body: JSON.stringify({ linkId: guardian.linkId, ciphertext: payload, weekOf: week }),
      });
      sent += 1;
      guardians.push({ ...guardian, sharedWeek: week });
    } catch {
      guardians.push(guardian);
    }
  }
  // Same object when nothing moved, so callers can skip saving.
  return { panels: sent === 0 ? panels : { ...panels, student: { ...panels.student, guardians } }, sent };
}

/* ------------------------------------------------------------------- both */

/** Reconciles local records with the server: accepted, revoked, or still waiting. */
export async function syncLinks(panels: Panels): Promise<{ panels: Panels; changed: boolean }> {
  const session = await requireSession();
  const result = await request<LinksResponse>('/api/auth/links');
  let changed = false;

  const byId = new Map(result.outgoing.map((link) => [link.id, link]));
  const links = panels.guardian.links.map((link) => {
    const remote = link.linkId ? byId.get(link.linkId) : undefined;
    if (!remote) return link; // still pending locally, or removed on both sides
    const status = remote.status === 'linked' ? ('linked' as const) : ('pending' as const);
    if (status !== link.status) changed = true;
    // The code has served its purpose once the student has accepted.
    const code = status === 'linked' ? null : link.code;
    if (code !== link.code) changed = true;
    const expiresAt = status === 'linked' ? null : remote.expiresAt ?? link.expiresAt ?? null;
    if (expiresAt !== link.expiresAt) changed = true;
    return { ...link, status, code, expiresAt };
  });

  // /links lists both waiting invitations and accepted ones, so a guardian who
  // ended the link disappears from here too.
  const studentIds = new Set(result.incoming.map((link) => link.id));
  const guardians = panels.student.guardians.filter((guardian) => {
    if (studentIds.has(guardian.linkId)) return true;
    changed = true;
    return false;
  });
  void session;

  return {
    panels: {
      ...panels,
      guardian: { ...panels.guardian, links },
      student: { ...panels.student, guardians },
    },
    changed,
  };
}
