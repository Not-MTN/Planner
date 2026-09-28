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
import { newId, weekOf, weekResults } from '../panels';
import type { GuardianLink, GuardianNotice, Panels, PlannerState, StudentGuardian, WeekResults, WeekSubjectMinutes } from '../types';
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

/* ----------------------------------------------------------------- notices */

async function shareKeyFor(dek: CryptoKey, wrapped: string): Promise<CryptoKey> {
  const raw = await unwrapKeyRaw(wrapped, dek);
  return importDek(raw, false);
}

/**
 * Guardian: tell the other adults following this student what you changed.
 * The student's own device passes it on, so no key is ever shared with the
 * server or with a stranger.
 */
export async function postNotice(panels: Panels, linkId: string, summary: string): Promise<Panels> {
  const session = await requireSession();
  const link = panels.guardian.links.find((item) => item.linkId === linkId);
  if (!link?.wrappedShareKey) throw new LinkError('That link is not ready yet.');
  const text = summary.trim().slice(0, 160);
  if (!text) return panels;

  const key = await shareKeyFor(session.dek, link.wrappedShareKey);
  const note = {
    id: newId('note'),
    student: link.username,
    author: session.user.displayName || session.user.username,
    summary: text,
    weekOf: weekOf(),
    createdAt: new Date().toISOString(),
  };
  const ciphertext = await encryptJson(note, key);
  await request('/api/auth/note', {
    method: 'PUT',
    body: JSON.stringify({ linkId, ciphertext, weekOf: note.weekOf }),
  });
  // The author sees their own note straight away, marked as read.
  const notice: GuardianNotice = { ...note, read: true };
  return { ...panels, guardian: { ...panels.guardian, notices: [notice, ...panels.guardian.notices].slice(0, 20) } };
}

/**
 * Student: collect what a guardian left for you, and pass it to the others.
 * Only the student holds every link's key, so they are the only one who can
 * translate a note from one guardian into the other's language.
 */
export async function relayNotices(panels: Panels): Promise<{ panels: Panels; relayed: number }> {
  const session = await requireSession();
  const guardians = panels.student.guardians;
  if (guardians.length === 0) return { panels, relayed: 0 };

  const week = weekOf();
  let relayed = 0;

  for (const source of guardians) {
    interface RelayNote {
      id?: string;
      weekOf?: string;
      summary?: string;
      author?: string;
      student?: string;
      createdAt?: string;
    }
    let note: RelayNote | null = null;
    try {
      const sourceKey = await shareKeyFor(session.dek, source.wrappedShareKey);
      const incoming = await request<{ ciphertext: string | null }>(`/api/auth/note?linkId=${encodeURIComponent(source.linkId)}`);
      if (!incoming.ciphertext) continue;
      note = await decryptJson<RelayNote>(incoming.ciphertext, sourceKey);
    } catch {
      continue;
    }
    if (!note?.summary) continue;

    // Hand it to every other guardian, sealed with each of their own keys.
    for (const target of guardians) {
      if (target.linkId === source.linkId) continue;
      try {
        const targetKey = await shareKeyFor(session.dek, target.wrappedShareKey);
        const ciphertext = await encryptJson(
          { ...note, id: `${note.id ?? 'note'}-${source.linkId.slice(0, 4)}`, student: session.user.username },
          targetKey,
        );
        await request('/api/auth/note', { method: 'PUT', body: JSON.stringify({ linkId: target.linkId, ciphertext, weekOf: note.weekOf ?? week }) });
        relayed += 1;
      } catch {
        /* one guardian offline must not block the rest */
      }
    }

    // Clear the note now that it is on its way.
    try {
      await request('/api/auth/note', { method: 'PUT', body: JSON.stringify({ linkId: source.linkId, ciphertext: null, weekOf: note.weekOf ?? week }) });
    } catch {
      /* best effort */
    }
  }

  return { panels, relayed };
}

/** Guardian: pick up whatever the others left for you. */
export async function readNotices(panels: Panels): Promise<{ panels: Panels; changed: boolean }> {
  const session = await requireSession();
  const known = new Set(panels.guardian.notices.map((notice) => notice.id));
  const found: GuardianNotice[] = [];

  for (const link of panels.guardian.links) {
    if (link.status !== 'linked' || !link.linkId || !link.wrappedShareKey) continue;
    try {
      const key = await shareKeyFor(session.dek, link.wrappedShareKey);
      const incoming = await request<{ ciphertext: string | null }>(`/api/auth/note?linkId=${encodeURIComponent(link.linkId)}`);
      if (!incoming.ciphertext) continue;
      const note = await decryptJson<GuardianNotice>(incoming.ciphertext, key);
      if (!note?.summary || known.has(note.id)) continue;
      found.push({
        id: String(note.id).slice(0, 80),
        student: String(note.student ?? link.username).slice(0, 40),
        author: String(note.author ?? '').slice(0, 60) || link.displayName,
        summary: String(note.summary).slice(0, 160),
        weekOf: String(note.weekOf ?? '').slice(0, 10),
        createdAt: String(note.createdAt ?? new Date().toISOString()).slice(0, 40),
        read: false,
      });
    } catch {
      /* an unreadable note is skipped, not fatal */
    }
  }

  if (found.length === 0) return { panels, changed: false };
  const notices = [...found, ...panels.guardian.notices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  return { panels: { ...panels, guardian: { ...panels.guardian, notices } }, changed: true };
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
