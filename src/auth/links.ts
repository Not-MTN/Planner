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
import { getActiveSession, request } from './session';
import { newId, weekOf, weekResults, withLinkPlan, withoutLinkPlan } from '../panels';
import { t } from '../i18n';
import type { GuardianLink, GuardianNotice, GuardianPlan, Panels, PlanItem, PlannerState, StudentGuardian, WeekResults, WeekSubjectMinutes } from '../types';
/** Matches the cap in storage.ts, so the vault and the view agree. */
const WEEKS_KEPT = 12;
import type { AcceptLinkResponse, LinksResponse, ShareResponse } from '../shared/authContract';

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

  const result = await request<{ link: { id: string } }>('/api/auth/links', {
    method: 'POST',
    body: JSON.stringify({ username: clean, codeHash: await linkCodeHash(code), wrappedShare }),
  });

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
  };
  return {
    panels: { ...panels, guardian: { ...panels.guardian, links: [...panels.guardian.links, link] } },
    invitation: { link, code },
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
  v: 2;
  notices: Array<Omit<GuardianNotice, 'read'>>;
  plans: GuardianPlan[];
}

interface StudentOutbox {
  v: 2;
  relayed: Array<Omit<GuardianNotice, 'read'>>;
  progress: PlanTick[];
}

const OUTBOX_PLANS = 5;
const OUTBOX_NOTICES = 10;
const PLAN_ITEMS_MAX = 40;

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

async function readSlot(linkId: string, wrappedShareKey: string, dek: CryptoKey): Promise<unknown> {
  const key = await shareKeyFor(dek, wrappedShareKey);
  const incoming = await request<{ ciphertext: string | null }>(`/api/auth/note?linkId=${encodeURIComponent(linkId)}`);
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
function asGuardianOutbox(payload: unknown): { notices: Array<Omit<GuardianNotice, 'read'>>; plans: GuardianPlan[] } {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const legacy = wireNotice(payload);
  const notices = [
    ...(Array.isArray(raw.notices) ? raw.notices.flatMap((item) => (wireNotice(item) ? [wireNotice(item)!] : [])) : []),
    ...(legacy && !Array.isArray(raw.notices) ? [legacy] : []),
  ].slice(0, OUTBOX_NOTICES);
  const plans = (Array.isArray(raw.plans) ? raw.plans : [])
    .flatMap((item) => (wirePlan(item) ? [wirePlan(item)!] : []))
    .slice(0, OUTBOX_PLANS);
  return { notices, plans };
}

/** The student's outbox for one link; a legacy relayed note folds in too. */
function asStudentOutbox(payload: unknown): { relayed: Array<Omit<GuardianNotice, 'read'>>; progress: PlanTick[] } {
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
  return { relayed, progress };
}

/**
 * Guardian: tell the student and the other adults following them what you
 * changed. The note lands in the student's inbox and in their next relay.
 */
export async function postNotice(panels: Panels, linkId: string, summary: string): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  const text = summary.trim().slice(0, 160);
  if (!text) return panels;

  const note = {
    id: newId('note'),
    student: link.username,
    author: session.user.displayName || session.user.username,
    summary: text,
    weekOf: weekOf(),
    createdAt: new Date().toISOString(),
  };
  // Full-state write: whatever plans are already out there must survive.
  let outbox: GuardianOutbox = { v: 2, notices: [note], plans: [] };
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek));
    outbox = {
      v: 2,
      notices: [note, ...current.notices.filter((item) => item.id !== note.id)].slice(0, OUTBOX_NOTICES),
      plans: current.plans,
    };
  } catch {
    /* first write, or the slot is empty */
  }
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  // The author sees their own note straight away, marked as read.
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

  let outbox: GuardianOutbox = { v: 2, notices: [], plans: [plan] };
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek));
    outbox = {
      v: 2,
      notices: current.notices,
      plans: [plan, ...current.plans.filter((item) => item.id !== plan.id)].slice(0, OUTBOX_PLANS),
    };
  } catch {
    /* first write */
  }
  await writeSlot(linkId, link.wrappedShareKey, session.dek, outbox);
  return withLinkPlan(panels, linkId, plan);
}

/** Guardian: take a plan back (the student's panel drops it on the next pull). */
export async function dropPlan(panels: Panels, linkId: string, planId: string): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  try {
    const current = asGuardianOutbox(await readSlot(linkId, link.wrappedShareKey, session.dek));
    await writeSlot(linkId, link.wrappedShareKey, session.dek, {
      v: 2,
      notices: current.notices,
      plans: current.plans.filter((item) => item.id !== planId),
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
): Promise<{ panels: Panels; added: { notices: GuardianNotice[]; plans: GuardianPlan[] }; relayed: number; changed: boolean }> {
  const session = await requireSession();
  const guardians = panels.student.guardians;
  if (guardians.length === 0) return { panels, added: { notices: [], plans: [] }, relayed: 0, changed: false };

  let notices = panels.student.inbox.notices;
  let plans = panels.student.inbox.plans;
  let changed = false;
  const added: { notices: GuardianNotice[]; plans: GuardianPlan[] } = { notices: [], plans: [] };

  for (const source of guardians) {
    let outbox: { notices: Array<Omit<GuardianNotice, 'read'>>; plans: GuardianPlan[] };
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
  }

  notices = notices.slice(0, 20);
  plans = plans.slice(0, 10);

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
    const outbox: StudentOutbox = { v: 2, relayed: passed, progress };
    try {
      await writeSlot(target.linkId, target.wrappedShareKey, session.dek, outbox);
      relayed += passed.length;
    } catch {
      /* best effort */
    }
  }

  return {
    panels: { ...panels, student: { ...panels.student, inbox: { notices, plans } } },
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

  for (const link of links) {
    if (link.status !== 'linked' || !link.linkId || !link.wrappedShareKey) continue;
    let outbox: { relayed: Array<Omit<GuardianNotice, 'read'>>; progress: PlanTick[] };
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
        const index = panels.guardian.links.indexOf(link);
        links[index] = { ...link, plans };
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
  const result = await request<AcceptLinkResponse>('/api/auth/link-accept', {
    method: 'POST',
    body: JSON.stringify({ code: code.trim() }),
  });

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
    return { ...link, status, code };
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
