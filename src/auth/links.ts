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
import { newId, weekOf, weekResults, withGoalAnswer, withLinkGoal, withLinkPlan, withoutLinkGoal, withoutLinkPlan } from '../panels';
import { t } from '../i18n';
import { GOAL_ANSWERS_KEPT, GOAL_STEPS_MAX, PANEL_GOALS_KEPT, PRAISE_KEPT } from '../types';
import type { Goal, GoalAnswer, GoalSuggestion, GuardianLink, GuardianNotice, GuardianPlan, Panels, PlanItem, PlannerState, StudentGuardian, WeekResults, WeekSubjectMinutes } from '../types';
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
 *   note_to_guardian — the student's outbox: plan ticks, plus whatever the
 *                      other guardians said, so the adults stay in step
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
}

interface StudentOutbox {
  v: 3;
  relayed: Array<Omit<GuardianNotice, 'read'>>;
  progress: PlanTick[];
  /** How the suggested goals were answered, and how far each has got. */
  answers: GoalAnswer[];
}

const OUTBOX_PLANS = 5;
const OUTBOX_NOTICES = 10;
const PLAN_ITEMS_MAX = 40;
const OUTBOX_GOALS = 5;

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
    kind: raw.kind === 'praise' ? 'praise' : 'note',
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
        minutes: typeof entry.minutes === 'number' && Number.isFinite(entry.minutes) ? Math.max(0, Math.round(entry.minutes)) : null,
        subject: typeof entry.subject === 'string' && entry.subject.trim() ? entry.subject.trim().slice(0, 60) : null,
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
    items,
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
function asGuardianOutbox(payload: unknown): { notices: Array<Omit<GuardianNotice, 'read'>>; plans: GuardianPlan[]; goals: GoalSuggestion[] } {
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
  return { notices, plans, goals };
}

/** The student's outbox for one link; a legacy relayed note folds in too. */
function asStudentOutbox(payload: unknown): { relayed: Array<Omit<GuardianNotice, 'read'>>; progress: PlanTick[]; answers: GoalAnswer[] } {
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
  return { relayed, progress, answers };
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

async function postToStudent(
  panels: Panels,
  linkId: string,
  summary: string,
  kind: 'note' | 'praise',
): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  const text = summary.trim().slice(0, 160);
  if (!text) return panels;

  const note = {
    id: newId(kind === 'praise' ? 'praise' : 'note'),
    student: link.username,
    author: session.user.displayName || session.user.username,
    summary: text,
    weekOf: weekOf(),
    createdAt: new Date().toISOString(),
    kind,
  };
  // Full-state write: whatever plans and goals are already out there must survive.
  let outbox: GuardianOutbox = { v: 3, notices: [note], plans: [], goals: [] };
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
    outbox = {
      v: 3,
      notices: [note, ...current.notices.filter((item) => item.id !== note.id)].slice(0, OUTBOX_NOTICES),
      plans: current.plans,
      goals: current.goals,
    };
  } catch {
    /* first write, or the slot is empty */
  }
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  // The author sees their own words straight away, marked as read.
  const notice: GuardianNotice = { ...note, read: true };
  return { ...panels, guardian: { ...panels.guardian, notices: [notice, ...panels.guardian.notices].slice(0, 20) } };
}

export interface PlanDraft {
  cadence: GuardianPlan['cadence'];
  /** First day the plan covers (ISO). */
  start: string;
  title: string;
  note: string;
  items: Array<Pick<PlanItem, 'title' | 'date' | 'minutes' | 'subject'>>;
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
    items: draft.items.slice(0, PLAN_ITEMS_MAX).map((item) => ({
      id: newId('item'),
      title: item.title.trim().slice(0, 120),
      date: item.date ?? null,
      minutes: item.minutes,
      subject: item.subject?.trim() ? item.subject.trim().slice(0, 60) : null,
      done: false,
    })),
    createdAt: now,
    updatedAt: now,
  };

  let outbox: GuardianOutbox = { v: 3, notices: [], plans: [plan], goals: [] };
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
    outbox = {
      v: 3,
      notices: current.notices,
      plans: [plan, ...current.plans.filter((item) => item.id !== plan.id)].slice(0, OUTBOX_PLANS),
      goals: current.goals,
    };
  } catch {
    /* first write */
  }
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  return withLinkPlan(panels, linkId, plan);
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

  let outbox: GuardianOutbox = { v: 3, notices: [], plans: [], goals: [goal] };
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek, true));
    outbox = {
      v: 3,
      notices: current.notices,
      plans: current.plans,
      goals: [goal, ...current.goals.filter((item) => item.id !== goal.id)].slice(0, OUTBOX_GOALS),
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
      goals: current.goals,
    } satisfies GuardianOutbox);
  } catch {
    /* dropping locally is still the right outcome */
  }
  return withoutLinkPlan(panels, linkId, planId);
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
  let plans = panels.student.inbox.plans;
  let suggestions = panels.student.inbox.goals ?? [];
  let praise = panels.student.praise ?? [];
  let changed = false;
  const added: { notices: GuardianNotice[]; plans: GuardianPlan[]; goals: GoalSuggestion[] } = { notices: [], plans: [], goals: [] };

  for (const source of guardians) {
    let outbox: { notices: Array<Omit<GuardianNotice, 'read'>>; plans: GuardianPlan[]; goals: GoalSuggestion[] };
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
    const outbox: StudentOutbox = { v: 3, relayed: passed, progress, answers };
    try {
      await writeSlot(target.linkId, target.wrappedShareKey, session.dek, outbox);
      relayed += passed.length;
    } catch {
      /* best effort */
    }
  }

  return {
    panels: { ...panels, student: { ...panels.student, inbox: { notices, plans, goals: suggestions }, praise } },
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
    let outbox: { relayed: Array<Omit<GuardianNotice, 'read'>>; progress: PlanTick[]; answers: GoalAnswer[] };
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
    // Ticks land back on the plans they belong to.
    if (outbox.progress.length > 0 && link.plans.length > 0) {
      const plans = link.plans.map((plan) => {
        const tick = outbox.progress.find((item) => item.planId === plan.id);
        if (!tick) return plan;
        const done = new Set(tick.doneIds);
        const next: GuardianPlan = {
          ...plan,
          items: plan.items.map((item) => ({ ...item, done: done.has(item.id) })),
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
