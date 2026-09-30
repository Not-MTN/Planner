// @vitest-environment node
/**
 * The link exchange, end to end, with real crypto on both sides:
 *
 *   guardian invites → student types the code → student sends this week →
 *   guardian reads results
 *
 * The server only ever sees a hash of the code and ciphertext it cannot open,
 * so the test checks that too: what lands in the database must be unreadable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyState } from '../types';
import { createMemoryAuthStore } from '../server/authStore';
import { resetRateLimits } from '../server/security';
import { normalizeLinkCode } from './crypto';
import { createShareKey, formatLinkCode, importDek, keyFromLinkCode, unwrapKeyRaw, wrapKey } from './crypto';
import type { PlannerState } from '../types';

const store = createMemoryAuthStore();
let jar = '';

function route(path: string, method: string, body?: string, search = ''): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jar) headers.Cookie = jar;
  const request = new Request(`https://planner.test${path}${search}`, { method, headers, body });
  const api = import('../server/authApi');
  switch (`${method} ${path}`) {
    case 'POST /api/auth/signup':
      return api.then((m) => m.handleSignup(request, store));
    case 'POST /api/auth/salt':
      return api.then((m) => m.handleSalt(request, store));
    case 'POST /api/auth/login':
      return api.then((m) => m.handleLogin(request, store));
    case 'GET /api/auth/session':
      return api.then((m) => m.handleSession(request, store));
    case 'GET /api/auth/links':
    case 'POST /api/auth/links':
    case 'DELETE /api/auth/links':
      return api.then((m) => m.handleLinks(request, store));
    case 'POST /api/auth/link-accept':
      return api.then((m) => m.handleLinkAccept(request, store));
    case 'GET /api/auth/note':
    case 'PUT /api/auth/note':
      return api.then((m) => m.handleNote(request, store));
    case 'GET /api/auth/share':
    case 'PUT /api/auth/share':
      return api.then((m) => m.handleShare(request, store));
    default:
      return Promise.resolve(new Response('not found', { status: 404 }));
  }
}

beforeEach(() => {
  jar = '';
  resetRateLimits();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const target = new URL(url, 'https://planner.test');
      const response = await route(target.pathname, (init?.method ?? 'GET').toUpperCase(), init?.body ? String(init.body) : undefined, target.search);
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) jar = /Max-Age=0/.test(setCookie) ? '' : (setCookie.split(';')[0] ?? '');
      return response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PASSWORD = 'a-long-enough-password';

async function join(username: string, email: string, state: PlannerState) {
  const { signUp } = await import('./session');
  return signUp({ username, email, displayName: username, role: 'personal', password: PASSWORD, initialState: state, remember: false });
}

async function signInAs(username: string) {
  const { signIn, endSession } = await import('./session');
  endSession();
  return signIn(username, PASSWORD, false);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('linking a guardian and a student', () => {
  it('carries weekly results from one vault to the other, and nowhere else', async () => {
    const { formatLinkCode: makeCode } = await import('./crypto');
    void makeCode;

    // 1. Guardian invites.
    await join('parent1', 'parent1@example.com', createEmptyState());
    const { inviteStudent } = await import('./links');
    const guardianPanels = createEmptyState().panels;
    const { panels: withLink, invitation } = await inviteStudent(guardianPanels, 'student1');
    expect(invitation.code).toMatch(/^plnr-/);
    expect(normalizeLinkCode(invitation.code.toLowerCase())).toBe(invitation.code);
    expect(withLink.guardian.links[0]?.status).toBe('pending');

    // The server must hold no trace of the code itself.
    const { getActiveSession } = await import('./session');
    const rows = await store.listOutgoingLinks(getActiveSession()!.user.id);
    expect(JSON.stringify(rows)).not.toContain(invitation.code);
    expect(rows[0]?.wrapped_share).toBeTruthy();

    // 2. Student accepts with that code.
    await join('student1', 'student1@example.com', createEmptyState());
    const { acceptInvitation, shareWeeklyResults } = await import('./links');
    const studentPanels = await acceptInvitation(createEmptyState().panels, invitation.code);
    expect(studentPanels.student.guardians).toHaveLength(1);
    expect(studentPanels.student.guardians[0]?.guardianUsername).toBe('parent1');

    // A wrong code gets nowhere.
    const { AuthError } = await import('./session');
    await expect(acceptInvitation(createEmptyState().panels, 'plnr-AAAA-AAAA-AAAA')).rejects.toBeInstanceOf(AuthError);

    // 3. Student sends this week's results.
    const week = (await import('../panels')).weekOf();
    const state = createEmptyState();
    state.tasks.push({
      id: 't1',
      title: 'Revise chapter 4',
      completed: true,
      priority: 'medium',
      dueDate: week,
      dueTime: null,
      category: 'Maths',
      note: '',
      goalId: null,
      createdAt: `${week}T09:00:00.000Z`,
      updatedAt: `${week}T09:00:00.000Z`,
      subtasks: [],
      repeat: null,
      sortOrder: 0,
      waiting: null,
      estimatedMinutes: null,
    });
    state.focusLog.push({ id: 'f1', taskId: 't1', title: 'Revise chapter 4', minutes: 75, date: week, endedAt: `${week}T10:00:00.000Z` });
    const shared = await shareWeeklyResults(state, studentPanels, true);
    expect(shared.sent).toBe(1);

    // 4. Guardian reads them — and only them. The panel does both: reconcile
    // the link status first, then pull results.
    await signInAs('parent1');
    const { syncLinks } = await import('./links');
    const synced = await syncLinks(withLink);
    expect(synced.changed).toBe(true);
    expect(synced.panels.guardian.links[0]?.status).toBe('linked');
    // The code has served its purpose and is dropped once the student accepted.
    expect(synced.panels.guardian.links[0]?.code).toBeNull();

    // The subject split travels as totals — no task titles.
    const { refreshResults: refreshAgain } = await import('./links');
    const first = await refreshAgain(synced.panels);
    const firstLink = first.panels.guardian.links[0]!;
    expect(firstLink.results?.weekOf).toBe(week);
    expect(firstLink.results?.planned).toBe(1);
    expect(firstLink.results?.done).toBe(1);
    expect(firstLink.results?.focusMinutes).toBe(75);
    expect(firstLink.results?.subjects).toEqual([{ name: 'Maths', minutes: 75 }]);

    // An earlier week joins the history instead of replacing it, newest first.
    const earlier = addDays(week, -7);
    await signInAs('student1');
    const { shareWeeklyResults: shareEarlier } = await import('./links');
    await shareEarlier(state, studentPanels, true, earlier);
    await signInAs('parent1');
    const refreshed = await refreshAgain(first.panels);
    const link = refreshed.panels.guardian.links[0]!;
    expect(link.history.map((item) => item.weekOf)).toEqual([earlier, week]);
    expect(link.status).toBe('linked');
    // The newest week on the server is now the earlier one, and the week before
    // it has moved into history rather than being forgotten.
    expect(link.results?.weekOf).toBe(earlier);
  }, 120_000);

  it('refuses a second invitation to the same student, and lets either side end it', async () => {
    await join('advisor1', 'advisor1@example.com', createEmptyState());
    const { inviteStudent, removeLink, syncLinks } = await import('./links');
    const panels = createEmptyState().panels;
    const first = await inviteStudent(panels, 'student2');
    await expect(inviteStudent(first.panels, 'student2')).rejects.toThrow();

    // Ending it removes it from the guardian's list.
    const after = await removeLink(first.panels, first.invitation.link.linkId!);
    expect(after.guardian.links).toHaveLength(0);

    // And it no longer shows up for anyone.
    await signInAs('advisor1');
    const synced = await syncLinks(after);
    expect(synced.panels.guardian.links).toHaveLength(0);
  }, 120_000);

  it('carries a note from one guardian to the other, through the student', async () => {
    const { inviteStudent, acceptInvitation, postNotice } = await import('./links');

    // Two guardians follow the same student.
    await join('parent9', 'parent9@example.com', createEmptyState());
    const parentInvite = await inviteStudent(createEmptyState().panels, 'student9');

    await join('student9', 'student9@example.com', createEmptyState());
    let studentPanels = await acceptInvitation(createEmptyState().panels, parentInvite.invitation.code);

    // The second guardian needs the student's account to exist first, which it does.
    const { endSession } = await import('./session');
    endSession();
    await join('advisor9', 'advisor9@example.com', createEmptyState());
    const advisorInvite = await inviteStudent(createEmptyState().panels, 'student9');
    endSession();

    const { signIn } = await import('./session');
    await signIn('student9', PASSWORD, false);
    const { acceptInvitation: acceptAgain } = await import('./links');
    studentPanels = await acceptAgain(studentPanels, advisorInvite.invitation.code);
    expect(studentPanels.student.guardians).toHaveLength(2);

    // The parent writes a note for the other adults.
    endSession();
    await signIn('parent9', PASSWORD, false);
    const parentPanels = await postNotice(parentInvite.panels, parentInvite.invitation.link.linkId!, 'Moved Thursday chemistry to the evening.');
    expect(parentPanels.guardian.notices[0]?.summary).toContain('Thursday');

    // The student passes it on.
    endSession();
    await signIn('student9', PASSWORD, false);
    const { syncStudentInbox: relay } = await import('./links');
    const relayed = await relay(studentPanels);
    expect(relayed.relayed).toBe(1);
    // And keeps it: the note is the student's to read too.
    expect(relayed.added.notices[0]?.summary).toContain('Thursday');

    // The advisor picks it up.
    endSession();
    await signIn('advisor9', PASSWORD, false);
    const { readNotices: read, syncLinks: sync } = await import('./links');
    // Their link only counts as linked once the panel has caught up.
    const advisorPanels = (await sync(advisorInvite.panels)).panels;
    expect(advisorPanels.guardian.links[0]?.status).toBe('linked');
    const inbox = await read(advisorPanels);
    expect(inbox.changed).toBe(true);
    expect(inbox.panels.guardian.notices[0]?.summary).toContain('Thursday');
    expect(inbox.panels.guardian.notices[0]?.author).toBe('parent9');
    expect(inbox.panels.guardian.notices[0]?.read).toBe(false);

    // Reading it twice does not duplicate it.
    const again = await read(inbox.panels);
    expect(again.changed).toBe(false);
  }, 180_000);

  it('seals the share key with the code, so only the code holder can open it', async () => {
    const code = formatLinkCode();
    const shareKey = await createShareKey();
    const codeKey = await keyFromLinkCode(code);
    const sealed = await wrapKey(shareKey, codeKey);

    // Same code → same key.
    const opened = await unwrapKeyRaw(sealed, await keyFromLinkCode(code));
    expect(opened).toHaveLength(32);

    // A different code cannot open it.
    const other = await keyFromLinkCode(formatLinkCode());
    await expect(unwrapKeyRaw(sealed, other)).rejects.toThrow();
    void importDek;
  });
});

