// @vitest-environment jsdom
/**
 * A plan the guardian parked has to arrive.
 *
 * Everything downstream of "Send now" used to be tested against a fake
 * `sendPlan`, so a real delivery failure went unseen: the button reported an
 * error, the plan was lifted from the queue or stayed in it, and the student's
 * panel never showed the week. These drive the real link code — real crypto,
 * real account API, a real student on the other end — and check the plan in the
 * student's inbox, which is the only thing that counts as delivered.
 */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryAuthStore } from '../server/authStore';
import { resetRateLimits } from '../server/security';
import { App } from '../App';
import { setLang } from '../i18n';
import { setWeekStart, todayISO } from '../dates';
import { createEmptyState, type Panels, type PlannerState, type QueuedPlan } from '../types';

const store = createMemoryAuthStore();
let jar = '';
let failNoteWrite = false;

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
  failNoteWrite = false;
  resetRateLimits();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('planner-tour-done', '1');
  localStorage.setItem('planner-week-start', '1');
  setWeekStart(1);
  setLang('en');
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => undefined;
  window.matchMedia = ((media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const target = new URL(url, 'https://planner.test');
      const method = (init?.method ?? 'GET').toUpperCase();
      // The signal is dead in exactly the way a phone loses it: the write never
      // reaches the server, and the browser hands back a failed fetch.
      if (failNoteWrite && method === 'PUT' && target.pathname === '/api/auth/note') {
        throw new TypeError('Failed to fetch');
      }
      const response = await route(target.pathname, method, init?.body ? String(init.body) : undefined, target.search);
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) jar = /Max-Age=0/.test(setCookie) ? '' : (setCookie.split(';')[0] ?? '');
      return response;
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const PASSWORD = 'a-long-enough-password';

async function join(username: string) {
  const { signUp } = await import('../auth/session');
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
  const { signIn, endSession } = await import('../auth/session');
  endSession();
  return signIn(username, PASSWORD, false);
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
}

async function click(label: string, scope: ParentNode = document): Promise<void> {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) =>
      item.textContent?.trim() === label ||
      item.querySelector('.panel-tab-label')?.textContent?.trim() === label ||
      item.getAttribute('aria-label') === label,
  );
  if (!button) throw new Error(`No button ${label}`);
  await act(async () => button.click());
  await settle();
}

function setValue(selector: string, value: string): void {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  act(() => element.dispatchEvent(new Event('input', { bubbles: true })));
}

function saved(): PlannerState {
  return JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}') as PlannerState;
}

function toast(): string {
  return document.querySelector('.toast')?.textContent ?? '';
}

/** The guardian panel, opened on the one student who has something waiting. */
async function openGuardian(state: PlannerState): Promise<void> {
  window.history.replaceState(null, '', '#/guardian');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <StrictMode>
        <App initialState={state} />
      </StrictMode>,
    ),
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !document.querySelector('.guardian-roster .student-card')) await settle();
  await click('View student', document.querySelector('.student-card') as ParentNode);
}

async function openLessonsPlan(): Promise<void> {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (item) => (item.textContent ?? '').trim() === 'Plan',
  );
  if (!tab) throw new Error('No tab Plan');
  await act(async () => tab.click());
  await settle();
  for (const label of ['Plan lessons', 'Timetable', 'Lessons'] as const) {
    const exists = [...document.querySelectorAll<HTMLButtonElement>('button')].some(
      (item) => (item.textContent?.trim() === label || item.getAttribute('aria-label') === label) && !item.disabled,
    );
    if (exists) {
      await click(label);
      return;
    }
  }
  if (document.querySelector('.week-plan-composer')) return;
  throw new Error('No lessons composer');
}

/** A guardian's roster with a student on it, as the panel holds it. */
async function linkedPair(guardian: string, student: string) {
  await join(guardian);
  const { inviteStudent, syncLinks, acceptInvitation } = await import('../auth/links');
  const invited = await inviteStudent(createEmptyState().panels, student);
  const linkId = invited.invitation.link.linkId!;

  await join(student);
  const studentPanels = await acceptInvitation(createEmptyState().panels, invited.invitation.code);

  await signInAs(guardian);
  const guardianPanels = (await syncLinks(invited.panels)).panels;
  expect(guardianPanels.guardian.links[0]?.wrappedShareKey).toBeTruthy();
  return { guardianPanels, studentPanels, linkId };
}

/** The guardian's app state, with the panel on and one week waiting to send. */
function guardianState(panels: Panels, queued: QueuedPlan | null): PlannerState {
  const state = createEmptyState();
  state.panels = {
    ...panels,
    guardian: {
      ...panels.guardian,
      enabled: true,
      kind: 'advisor',
      field: 'Science',
      queuedPlans: queued ? [queued] : panels.guardian.queuedPlans,
    },
  };
  return state;
}

function parkedWeek(linkId: string, title: string): QueuedPlan {
  const today = todayISO();
  return {
    id: 'queue-1',
    linkId,
    draft: {
      cadence: 'week',
      start: today,
      title,
      note: '',
      items: [
        { title: 'Chemistry revision', date: today, time: null, end: null, minutes: 45, subject: 'Chemistry', url: null },
      ],
    },
    createdAt: `${today}T08:00:00.000Z`,
  };
}

/** Every plan the student's panel holds after a pull. */
async function studentInbox(studentPanels: Panels, student: string): Promise<string[]> {
  await signInAs(student);
  const { syncStudentInbox } = await import('../auth/links');
  const inbox = await syncStudentInbox(studentPanels, []);
  return inbox.panels.student.inbox.plans.map((plan) => plan.title);
}

