// @vitest-environment node
/**
 * An invitation is an open door until it is used. This is about closing it.
 *
 * A code lives in a message thread, a screenshot, a note on the fridge. It can
 * be found months later by someone who was never meant to hold it, so it has to
 * stop working on its own. These tests cover the life of one code: fresh,
 * accepted, then too old — and being too old reading differently from being
 * wrong, because the way out is different.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryAuthStore, hashToken, INVITE_TTL_DAYS } from '../server/authStore';
import { handleLinkAccept, handleLinks, hashLinkCode } from '../server/authApi';
import { resetRateLimits } from '../server/security';
import { isInviteExpired } from './links';
import type { AuthStore } from '../server/authStore';
import type { OutgoingLink } from '../shared/authContract';

const DAY = 86_400_000;
const B64 = 'a'.repeat(64);
/** A code in the shape someone actually types. Its hash is what gets stored. */
const CODE = 'plnr-abcd-efgh-ijkl';
/** A session cookie is all the API asks for; no password round-trip needed. */
const TOKEN = 'test-session-token';

function post(path: string, body: unknown, cookie: string): Request {
  return new Request(`https://planner.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie: string): Request {
  return new Request(`https://planner.test${path}`, { headers: { Cookie: cookie } });
}

let store: AuthStore;
let guardianId = '';
let studentId = '';
const guardianCookie = `planner_session=${TOKEN}`;
const studentCookie = `planner_session=${TOKEN}-student`;

async function addUser(username: string, token: string): Promise<string> {
  const made = await store.createAccount({
    username,
    email: `${username}@example.com`,
    displayName: username,
    role: 'student',
    kdfSalt: B64,
    authToken: B64,
    recoveryHashes: [B64],
    wrappedDek: B64,
    wrappedRecovery: [B64],
    ciphertext: 'vault',
  });
  if (!made.ok) throw new Error(`could not create ${username}: ${made.reason}`);
  // Long enough to outlive the clock jumps below; the session must not be the
  // reason a request is refused when the point is the invitation's age.
  await store.createSession(made.user.id, hashToken(token), 'test', new Date(Date.now() + 90 * DAY));
  return made.user.id;
}

function invite(codeHash = B64): Promise<Awaited<ReturnType<AuthStore['createLink']>>> {
  return store.createLink({
    id: `link-${Math.random().toString(36).slice(2)}`,
    guardianId,
    studentUsernameLower: 'studentx',
    codeHash,
    wrappedShare: B64,
  });
}

/** Push the clock past the deadline. The store reads the real clock, so it moves too. */
function agePastDeadline(): void {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.advanceTimersByTime((INVITE_TTL_DAYS + 1) * DAY);
}

beforeEach(async () => {
  resetRateLimits();
  store = createMemoryAuthStore();
  guardianId = await addUser('guardianx', TOKEN);
  studentId = await addUser('studentx', `${TOKEN}-student`);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('an invitation that has been waiting too long', () => {
  it('is accepted while it is still fresh', async () => {
    const created = await invite();
    expect(created?.code_expires_at).toBeTruthy();

    const row = await store.acceptLink(B64, { id: studentId, usernameLower: 'studentx' });
    expect(row).not.toBeNull();
    expect(row).not.toBe('expired');
    expect((row as { status: string }).status).toBe('linked');
    // The code has done its job; it is not an open door any more.
    expect((row as { code_expires_at: string | null }).code_expires_at).toBeNull();
  });

  it('stops working once the window has passed', async () => {
    await invite();
    agePastDeadline();
    expect(await store.acceptLink(B64, { id: studentId, usernameLower: 'studentx' })).toBe('expired');
  });

  it('still works on the last day of the window', async () => {
    await invite();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.advanceTimersByTime((INVITE_TTL_DAYS - 1) * DAY);
    expect(await store.acceptLink(B64, { id: studentId, usernameLower: 'studentx' })).not.toBe('expired');
  });

  it('is no longer offered to the student, so nobody hunts for a dead code', async () => {
    await invite();
    expect(await store.listIncomingLinks({ id: studentId, usernameLower: 'studentx' })).toHaveLength(1);

    agePastDeadline();
    expect(await store.listIncomingLinks({ id: studentId, usernameLower: 'studentx' })).toHaveLength(0);
  });

  it('is still listed for the guardian, so a dead request can be sent again', async () => {
    await invite();
    agePastDeadline();
    const rows = await store.listOutgoingLinks(guardianId);
    expect(rows).toHaveLength(1);
    // With its deadline attached, so the panel can say it has passed.
    expect(rows[0]?.code_expires_at).toBeTruthy();
  });

  it('says so, in its own words, when someone tries to use it', async () => {
    // Seeded with the hash of a real code, so the request is refused for being
    // old and not for being unknown.
    await invite(hashLinkCode(CODE) ?? B64);
    agePastDeadline();

    const response = await handleLinkAccept(post('/api/auth/link-accept', { code: CODE }, studentCookie), store);
    expect(response.status).toBe(410);
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('invite_expired');
    // The sentence has to say what to do next, not only what went wrong.
    expect(body.error?.message?.toLowerCase()).toContain('new');
  });

  it('leaves an invitation with no deadline working', async () => {
    // Rows written before this change have no deadline at all. Reading that as
    // "expired" would quietly break every invitation already out there.
    const created = (await invite()) as unknown as { code_expires_at: string | null } | null;
    expect(created).not.toBeNull();
    created!.code_expires_at = null;
    expect(await store.acceptLink(B64, { id: studentId, usernameLower: 'studentx' })).not.toBe('expired');
  });
});

describe('the deadline shown to a guardian', () => {
  it('travels with the invitation and with the list', async () => {
    const made = await handleLinks(
      post('/api/auth/links', { username: 'studentx', codeHash: B64, wrappedShare: B64 }, guardianCookie),
      store,
    );
    expect(made.status).toBe(201);
    const created = (await made.json()) as { link: OutgoingLink };
    expect(created.link.expiresAt).toBeTruthy();
    expect(isInviteExpired(created.link.expiresAt)).toBe(false);
    const days = Math.round((new Date(created.link.expiresAt!).getTime() - Date.now()) / DAY);
    expect(days).toBe(INVITE_TTL_DAYS);

    const listed = await handleLinks(get('/api/auth/links', guardianCookie), store);
    const body = (await listed.json()) as { outgoing: OutgoingLink[] };
    expect(body.outgoing[0]?.expiresAt).toBe(created.link.expiresAt);
  });

  it('is gone once the code has been used', async () => {
    await invite();
    await store.acceptLink(B64, { id: studentId, usernameLower: 'studentx' });
    const listed = await handleLinks(get('/api/auth/links', guardianCookie), store);
    const body = (await listed.json()) as { outgoing: OutgoingLink[] };
    expect(body.outgoing[0]?.status).toBe('linked');
    expect(body.outgoing[0]?.expiresAt).toBeNull();
  });
});

describe('isInviteExpired', () => {
  it('treats a missing deadline as "still good"', () => {
    expect(isInviteExpired(null)).toBe(false);
    expect(isInviteExpired(undefined)).toBe(false);
  });

  it('reads a deadline in the past as expired and one ahead as not', () => {
    const now = Date.UTC(2026, 8, 30, 12, 0, 0);
    expect(isInviteExpired(new Date(now - 1).toISOString(), now)).toBe(true);
    expect(isInviteExpired(new Date(now + 1).toISOString(), now)).toBe(false);
  });

  it('does not throw on a deadline it cannot read', () => {
    expect(isInviteExpired('not a date')).toBe(false);
  });
});
