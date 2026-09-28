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
import type { GuardianLink, Panels, PlannerState, StudentGuardian, WeekResults, WeekSubjectMinutes } from '../types';
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
