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
import type { GoalSuggestion, PlannerState } from '../types';

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

  it('suggests a goal, waits for the answer, and brings back counts only', async () => {
    // 1. Guardian suggests a goal. Nothing has happened to the student yet.
    await join('parent7', 'parent7@example.com', createEmptyState());
    const { inviteStudent, sendGoal } = await import('./links');
    const invited = await inviteStudent(createEmptyState().panels, 'student7');

    await join('student7', 'student7@example.com', createEmptyState());
    const { acceptInvitation } = await import('./links');
    let studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);

    await signInAs('parent7');
    const { sendGoal: suggest } = await import('./links');
    const withGoal = await suggest(invited.panels, invited.invitation.link.linkId!, {
      title: 'Reach a B in maths by the summer',
      note: 'You have been close on the last three tests.',
      target: '2027-06-30',
      steps: ['Finish the past-paper booklet', 'Two past papers a week'],
    });
    const suggested = withGoal.guardian.links[0]?.goals?.[0];
    expect(suggested?.title).toBe('Reach a B in maths by the summer');
    expect(suggested?.steps).toHaveLength(2);

    // 2. The student picks it up, and it is still only an offer.
    await signInAs('student7');
    const { syncStudentInbox } = await import('./links');
    const first = await syncStudentInbox(studentPanels, []);
    studentPanels = first.panels;
    expect(first.added.goals).toHaveLength(1);
    const offered = studentPanels.student.inbox.goals ?? [];
    expect(offered).toHaveLength(1);
    const suggestion = offered[0] as GoalSuggestion;
    expect(suggestion.title).toBe('Reach a B in maths by the summer');

    // 3. Saying yes makes an ordinary goal of it.
    const { answerGoalSuggestion } = await import('./links');
    const { addGoal } = await import('../mutate');
    const withRealGoal = addGoal(
      createEmptyState(),
      {
        title: suggestion.title,
        description: suggestion.note,
        horizon: 'long',
        deadline: suggestion.target,
        milestones: suggestion.steps.map((title) => ({ title, dueDate: null })),
        fromSuggestion: { linkId: suggestion.linkId, suggestionId: suggestion.id },
      },
      suggestion.id,
    );
    expect(withRealGoal.goals[0]?.milestones).toHaveLength(2);
    expect(withRealGoal.goals[0]?.fromSuggestion?.suggestionId).toBe(suggestion.id);

    const { openGoalSuggestions } = await import('../panels');
    studentPanels = answerGoalSuggestion(studentPanels, suggestion, 'accepted');
    // It stops being a question: an answered suggestion is not asked again.
    expect(openGoalSuggestions(studentPanels)).toHaveLength(0);
    // But the answer itself has to keep travelling until it is taken back.
    expect(studentPanels.student.goalAnswers?.[0]?.state).toBe('accepted');

    // 4. Counts go back — one of two steps finished.
    const done = { ...withRealGoal.goals[0]!, milestones: withRealGoal.goals[0]!.milestones.map((step, index) => ({ ...step, completed: index === 0 })) };
    await syncStudentInbox(studentPanels, [done]);

    // 5. The guardian reads the answer: how far, and nothing else. The link
    // only counts as linked once their panel has caught up.
    await signInAs('parent7');
    const { readNotices, syncLinks } = await import('./links');
    const read = await readNotices((await syncLinks(withGoal)).panels);
    const answer = read.panels.guardian.links[0]?.goalAnswers?.[0];
    expect(answer?.state).toBe('accepted');
    expect(answer?.done).toBe(1);
    expect(answer?.total).toBe(2);
    // Only counts came back: no title, no step, nothing the student wrote.
    // The guardian sees whether the goal moved, not what it became.
    expect(answer).toEqual({
      suggestionId: suggestion.id,
      state: 'accepted',
      done: 1,
      total: 2,
      updatedAt: expect.any(String),
    });

    // 6. Taking the suggestion back does not take the goal away.
    const { dropGoal } = await import('./links');
    const withdrawn = await dropGoal(read.panels, invited.invitation.link.linkId!, suggestion.id);
    expect(withdrawn.guardian.links[0]?.goals ?? []).toHaveLength(0);
    void sendGoal;
  }, 180_000);

  it('keeps what was already sent when something new goes out', async () => {
    // A guardian's words live in the slot the student reads, and what the
    // student writes back lives in another. Reading the wrong one when adding
    // to an outbox silently threw away everything already out there: the
    // second note wiped the first, and a note wiped the plans.
    await join('parent6', 'parent6@example.com', createEmptyState());
    const { inviteStudent, postNotice, sendPlan, dropPlan } = await import('./links');
    const invited = await inviteStudent(createEmptyState().panels, 'student6');

    await join('student6', 'student6@example.com', createEmptyState());
    const { acceptInvitation, syncStudentInbox } = await import('./links');
    const studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);

    // Back to the guardian: only their session can open the link's share key.
    await signInAs('parent6');
    const start = (await import('../dates')).todayISO();
    let panels = await postNotice(invited.panels, invited.invitation.link.linkId!, 'First thing.');
    panels = await postNotice(panels, invited.invitation.link.linkId!, 'Second thing.');
    panels = await sendPlan(panels, invited.invitation.link.linkId!, {
      cadence: 'week' as const,
      start,
      title: 'A week of revision',
      note: '',
      items: [{ title: 'Chapter 4', date: start, minutes: 30, subject: 'Maths' }],
    });
    // And taking something back leaves the rest standing.
    const sent = panels.guardian.links[0]?.plans?.[0];
    panels = await dropPlan(panels, invited.invitation.link.linkId!, sent?.id ?? '');
    panels = await postNotice(panels, invited.invitation.link.linkId!, 'Third thing.');

    await signInAs('student6');
    const inbox = await syncStudentInbox(studentPanels, []);
    expect(inbox.panels.student.inbox.notices.map((item) => item.summary).sort()).toEqual([
      'First thing.',
      'Second thing.',
      'Third thing.',
    ]);
    // The plan was withdrawn, so the third note did not resurrect it.
    expect(inbox.panels.student.inbox.plans).toHaveLength(0);
  }, 180_000);

  it('carries praise, keeps it for later, and lets it go', async () => {
    await join('parent5', 'parent5@example.com', createEmptyState());
    const { inviteStudent } = await import('./links');
    const invited = await inviteStudent(createEmptyState().panels, 'student5');

    await join('student5', 'student5@example.com', createEmptyState());
    const { acceptInvitation, syncStudentInbox } = await import('./links');
    let studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);

    await signInAs('parent5');
    const { postPraise, postNotice } = await import('./links');
    // A note and a kind word, sent the same way.
    let guardianPanels = await postNotice(invited.panels, invited.invitation.link.linkId!, 'Moved Thursday chemistry to the evening.');
    guardianPanels = await postPraise(guardianPanels, invited.invitation.link.linkId!, 'You kept going this week, and I saw it.');

    await signInAs('student5');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;

    // Both arrive, and each is marked for what it is.
    const received = studentPanels.student.inbox.notices;
    expect(received).toHaveLength(2);
    const praise = received.find((item) => item.kind === 'praise');
    expect(praise?.summary).toBe('You kept going this week, and I saw it.');
    expect(received.find((item) => item.kind === 'note')?.summary).toContain('Thursday');

    // Praise is kept as well as delivered: the inbox is not where it lives.
    expect(studentPanels.student.praise).toHaveLength(1);
    expect(studentPanels.student.praise?.[0]?.summary).toBe('You kept going this week, and I saw it.');

    // Arriving twice does not double it.
    const again = await syncStudentInbox(studentPanels, []);
    expect(again.panels.student.praise).toHaveLength(1);

    // And it can be let go.
    const { forgetPraise } = await import('./links');
    const released = forgetPraise(again.panels, studentPanels.student.praise?.[0]?.id ?? '');
    expect(released.student.praise).toHaveLength(0);
    // Letting a kind word go does not touch the note.
    expect(released.student.inbox.notices).toHaveLength(2);
    void guardianPanels;
  }, 180_000);

  it('lets a student say not now, and stops asking', async () => {
    await join('parent8', 'parent8@example.com', createEmptyState());
    const { inviteStudent } = await import('./links');
    const invited = await inviteStudent(createEmptyState().panels, 'student8');

    await join('student8', 'student8@example.com', createEmptyState());
    const { acceptInvitation, answerGoalSuggestion, syncStudentInbox } = await import('./links');
    let studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);

    await signInAs('parent8');
    const { sendGoal } = await import('./links');
    const withGoal = await sendGoal(invited.panels, invited.invitation.link.linkId!, {
      title: 'Read one book a month',
      note: '',
      target: null,
      steps: [],
    });

    await signInAs('student8');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    const offered = studentPanels.student.inbox.goals ?? [];
    expect(offered).toHaveLength(1);
    const suggestion = offered[0] as GoalSuggestion;
    expect(suggestion.steps).toHaveLength(0);

    studentPanels = answerGoalSuggestion(studentPanels, suggestion, 'declined');
    // Nothing was added to their planner: a refusal adds nothing anywhere.
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;

    await signInAs('parent8');
    const { readNotices, syncLinks } = await import('./links');
    const read = await readNotices((await syncLinks(withGoal)).panels);
    expect(read.panels.guardian.links[0]?.goalAnswers?.[0]?.state).toBe('declined');
  }, 180_000);
});

