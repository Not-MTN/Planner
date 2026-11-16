// @vitest-environment node
/**
 * The link's note slot carries a whole outbox, not one note — and it used to be
 * held to the *results* ceiling (16 KB), which a guardian with a couple of weeks
 * of lessons and a conversation is past. A refused slot is how a plan gets stuck
 * in the offline queue for good: the send fails, the queue keeps it, and every
 * retry fails the same way.
 *
 * These pin the slot's own ceiling: big enough for a real outbox, still bounded,
 * and refusing an oversized one with words rather than a generic failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyState } from '../types';
import { createMemoryAuthStore } from '../server/authStore';
import { resetRateLimits } from '../server/security';
import { MAX_NOTE_BYTES, MAX_SHARE_BYTES } from '../shared/authContract';

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
      return api.then((m) => m.handleLinks(request, store));
    case 'POST /api/auth/link-accept':
      return api.then((m) => m.handleLinkAccept(request, store));
    case 'GET /api/auth/note':
    case 'PUT /api/auth/note':
      return api.then((m) => m.handleNote(request, store));
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
      const response = await route(
        target.pathname,
        (init?.method ?? 'GET').toUpperCase(),
        init?.body ? String(init.body) : undefined,
        target.search,
      );
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) jar = /Max-Age=0/.test(setCookie) ? '' : (setCookie.split(';')[0] ?? '');
      return response;
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const PASSWORD = 'a-long-enough-password';

async function join(username: string) {
  const { signUp } = await import('./session');
  return signUp({
    username,
    email: `${username}@example.com`,
    displayName: username,
    role: 'personal',
    password: PASSWORD,
    initialState: createEmptyState(),
    remember: false,
  });
}

async function signInAs(username: string) {
  const { signIn, endSession } = await import('./session');
  endSession();
  return signIn(username, PASSWORD, false);
}

/** A link with a student on the other end, as the guardian holds it. */
async function linkedGuardian(username: string, student: string) {
  await join(username);
  const { inviteStudent } = await import('./links');
  const invited = await inviteStudent(createEmptyState().panels, student);
  await join(student);
  const { acceptInvitation } = await import('./links');
  const studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);
  await signInAs(username);
  const { syncLinks } = await import('./links');
  return {
    panels: (await syncLinks(invited.panels)).panels,
    studentPanels,
    linkId: invited.invitation.link.linkId!,
  };
}

describe('the note slot’s ceiling', () => {
  it('takes an outbox far larger than one week of results', async () => {
    const { panels, studentPanels, linkId } = await linkedGuardian('sizeparent', 'sizestudent');
    const { sendPlan } = await import('./links');
    const { todayISO } = await import('../dates');
    const start = todayISO();
    const items = Array.from({ length: 60 }, (_, index) => ({
      title: `Lesson ${index + 1} — a topic with a sentence of its own`,
      date: start,
      time: null,
      end: null,
      minutes: 45,
      subject: 'Mathematics',
      url: null,
    }));

    // Two full weeks of lessons is ~25 KB of outbox: past the results ceiling,
    // and exactly the guardian this used to refuse.
    let current = panels;
    for (let week = 0; week < 2; week += 1) {
      current = await sendPlan(current, linkId, {
        cadence: 'week',
        start,
        title: `Week ${week + 1}`,
        note: 'A note about the week ahead.',
        items,
      });
    }

    // The newest plan goes out on the same write as the two already waiting, so
    // the slot the student reads holds all three rather than a trimmed one.
    current = await sendPlan(current, linkId, {
      cadence: 'week',
      start,
      title: 'The third week',
      note: '',
      items: items.slice(0, 20),
    });
    expect(current.guardian.links[0]?.plans).toHaveLength(3);

    const { syncStudentInbox } = await import('./links');
    await signInAs('sizestudent');
    const inbox = await syncStudentInbox(studentPanels, []);
    expect(inbox.panels.student.inbox.plans.map((plan) => plan.title).sort()).toEqual([
      'The third week',
      'Week 1',
      'Week 2',
    ]);
  }, 180_000);

  it('refuses a slot past the ceiling, and says which problem it is', async () => {
    const { linkId } = await linkedGuardian('toolargeparent', 'toolargestudent');
    const { request, AuthError } = await import('./session');
    const tooBig = 'A'.repeat(MAX_NOTE_BYTES * 2 + 4);
    await expect(
      request('/api/auth/note', {
        method: 'PUT',
        body: JSON.stringify({ linkId, ciphertext: tooBig, weekOf: '2026-11-16' }),
      }),
    ).rejects.toMatchObject({ code: 'too_large', message: 'That note is too large to send.' });

    // A week of results is still held to the results ceiling, which is the
    // small thing it is.
    await expect(
      request('/api/auth/share', {
        method: 'PUT',
        body: JSON.stringify({
          linkId,
          ciphertext: 'A'.repeat(MAX_SHARE_BYTES * 2 + 4),
          weekOf: '2026-11-16',
        }),
      }),
    ).rejects.toBeInstanceOf(AuthError);
  }, 180_000);
});