beforeAll(async () => {
  await Promise.all([import('../views/GuardianPanelView'), import('../views/StudentPanelView')]);
});

describe('sending a week that was parked', () => {
  it('delivers it to the student when Send now is pressed', async () => {
    const { guardianPanels, studentPanels } = await linkedPair('qguardian', 'qstudent');
    const state = guardianState(guardianPanels, null);

    await openGuardian(state);
    await openLessonsPlan();
    expect(document.querySelector('.week-plan-composer')).not.toBeNull();
    setValue('input[aria-label="Lesson name"]', 'Chemistry revision');
    await click('Add a lesson');
    setValue('.week-plan-composer input', 'Nina’s catch-up week');

    // The wire is down as the guardian sends: the week is parked, not lost.
    failNoteWrite = true;
    await click('Send the plan');
    expect(document.querySelector('.week-plan-composer')).toBeNull();
    const queued = saved().panels.guardian.queuedPlans ?? [];
    expect(queued).toHaveLength(1);
    expect(queued[0]?.draft.title).toBe('Nina’s catch-up week');
    expect(document.body.textContent).toContain('Waiting to send');

    // Back online, and the guardian presses the button rather than waiting for
    // the queue to wake up by itself.
    failNoteWrite = false;
    await click('Send now', document.querySelector('.gplan-list') as ParentNode);

    expect(toast()).toContain('The plan is on its way');
    expect(saved().panels.guardian.queuedPlans ?? []).toEqual([]);
    expect(saved().panels.guardian.links[0]?.plans[0]?.title).toBe('Nina’s catch-up week');
    expect(document.body.textContent).not.toContain('Waiting to send');

    expect(await studentInbox(studentPanels, 'qstudent')).toEqual(['Nina’s catch-up week']);
  }, 180_000);

  it('keeps the week when the retry fails too, then sends it', async () => {
    const { guardianPanels, studentPanels, linkId } = await linkedPair('rguardian', 'rstudent');
    const state = guardianState(guardianPanels, parkedWeek(linkId, 'Makeup week'));

    // A dead signal, so the queue is still waiting when the panel opens.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    try {
      await openGuardian(state);
      expect(document.body.textContent).toContain('Waiting to send');

      // The button is pressed while the write cannot land. The plan must stay
      // where it is: a failed retry is not a send.
      failNoteWrite = true;
      await click('Send now', document.querySelector('.gplan-list') as ParentNode);
      expect(toast()).toContain('The plan is still waiting — it will send when you are back online.');
      const still = saved().panels.guardian.queuedPlans ?? [];
      expect(still.map((entry) => entry.id)).toEqual(['queue-1']);
      expect(saved().panels.guardian.links[0]?.plans).toEqual([]);
      expect(document.body.textContent).toContain('Waiting to send');
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    }

    failNoteWrite = false;
    await click('Send now', document.querySelector('.gplan-list') as ParentNode);
    expect(toast()).toContain('The plan is on its way');
    expect(saved().panels.guardian.queuedPlans ?? []).toEqual([]);
    expect(await studentInbox(studentPanels, 'rstudent')).toEqual(['Makeup week']);
  }, 180_000);

  it('sends past a plan whose student is no longer linked', async () => {
    const { guardianPanels, studentPanels, linkId } = await linkedPair('fguardian', 'fstudent');
    const state = guardianState(guardianPanels, null);
    // One plan for a link that has gone from the roster, one for a student who
    // is there. The first can never go out; the second must not wait for it.
    state.panels.guardian.queuedPlans = [
      { ...parkedWeek('00000000-0000-0000-0000-000000000000', 'A week for nobody'), id: 'queue-dead' },
      { ...parkedWeek(linkId, 'Makeup week'), id: 'queue-live' },
    ];

    const { flushPlanQueue } = await import('../auth/links');
    const flushed = await flushPlanQueue(state.panels);
    expect(flushed.guardian.queuedPlans?.map((entry) => entry.id)).toEqual(['queue-dead']);
    expect(flushed.guardian.links[0]?.plans[0]?.title).toBe('Makeup week');
    expect(await studentInbox(studentPanels, 'fstudent')).toEqual(['Makeup week']);
  }, 180_000);

  it('delivers even when the guardian already has weeks of plans out there', async () => {
    const { guardianPanels, studentPanels, linkId } = await linkedPair('bguardian', 'bstudent');

    // Two full weeks of lessons, sent normally first. Together they are more
    // than the results-sized ceiling the note slot used to be held to, which is
    // exactly the guardian whose every send was refused.
    const { sendPlan } = await import('../auth/links');
    const today = todayISO();
    const lessons = Array.from({ length: 60 }, (_, index) => ({
      title: `Lesson ${index + 1} — a topic with a sentence of its own`,
      date: today,
      time: null,
      end: null,
      minutes: 45,
      subject: 'Mathematics',
      url: null,
    }));
    let panels = guardianPanels;
    for (const title of ['Week one', 'Week two']) {
      panels = await sendPlan(panels, linkId, { cadence: 'week', start: today, title, note: '', items: lessons });
    }

    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    try {
      await openGuardian(guardianState(panels, parkedWeek(linkId, 'The parked week')));
      expect(document.body.textContent).toContain('Waiting to send');
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    }

    await click('Send now', document.querySelector('.gplan-list') as ParentNode);
    expect(toast()).toContain('The plan is on its way');
    expect(saved().panels.guardian.queuedPlans ?? []).toEqual([]);

    // Nothing was traded away to make room: the student receives all three.
    expect((await studentInbox(studentPanels, 'bstudent')).sort()).toEqual([
      'The parked week',
      'Week one',
      'Week two',
    ]);
  }, 180_000);
});
