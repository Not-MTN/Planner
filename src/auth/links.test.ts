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
import type { GoalSuggestion, PlanChangeRequest, PlannerState } from '../types';

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
    case 'POST /api/auth/homework-photos/delete':
      return api.then((m) => m.handleHomeworkPhotoDelete(request, store, {
        CLOUDINARY_CLOUD_NAME: 'demo',
        CLOUDINARY_API_KEY: '1234567890',
        CLOUDINARY_API_SECRET: 'test-secret-for-cloudinary',
      }));
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
      if (target.hostname === 'api.cloudinary.com') return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
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

  it('shares guardian-assigned classes and homework, then deletes photo assets after approval', async () => {
    await join('learnparent', 'learnparent@example.com', createEmptyState());
    const { inviteStudent, syncLinks } = await import('./links');
    const invited = await inviteStudent(createEmptyState().panels, 'learnstudent');

    await join('learnstudent', 'learnstudent@example.com', createEmptyState());
    const { acceptInvitation, syncStudentInbox } = await import('./links');
    const { withStudentClassProgress } = await import('../learning');
    const { approveHomeworkSubmission, dropClass, sendClass, sendHomeworkAssignment, submitHomework, readNotices } = await import('./links');
    let studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);

    await signInAs('learnparent');
    const linkId = invited.invitation.link.linkId!;
    let guardianPanels = (await syncLinks(invited.panels)).panels;
    guardianPanels = await sendClass(guardianPanels, linkId, {
      title: 'Algebra lesson', subject: 'Maths', description: 'Watch and take notes.', videoUrl: 'https://video.example/algebra',
    });
    guardianPanels = await sendHomeworkAssignment(guardianPanels, linkId, {
      title: 'Exercise 1', instructions: 'Show your working.', subject: 'Maths', dueAt: null,
    });

    await signInAs('learnstudent');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    expect(studentPanels.student.inbox.classes?.map((item) => item.title)).toEqual(['Algebra lesson']);
    expect(studentPanels.student.inbox.homework?.map((item) => item.title)).toEqual(['Exercise 1']);

    const assignedClass = studentPanels.student.inbox.classes![0]!;
    studentPanels = withStudentClassProgress(studentPanels, {
      classId: assignedClass.id, linkId, completedAt: '2026-10-12T21:00:00.000Z', updatedAt: '2026-10-12T21:00:00.000Z',
    });
    const assignedHomework = studentPanels.student.inbox.homework![0]!;
    const publicId = `planner-homework/${linkId}/abcdef0123456789abcdef01`;
    const photo = {
      url: `https://res.cloudinary.com/demo/raw/upload/v123/${publicId}.bin`,
      publicId, name: 'answer.jpg', mime: 'image/jpeg', bytes: 2048,
    };
    studentPanels = submitHomework(studentPanels, assignedHomework.id, [photo]);
    const submission = studentPanels.student.homeworkSubmissions![0]!;
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;

    await signInAs('learnparent');
    guardianPanels = (await readNotices(guardianPanels)).panels;
    const guardianLink = guardianPanels.guardian.links[0]!;
    expect(guardianLink.classProgress?.[0]?.completedAt).toBe('2026-10-12T21:00:00.000Z');
    expect(guardianLink.homeworkSubmissions?.[0]?.status).toBe('submitted');
    expect(guardianLink.homeworkSubmissions?.[0]?.photos).toHaveLength(1);

    guardianPanels = await approveHomeworkSubmission(guardianPanels, linkId, submission.id, 'Excellent work.');
    const approved = guardianPanels.guardian.links[0]?.homeworkSubmissions?.[0];
    expect(approved).toMatchObject({ status: 'approved', photos: [], guardianNote: 'Excellent work.' });
    const deletionsBeforeRetry = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/raw/destroy')).length;
    await approveHomeworkSubmission(guardianPanels, linkId, submission.id, 'Updated note should not rewrite approval.');
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/raw/destroy')).length).toBe(deletionsBeforeRetry);

    await signInAs('learnstudent');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    expect(studentPanels.student.homeworkSubmissions?.[0]).toMatchObject({
      status: 'approved', photos: [], guardianNote: 'Excellent work.',
    });

    await signInAs('learnparent');
    guardianPanels = await dropClass(guardianPanels, linkId, assignedClass.id);
    expect(guardianPanels.guardian.links[0]?.classes).toEqual([]);
    await signInAs('learnstudent');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    expect(studentPanels.student.inbox.classes).toEqual([]);
    expect(studentPanels.student.classProgress).toEqual([]);
  }, 180_000);

  it('supports a first report reply, then keeps an approved day immutable across stale guardian state', async () => {
    await join('reportparent', 'reportparent@example.com', createEmptyState());
    const { inviteStudent, syncLinks, sendPlan, readNotices, sendAck, approvePlanPeriod, syncStudentInbox } = await import('./links');
    const { todayISO } = await import('../dates');
    const { withDayReport } = await import('../weekPlans');
    const today = todayISO();
    const date = addDays(today, -7);
    const start = addDays(today, -8);
    const invited = await inviteStudent(createEmptyState().panels, 'reportstudent');

    await join('reportstudent', 'reportstudent@example.com', createEmptyState());
    const { acceptInvitation } = await import('./links');
    let studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);
    const linkId = invited.invitation.link.linkId!;

    await signInAs('reportparent');
    let guardianPanels = (await syncLinks(invited.panels)).panels;
    guardianPanels = await sendPlan(guardianPanels, linkId, {
      cadence: 'week', start, title: 'Daily report test', note: '',
      items: [{ title: 'Maths', date, time: null, minutes: null, subject: null, url: null }],
    });

    await signInAs('reportstudent');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    const studentPlan = studentPanels.student.inbox.plans[0]!;
    const report = {
      id: 'report-once', planId: studentPlan.id, linkId, date,
      doneIds: [studentPlan.items[0]!.id], note: 'Finished.',
      createdAt: `${date}T20:00:00.000Z`, updatedAt: `${date}T20:00:00.000Z`,
    };
    studentPanels = withDayReport(studentPanels, report, today);
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;

    await signInAs('reportparent');
    guardianPanels = (await readNotices(guardianPanels)).panels;
    const received = guardianPanels.guardian.links[0]?.reports?.[0];
    expect(received?.id).toBe(report.id);

    const ackDraft = { reportId: report.id, planId: studentPlan.id, date, text: 'I saw this.' };
    guardianPanels = await sendAck(guardianPanels, linkId, ackDraft);
    expect(guardianPanels.guardian.links[0]?.acks?.[0]?.text).toBe('I saw this.');
    const staleGuardian = guardianPanels;
    guardianPanels = await sendAck(guardianPanels, linkId, { ...ackDraft, approve: true });
    expect(guardianPanels.guardian.links[0]?.acks?.[0]?.approvedAt).toBeTruthy();
    await expect(sendAck(staleGuardian, linkId, { ...ackDraft, text: 'Change after approval.' })).rejects.toThrow('This approved daily report is locked.');
    guardianPanels = await approvePlanPeriod(guardianPanels, linkId, studentPlan.id);
    expect(guardianPanels.guardian.links[0]?.plans[0]?.approvedAt).toBeTruthy();

    await signInAs('reportstudent');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    expect(studentPanels.student.acks?.[0]?.approvedAt).toBeTruthy();
    expect(studentPanels.student.inbox.plans[0]?.approvedAt).toBeTruthy();
    expect(withDayReport(studentPanels, { ...report, note: 'Rewrite attempt.' }, today)).toBe(studentPanels);

    // A stale device may still send an old tick, but the guardian's filed day
    // remains authoritative after approval.
    const stalePlan = {
      ...studentPanels.student.inbox.plans[0]!,
      items: studentPanels.student.inbox.plans[0]!.items.map((item) => ({ ...item, done: false })),
    };
    const staleStudent = {
      ...studentPanels,
      student: {
        ...studentPanels.student,
        reports: [],
        inbox: { ...studentPanels.student.inbox, plans: [stalePlan] },
      },
    };
    await syncStudentInbox(staleStudent, []);
    await signInAs('reportparent');
    guardianPanels = (await readNotices(guardianPanels)).panels;
    expect(guardianPanels.guardian.links[0]?.plans[0]?.items[0]?.done).toBe(true);
  }, 180_000);

  it('lets a guardian change a running week, and a student ask for a change that gets an answer', async () => {
    // The week is already out there and being lived by: today is inside it, and
    // yesterday is a record. Both sides have to end up reading the same week,
    // and neither may quietly rewrite a day that has gone by.
    await join('editparent', 'editparent@example.com', createEmptyState());
    const {
      inviteStudent,
      syncLinks,
      sendPlan,
      readNotices,
      syncStudentInbox,
      updatePlanDays,
      answerChangeRequest,
      approvePlanPeriod,
    } = await import('./links');
    const { todayISO } = await import('../dates');
    const { buildChangeRequest, itemsForDay, withStudentChangeRequest } = await import('../weekPlans');
    const today = todayISO();
    const start = addDays(today, -1);
    const invited = await inviteStudent(createEmptyState().panels, 'editstudent');
    const linkId = invited.invitation.link.linkId!;

    await join('editstudent', 'editstudent@example.com', createEmptyState());
    const { acceptInvitation } = await import('./links');
    let studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);

    await signInAs('editparent');
    let guardianPanels = (await syncLinks(invited.panels)).panels;
    guardianPanels = await sendPlan(guardianPanels, linkId, {
      cadence: 'week',
      start,
      title: 'A running week',
      note: '',
      items: [
        { title: 'History', date: addDays(today, -1), time: '09:00', end: '10:00', minutes: null, subject: null, url: null },
        { title: 'Maths', date: today, time: '09:00', minutes: null, subject: null, url: null },
        { title: 'Chemistry', date: addDays(today, 2), time: '14:00', minutes: null, subject: null, url: null },
      ],
    });
    const sent = guardianPanels.guardian.links[0]!.plans[0]!;
    const mathsId = sent.items.find((entry) => entry.title === 'Maths')!.id;
    const chemId = sent.items.find((entry) => entry.title === 'Chemistry')!.id;

    // Yesterday is not a draft any more.
    await expect(
      updatePlanDays(guardianPanels, linkId, sent.id, [{ date: addDays(today, -1), lessons: [] }]),
    ).rejects.toThrow('That day has gone by.');
    // Today onwards is still editable: Maths gets an end, and a lesson is added.
    guardianPanels = await updatePlanDays(guardianPanels, linkId, sent.id, [
      {
        date: today,
        lessons: [
          { id: mathsId, title: 'Maths', time: '10:00', end: '12:00' },
          { title: 'Geometry', time: '15:00' },
        ],
      },
    ]);
    const edited = guardianPanels.guardian.links[0]!.plans[0]!;
    expect(itemsForDay(edited, today).map((entry) => entry.title)).toEqual(['Maths', 'Geometry']);
    expect(itemsForDay(edited, today)[0]).toMatchObject({ id: mathsId, time: '10:00', end: '12:00' });
    expect(itemsForDay(edited, addDays(today, -1))[0]).toMatchObject({ title: 'History', time: '09:00', end: '10:00' });
    expect(edited.updatedAt).not.toBe(sent.updatedAt);
    expect(guardianPanels.guardian.notices[0]?.summary).toContain('Plan changed for');

    await signInAs('editstudent');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    let plan = studentPanels.student.inbox.plans[0]!;
    expect(plan.id).toBe(sent.id);
    expect(itemsForDay(plan, today).map((entry) => entry.title)).toEqual(['Maths', 'Geometry']);
    expect(itemsForDay(plan, addDays(today, -1))[0]).toMatchObject({ time: '09:00', end: '10:00' });
    expect(studentPanels.student.inbox.notices.some((notice) => notice.summary.includes('Plan changed for'))).toBe(true);

    // The student asks for a lesson to be added, and the ask travels to the guardian.
    const request = buildChangeRequest(
      plan,
      linkId,
      {
        kind: 'add',
        title: 'Physics',
        date: addDays(today, 1),
        time: '16:00',
        end: '17:30',
        note: 'We have a test that morning.',
      },
      today,
    )!;
    studentPanels = withStudentChangeRequest(studentPanels, request);
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    // Asking changes nothing in the week itself.
    expect(itemsForDay(studentPanels.student.inbox.plans[0]!, addDays(today, 1))).toEqual([]);

    await signInAs('editparent');
    guardianPanels = (await readNotices(guardianPanels)).panels;
    const asks = guardianPanels.guardian.links[0]!.changeRequests!;
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ id: request.id, state: 'open', title: 'Physics', note: 'We have a test that morning.' });
    expect(guardianPanels.guardian.notices.some((notice) => notice.summary.includes('asked to add Physics'))).toBe(true);

    // Approving it changes the week, here and on the next sync over there.
    guardianPanels = await answerChangeRequest(guardianPanels, linkId, request.id, 'approved', 'Good idea.');
    expect(itemsForDay(guardianPanels.guardian.links[0]!.plans[0]!, addDays(today, 1))).toMatchObject([
      { title: 'Physics', time: '16:00', end: '17:30' },
    ]);
    expect(guardianPanels.guardian.links[0]!.changeRequests![0]).toMatchObject({
      state: 'approved',
      reply: 'Good idea.',
    });
    expect(guardianPanels.guardian.notices[0]?.summary).toContain('Change approved: Physics');

    await signInAs('editstudent');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    plan = studentPanels.student.inbox.plans[0]!;
    expect(itemsForDay(plan, addDays(today, 1))[0]).toMatchObject({ title: 'Physics', time: '16:00', end: '17:30' });
    expect(studentPanels.student.changeRequests![0]).toMatchObject({ id: request.id, state: 'approved', reply: 'Good idea.' });

    // A second ask, declined with a word back, leaves the week exactly as it was.
    const removal = buildChangeRequest(
      plan,
      linkId,
      { kind: 'remove', title: 'Chemistry', itemId: chemId, date: addDays(today, 2) },
      today,
    )!;
    studentPanels = withStudentChangeRequest(studentPanels, removal);
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;

    await signInAs('editparent');
    guardianPanels = (await readNotices(guardianPanels)).panels;
    expect(guardianPanels.guardian.links[0]!.changeRequests!.map((entry) => entry.id)).toContain(removal.id);
    guardianPanels = await answerChangeRequest(guardianPanels, linkId, removal.id, 'declined', 'It is the week before the exam.');
    expect(itemsForDay(guardianPanels.guardian.links[0]!.plans[0]!, addDays(today, 2))[0]).toMatchObject({
      title: 'Chemistry',
    });
    expect(guardianPanels.guardian.notices[0]?.summary).toContain('Change declined: Chemistry');
    // An ask that already has an answer is not answered twice.
    expect(await answerChangeRequest(guardianPanels, linkId, removal.id, 'approved')).toBe(guardianPanels);

    await signInAs('editstudent');
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;
    const answered = studentPanels.student.changeRequests!.find((entry) => entry.id === removal.id);
    expect(answered).toMatchObject({ state: 'declined', reply: 'It is the week before the exam.' });
    expect(itemsForDay(studentPanels.student.inbox.plans[0]!, addDays(today, 2))[0]).toMatchObject({ title: 'Chemistry' });

    // A week whose period has ended can be closed, and a closed week cannot be
    // edited any more — checked against the week as it stands in the slot, not
    // as either device happens to hold it.
    await signInAs('editparent');
    guardianPanels = await sendPlan(guardianPanels, linkId, {
      cadence: 'week',
      start: addDays(today, -9),
      title: 'A week that is over',
      note: '',
      // Nothing was asked for in it, so there is no report to wait for and the
      // period can be closed the moment it has ended.
      items: [],
    });
    const over = guardianPanels.guardian.links[0]!.plans.find((entry) => entry.title === 'A week that is over')!;
    guardianPanels = await approvePlanPeriod(guardianPanels, linkId, over.id);
    expect(guardianPanels.guardian.links[0]!.plans.find((entry) => entry.id === over.id)!.approvedAt).toBeTruthy();
    await expect(
      updatePlanDays(guardianPanels, linkId, over.id, [{ date: addDays(today, -9), lessons: [] }]),
    ).rejects.toThrow('This period is closed.');
    // An ask that lands after the close is refused with the reason, rather than
    // answered as though the week could still move.
    const lateAsk: PlanChangeRequest = {
      id: 'change-late',
      linkId,
      planId: over.id,
      date: addDays(today, -9),
      kind: 'add',
      title: 'Astronomy',
      note: '',
      state: 'open',
      createdAt: `${today}T09:00:00.000Z`,
    };
    const holdingLateAsk = {
      ...guardianPanels,
      guardian: {
        ...guardianPanels.guardian,
        links: guardianPanels.guardian.links.map((link) => ({
          ...link,
          changeRequests: [lateAsk, ...(link.changeRequests ?? [])],
        })),
      },
    };
    await expect(answerChangeRequest(holdingLateAsk, linkId, lateAsk.id, 'approved')).rejects.toThrow(
      'That ask can no longer be made',
    );
  }, 180_000);

  it('carries the student standing class timetable to the guardian as locked blocks', async () => {
    await join('parent10', 'parent10@example.com', createEmptyState());
    const { inviteStudent, readNotices, syncLinks } = await import('./links');
    const invited = await inviteStudent(createEmptyState().panels, 'student10');

    await join('student10', 'student10@example.com', createEmptyState());
    const { acceptInvitation, syncStudentInbox } = await import('./links');
    let studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);

    // The student owns the timetable; guardians only ever read it.
    studentPanels = {
      ...studentPanels,
      student: {
        ...studentPanels.student,
        fixedClasses: [
          {
            id: 'fixed-maths',
            title: 'Maths class',
            weekday: 1,
            startTime: '09:00',
            endTime: '10:30',
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
    };
    studentPanels = (await syncStudentInbox(studentPanels, [])).panels;

    await signInAs('parent10');
    // Reconcile the accepted invitation first, the way the panel does before
    // pulling notices: readNotices only opens slots on linked links.
    const reconciled = await syncLinks(invited.panels);
    expect(reconciled.panels.guardian.links[0]?.status).toBe('linked');
    const first = await readNotices(reconciled.panels);
    expect(first.changed).toBe(true);
    expect(first.panels.guardian.links[0]?.fixedClasses).toEqual([
      expect.objectContaining({ id: 'fixed-maths', title: 'Maths class', weekday: 1 }),
    ]);

    // An empty timetable is authoritative too: removing every class clears the
    // guardian's copy rather than leaving a ghost block behind.
    await signInAs('student10');
    const emptied = {
      ...studentPanels,
      student: { ...studentPanels.student, fixedClasses: [] },
    };
    const afterRemoval = (await syncStudentInbox(emptied, [])).panels;
    expect(afterRemoval.student.fixedClasses).toEqual([]);

    await signInAs('parent10');
    const second = await readNotices(first.panels);
    expect(second.panels.guardian.links[0]?.fixedClasses).toEqual([]);
  }, 180_000);
});
