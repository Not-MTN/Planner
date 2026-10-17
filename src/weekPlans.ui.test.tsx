// @vitest-environment jsdom
/**
 * The weekly planning loop, as the two sides live it: the guardian plans
 * lessons from built-in chips and sends the week; the student ticks, reports,
 * and — when a day ends without a report — sees a nonblocking reminder
 * and can keep using the panel until ready to share.
 */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { answerChangeRequest, postNudge, sendAck, sendPlan, updatePlanDays } from './auth/links';
import { addDays, formatFullDate, formatWeekdayShort, setWeekStart, todayISO } from './dates';
import { setLang } from './i18n';
import { withLinkAck, withLinkChangeRequests, withLinkPlan } from './panels';
import { answeredChangeRequest, applyChangeRequest, withPlanDaysRewritten } from './weekPlans';
import {
  createEmptyState,
  type DayReport,
  type GuardianLink,
  type GuardianPlan,
  type Panels,
  type PlanChangeRequest,
  type QueuedPlan,
  type ReportAck,
  type PlannerState,
} from './types';

vi.mock('./auth/links', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth/links')>();
  const sendPlanMock = vi.fn(async (panels: Panels, linkId: string, draft: Parameters<typeof actual.sendPlan>[2]) => {
    const now = new Date().toISOString();
    const plan: GuardianPlan = {
      ...draft,
      field: draft.field ?? null,
      grade: draft.grade ?? null,
      id: 'sent-plan',
      linkId,
      author: 'Dr Noor',
      createdAt: now,
      updatedAt: now,
      items: draft.items.map((item, index) => ({ ...item, id: `lesson-${index}`, done: false })),
    };
    return withLinkPlan(panels, linkId, plan);
  });
  return {
    ...actual,
    syncLinks: vi.fn(async (panels: Panels) => ({ panels, changed: false })),
    refreshResults: vi.fn(async (panels: Panels) => ({ panels, changed: false })),
    readNotices: vi.fn(async (panels: Panels) => ({ panels, changed: false })),
    syncStudentInbox: vi.fn(async (panels: Panels) => ({
      panels,
      changed: false,
      added: { notices: [], plans: [], goals: [] },
      relayed: 0,
    })),
    shareWeeklyResults: vi.fn(async (_state: PlannerState, panels: Panels) => ({ panels, sent: 0 })),
    postNudge: vi.fn(async (panels: Panels, linkId: string) => {
      void linkId;
      const notice = {
        id: 'nudge-1',
        student: 'nina',
        author: 'Dr Noor',
        summary: 'A gentle nudge',
        weekOf: '',
        createdAt: new Date().toISOString(),
        read: true,
        kind: 'nudge' as const,
      };
      return {
        ...panels,
        guardian: { ...panels.guardian, notices: [notice, ...panels.guardian.notices].slice(0, 20) },
      };
    }),
    sendAck: vi.fn(
      async (
        panels: Panels,
        linkId: string,
        ack: { reportId: string; planId: string; date: string; text: string; reactions?: string[]; id?: string },
      ) =>
        withLinkAck(panels, linkId, {
          id: ack.id ?? 'ack-1',
          linkId,
          ...ack,
          reactions: ack.reactions ?? [],
          createdAt: new Date().toISOString(),
        }),
    ),
    sendPlan: sendPlanMock,
    // A mid-week edit is applied to the week as the guardian holds it, the way
    // the real one applies it to the week as the slot holds it.
    updatePlanDays: vi.fn(
      async (
        panels: Panels,
        linkId: string,
        planId: string,
        edits: Parameters<typeof actual.updatePlanDays>[3],
      ) => {
        const plan = panels.guardian.links
          .find((item) => item.linkId === linkId)
          ?.plans.find((item) => item.id === planId);
        if (!plan) throw new Error('That plan is no longer available.');
        const updated = withPlanDaysRewritten(plan, edits, todayISO());
        if (!updated) throw new Error('A week plan can hold up to 60 lessons.');
        return withLinkPlan(panels, linkId, updated);
      },
    ),
    answerChangeRequest: vi.fn(
      async (
        panels: Panels,
        linkId: string,
        requestId: string,
        decision: 'approved' | 'declined',
        reply = '',
      ) => {
        const link = panels.guardian.links.find((item) => item.linkId === linkId);
        const request = (link?.changeRequests ?? []).find((item) => item.id === requestId);
        if (!link || !request) throw new Error('That request is no longer waiting.');
        let next = panels;
        if (decision === 'approved') {
          const plan = link.plans.find((item) => item.id === request.planId);
          const changed = plan ? applyChangeRequest(plan, request, todayISO()) : null;
          if (!changed) throw new Error('That ask can no longer be made.');
          next = withLinkPlan(next, linkId, changed);
        }
        return withLinkChangeRequests(next, linkId, [answeredChangeRequest(request, decision, reply)]);
      },
    ),
    flushPlanQueue: vi.fn(async (panels: Panels) => {
      const waiting = panels.guardian.queuedPlans ?? [];
      let current = panels;
      for (const queued of waiting) {
        try {
          const sent = await sendPlanMock(current, queued.linkId, queued.draft);
          current = {
            ...sent,
            guardian: {
              ...sent.guardian,
              queuedPlans: (sent.guardian.queuedPlans ?? []).filter((entry) => entry.id !== queued.id),
            },
          };
        } catch {
          break;
        }
      }
      return current;
    }),
  };
});

vi.mock('./ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ai')>()),
  generateGuardianGuidance: vi.fn(async () => ({
    summary: 'A steady week.',
    questions: ['What would help with revision?'],
    encouragement: 'You made room to focus.',
  })),
}));

let root: Root | null = null;
let container: HTMLDivElement;
const ninaLinkId = '33333333-3333-3333-3333-333333333333';
const shareKey = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
}

async function click(label: string, scope: ParentNode = document): Promise<void> {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  );
  if (!button) throw new Error(`No button ${label}`);
  await act(async () => button.click());
  await settle();
}

/**
 * One student at a time, and their plan behind the Plan tab: the composer is
 * reached by opening the student, not from the roster card itself.
 */
async function openLessonsPlan(): Promise<void> {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (item) => (item.textContent ?? '').trim() === 'Plan',
  );
  if (!tab) throw new Error('No tab Plan');
  await act(async () => tab.click());
  await settle();
  await click('Plan lessons');
}

function setValue(selector: string, value: string): void {
  const element = query<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  act(() =>
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })),
  );
}

/** The composer's selects in order: field, grade, then the add-bar day. */
function setComposerSelect(index: number, value: string): void {
  const elements = document.querySelectorAll('.week-plan-composer select');
  const element = elements[index];
  if (!(element instanceof HTMLSelectElement)) throw new Error(`Missing composer select ${index}`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value);
  act(() => element.dispatchEvent(new Event('change', { bubbles: true })));
}

function saved(): PlannerState {
  return JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}') as PlannerState;
}

async function mount(state: PlannerState, route: 'student' | 'guardian' = 'student'): Promise<void> {
  window.history.replaceState(null, '', `#/${route}`);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <StrictMode>
        <App initialState={state} />,
      </StrictMode>,
    ),
  );
  const ready = route === 'student' ? '.student-panel-view' : '.guardian-roster';
  for (let index = 0; index < 6 && !document.querySelector(ready); index += 1) await settle();
}

function weekPlan(partial: Partial<GuardianPlan> = {}): GuardianPlan {
  return {
    id: 'week-1',
    author: 'Dr Noor',
    linkId: ninaLinkId,
    cadence: 'week',
    start: addDays(todayISO(), -6),
    title: 'A week of lessons',
    note: '',
    items: [],
    createdAt: `${todayISO()}T08:00:00.000Z`,
    updatedAt: `${todayISO()}T08:00:00.000Z`,
    ...partial,
  };
}

function guardianState(
  plans: GuardianPlan[] = [],
  reports: DayReport[] = [],
  acks: ReportAck[] = [],
  queuedPlans: QueuedPlan[] = [],
): PlannerState {
  const state = createEmptyState();
  const link: GuardianLink = {
    id: 'nina',
    username: 'nina',
    displayName: 'Nina',
    status: 'linked',
    history: [],
    linkId: ninaLinkId,
    code: null,
    wrappedShareKey: shareKey,
    results: null,
    plans,
    reports,
    acks,
  };
  state.panels.guardian = {
    ...state.panels.guardian,
    enabled: true,
    kind: 'advisor',
    field: 'Science',
    links: [link],
    notices: [],
    queuedPlans,
  };
  return state;
}

function studentState(plans: GuardianPlan[] = [], reports: DayReport[] = []): PlannerState {
  const state = createEmptyState();
  state.panels.student = {
    ...state.panels.student,
    enabled: true,
    field: 'Science',
    grade: 'school-11',
    inbox: { notices: [], plans, goals: [] },
    reports,
    guardians: [
      {
        linkId: ninaLinkId,
        guardianUsername: 'noor',
        guardianDisplayName: 'Dr Noor',
        wrappedShareKey: shareKey,
        sharedWeek: null,
      },
    ],
  };
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('planner-tour-done', '1');
  localStorage.setItem('planner-week-start', '1');
  setWeekStart(1);
  setLang('en');
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.clearAllMocks();
});

describe('planning a week of lessons', () => {
  it('plans from built-in chips and sends the week with absolute dates', async () => {
    await mount(guardianState(), 'guardian');
    const nina = query('.student-card');
    await click('View student', nina);
    await openLessonsPlan();
    expect(document.querySelector('.week-plan-composer')).not.toBeNull();

    setComposerSelect(0, 'science');
    setComposerSelect(1, 'school-11');
    await click('زیست‌شناسی (۲)');
    setValue('input[aria-label="Lesson name"]', 'Physics problems');
    setValue('input[aria-label="From"]', '17:30');
    setValue('input[aria-label="To"]', '19:00');
    await click('Add a lesson');
    setValue('.week-plan-composer input', 'Nina’s week');
    await click('Send the plan');

    expect(sendPlan).toHaveBeenCalledTimes(1);
    const draft = vi.mocked(sendPlan).mock.calls[0]?.[2];
    expect(draft?.cadence).toBe('week');
    expect(draft?.field).toBe('science');
    expect(draft?.grade).toBe('school-11');
    expect(draft?.items.map((item) => [item.title, item.date, item.time])).toEqual([
      ['زیست‌شناسی (۲)', todayISO(), null],
      ['Physics problems', todayISO(), '17:30'],
    ]);
    // "From 17:30 to 19:00" travels as a span, so the week can be measured.
    expect(draft?.items.find((item) => item.title === 'Physics problems')?.end).toBe('19:00');
    expect(document.body.textContent).toContain('on its way to Nina');
    expect(document.querySelector('.week-plan-composer')).toBeNull();
    expect(document.querySelector('.week-plan-card')).not.toBeNull();
    expect(saved().panels.guardian.links[0]?.plans[0]?.title).toBe('Nina’s week');
  });

  it('sorts a day by time and refuses to send an empty week', async () => {
    await mount(guardianState(), 'guardian');
    const nina = query('.student-card');
    await click('View student', nina);
    await openLessonsPlan();
    setValue('.week-plan-composer input', 'Nina’s week');
    await click('Send the plan');
    expect(sendPlan).not.toHaveBeenCalled();
    expect(query('.week-plan-composer .field-error').textContent).toContain('at least one thing');

    setValue('input[aria-label="Lesson name"]', 'Evening');
    setValue('input[aria-label="From"]', '19:00');
    await click('Add a lesson');
    setValue('input[aria-label="Lesson name"]', 'Morning');
    setValue('input[aria-label="From"]', '08:00');
    setValue('input[aria-label="To"]', '09:30');
    await click('Add a lesson');
    const rows = [...query('.week-draft-day').querySelectorAll('.week-lesson')];
    expect(rows.map((item) => item.querySelector('.week-lesson-title')?.textContent)).toEqual([
      'Morning',
      'Evening',
    ]);
    // The draft reads the span back, so what is sent is what was meant.
    expect(rows[0]!.textContent).toContain('08:00 – 09:30');
  });
});

describe('reading the week back', () => {
  const yesterday = addDays(todayISO(), -1);
  const dayBefore = addDays(todayISO(), -2);

  function reportedWeek(): { plans: GuardianPlan[]; reports: DayReport[] } {
    const plans = [
      weekPlan({
        items: [
          { id: 'a', title: 'Maths', date: dayBefore, time: '08:00', minutes: null, subject: null, done: true },
          { id: 'b', title: 'Physics', date: yesterday, time: '10:00', minutes: null, subject: null, done: false },
        ],
      }),
    ];
    const reports: DayReport[] = [
      {
        id: 'report-1',
        planId: 'week-1',
        linkId: ninaLinkId,
        date: dayBefore,
        doneIds: ['a'],
        note: 'Finished early.',
        createdAt: `${dayBefore}T20:00:00.000Z`,
        updatedAt: `${dayBefore}T20:00:00.000Z`,
      },
    ];
    return { plans, reports };
  }

  it('shows the guardian reports, notes, and what is still waiting', async () => {
    const { plans, reports } = reportedWeek();
    await mount(guardianState(plans, reports), 'guardian');
    await click('View student', query('.student-card'));
    const card = query('.week-plan-card');
    expect(card.textContent).toContain('Reported');
    expect(card.textContent).toContain('Finished early.');
    expect(card.textContent).toContain('Missing');
    expect(card.textContent).toContain('Waiting on 1 daily report');
    expect(card.textContent).toContain('Daily reports');
  });

  it('keeps the student panel usable while offering the missing report', async () => {
    const { plans, reports } = reportedWeek();
    await mount(studentState(plans, reports), 'student');
    expect(document.body.textContent).toContain('Daily reports to send');
    expect(document.querySelector('.student-panel-view [role="tablist"]')).not.toBeNull();
    await click('Subjects', query('[role="tablist"]'));
    expect(query('[role="tab"][aria-selected="true"]').textContent).toContain('Subjects');
    await click('Review reports');

    const form = query('.day-report-form');
    expect(form.querySelector('input[type="checkbox"]')).toBeNull();
    expect(form.querySelector('.day-report-performance')).not.toBeNull();
    expect(form.textContent).not.toContain('Maths');
    expect(form.textContent).not.toContain('Physics');
    await click('Send report');
    expect(document.body.textContent).toContain('All caught up');
    expect(document.body.textContent).not.toContain('Daily reports to send');
    await click('Today', query('[role="tablist"]'));
    const weekCard = query('.week-plan-card');
    expect(weekCard.textContent).toContain('of 1 done');
    expect(weekCard.textContent).not.toContain('Maths');
    expect(weekCard.textContent).not.toContain('Physics');
    expect(saved().panels.student.reports?.some((report) => report.date === yesterday)).toBe(true);
  });
});

describe('living with the week', () => {
  it('ticks lessons and reports today from the card, without pausing', async () => {
    const today = todayISO();
    const plans = [
      weekPlan({
        start: addDays(today, -2),
        items: [
          { id: 'a', title: 'Maths', date: today, time: '08:00', minutes: null, subject: null, done: false },
          { id: 'b', title: 'Physics', date: today, time: '10:00', minutes: null, subject: null, done: false },
        ],
      }),
    ];
    await mount(studentState(plans), 'student');
    expect(document.body.textContent).not.toContain('Daily reports to send');
    const card = query('.week-plan-card');
    const times = [...card.querySelectorAll('.week-time')].map((item) => item.textContent);
    expect(times).toEqual(['08:00', '10:00']);

    const box = card.querySelector('.week-lesson input[type="checkbox"]');
    if (!(box instanceof HTMLInputElement)) throw new Error('Missing lesson checkbox');
    await act(async () => box.click());
    expect(saved().panels.student.inbox.plans[0]?.items[0]?.done).toBe(true);

    await click('Report this day', card);
    await click('Send report');
    expect(document.body.textContent).toContain('Daily report sent.');
    expect(query('.week-plan-card').textContent).toContain('Reported');
  });

  it('shows performance only after a day plan ends', async () => {
    const plans = [
      weekPlan({
        id: 'day-1',
        cadence: 'day',
        start: addDays(todayISO(), -3),
        title: 'A day of revision',
        items: [{ id: 'a', title: 'Revise', date: null, time: null, minutes: null, subject: null, done: false }],
      }),
    ];
    await mount(studentState(plans), 'student');
    expect(document.body.textContent).not.toContain('Daily reports to send');
    expect(document.querySelector('.week-plan-card')).toBeNull();
    const card = document.querySelector('.gplan-card');
    expect(card?.textContent).toContain('Period performance');
    expect(card?.textContent).toContain('Performance summary only');
    expect(card?.textContent).not.toContain('A day of revision');
    expect(card?.textContent).not.toContain('Revise');
  });
});

describe('resting and the exam on the horizon', () => {
  it('marks rest days and warns about a heavy load before the exam', async () => {
    await mount(guardianState(), 'guardian');
    const nina = query('.student-card');
    await click('View student', nina);
    await openLessonsPlan();

    // The last rest chip is Sunday; the press is what matters, not its name.
    const restButtons = [...query('[aria-label="Rest days"]').querySelectorAll('button')];
    const sunday = restButtons[restButtons.length - 1];
    if (!sunday) throw new Error('Missing rest chips');
    await act(async () => sunday.click());
    expect(sunday.getAttribute('aria-pressed')).toBe('true');

    const exam = addDays(todayISO(), 6);
    const dateInputs = document.querySelectorAll('.week-plan-composer input[type="date"]');
    const examInput = dateInputs[1];
    if (!(examInput instanceof HTMLInputElement)) throw new Error('Missing exam date');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(examInput, exam);
    act(() => examInput.dispatchEvent(new Event('input', { bubbles: true })));

    setComposerSelect(2, '4');
    for (const name of ['Load one', 'Load two', 'Load three']) {
      setValue('input[aria-label="Lesson name"]', name);
      await click('Add a lesson');
    }
    setComposerSelect(2, '5');
    for (const name of ['Load four', 'Load five', 'Load six']) {
      setValue('input[aria-label="Lesson name"]', name);
      await click('Add a lesson');
    }
    expect(query('.week-exam-warn').textContent).toContain('Consider moving lessons earlier');

    setValue('.week-plan-composer input', 'Nina’s exam week');
    await click('Send the plan');
    expect(sendPlan).toHaveBeenCalledTimes(1);
    // A warning, not a wall: the week still sends, rest day and all.
    // (Sunday, in the toggles' day-of-week numbering.)
    expect(vi.mocked(sendPlan).mock.calls[0]?.[2].restDays).toEqual([0]);
  });
});

describe('answering a report', () => {
  it('sends seen-with-a-line and the reply stays on the report', async () => {
    const dayBefore = addDays(todayISO(), -2);
    const plans = [
      weekPlan({
        items: [{ id: 'a', title: 'Maths', date: dayBefore, time: '08:00', minutes: null, subject: null, done: true }],
      }),
    ];
    const reports: DayReport[] = [
      {
        id: 'report-1',
        planId: 'week-1',
        linkId: ninaLinkId,
        date: dayBefore,
        doneIds: ['a'],
        note: 'Finished early.',
        createdAt: `${dayBefore}T20:00:00.000Z`,
        updatedAt: `${dayBefore}T20:00:00.000Z`,
      },
    ];
    await mount(guardianState(plans, reports), 'guardian');
    await click('View student', query('.student-card'));
    const card = query('.week-plan-card');
    expect(card.querySelector('.week-ack-row')).not.toBeNull();

    setValue('.week-ack-row .input', 'Well done — rest tomorrow.');
    await click('Reply', card);
    expect(sendAck).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAck).mock.calls[0]?.[2].text).toBe('Well done — rest tomorrow.');
    expect(query('.week-plan-card').textContent).toContain('Well done — rest tomorrow.');
    expect(saved().panels.guardian.links[0]?.acks?.[0]?.text).toBe('Well done — rest tomorrow.');
  });
});

describe('asking for a plan', () => {
  it('lets the student ask for a change to a suggested week without blocking their panel', async () => {
    const state = studentState([weekPlan()]);
    await mount(state, 'student');
    expect(query('.student-plans-card').textContent).toContain('A suggested plan.');
    await click('Ask to change', query('.week-plan-card'));
    // The ask is a form and not a note: one lesson, one day, and a guardian who
    // can answer it. Nothing about the week moves until they do.
    expect(query('.week-change-form').textContent).toContain('The plan stays as it is until they approve it');
    expect(query('.student-panel-view [role="tablist"]')).toBeTruthy();
    await click('Close', query('.sheet-plan-change'));
    expect(document.querySelector('.week-change-form')).toBeNull();
    // Nothing was sent, so nothing was written: closing an ask asks for nothing.
    expect(saved().panels?.student?.changeRequests ?? []).toHaveLength(0);
  });

  it('sends a request with a note and takes it back on cancel', async () => {
    await mount(studentState(), 'student');
    setValue('.week-ask-row .input', 'Maths please');
    await click('Ask for a plan');
    expect(document.body.textContent).toContain('Plan requested — waiting for your guardian.');
    const asks = saved().panels.student.requests ?? [];
    expect(asks).toHaveLength(1);
    expect(asks[0]?.note).toBe('Maths please');

    await click('Cancel', query('.week-ask-row'));
    expect(saved().panels.student.requests ?? []).toHaveLength(0);
  });

  it('hands a request notice straight to the lesson planner', async () => {
    const state = guardianState();
    state.panels.guardian.notices = [
      {
        id: 'notice-1',
        student: 'nina',
        author: 'Nina',
        summary: 'asked for a week plan',
        weekOf: todayISO(),
        createdAt: `${todayISO()}T09:00:00.000Z`,
        read: false,
        kind: 'request',
      },
    ];
    await mount(state, 'guardian');
    const notices = query('.notice-list');
    expect(notices.textContent).toContain('asked for a week plan');
    await click('Plan lessons', notices);
    expect(document.querySelector('.week-plan-composer')).not.toBeNull();
  });
});

describe('rolling over and the grid', () => {
  it('moves an unfinished lesson to tomorrow under a reported week', async () => {
    const today = todayISO();
    const yesterday = addDays(today, -1);
    const plans = [
      weekPlan({
        start: addDays(today, -2),
        items: [
          { id: 'd', title: 'Yesterday’s maths', date: yesterday, time: '08:00', minutes: null, subject: null, done: true },
          { id: 'r1', title: 'Evening reading', date: today, time: null, minutes: null, subject: null, done: false },
        ],
      }),
    ];
    const reports: DayReport[] = [
      {
        id: 'rep-0',
        planId: 'week-1',
        linkId: ninaLinkId,
        date: yesterday,
        doneIds: ['d'],
        note: '',
        createdAt: `${yesterday}T20:00:00.000Z`,
        updatedAt: `${yesterday}T20:00:00.000Z`,
      },
    ];
    await mount(studentState(plans, reports), 'student');
    const card = query('.week-plan-card');
    expect(card.textContent).toContain('1 of 1 days reported');
    expect(card.textContent).toContain('1-day streak');

    await click(`Move to ${formatWeekdayShort(addDays(today, 1))}`, card);
    expect(saved().panels.student.inbox.plans[0]?.items[1]?.date).toBe(addDays(today, 1));
    expect(document.body.textContent).not.toContain('Move to ');
  });

  it('lays the week out as a grid with rest marks', async () => {
    const today = todayISO();
    const yesterday = addDays(today, -1);
    const restDate = addDays(today, 2);
    // Rest days are stored the way Date numbers them: Sunday is 0.
    const restDay = new Date(`${restDate}T12:00:00Z`).getUTCDay();
    const plans = [
      weekPlan({
        start: addDays(today, -2),
        restDays: [restDay],
        items: [
          { id: 'a', title: 'Maths', date: yesterday, time: '08:00', minutes: null, subject: null, done: true },
          { id: 'b', title: 'Physics', date: today, time: '10:00', minutes: null, subject: null, done: false },
          { id: 'c', title: 'Chemistry', date: addDays(today, 1), time: null, minutes: null, subject: null, done: false },
        ],
      }),
    ];
    const reports: DayReport[] = [
      {
        id: 'rep-0',
        planId: 'week-1',
        linkId: ninaLinkId,
        date: yesterday,
        doneIds: ['a'],
        note: '',
        createdAt: `${yesterday}T20:00:00.000Z`,
        updatedAt: `${yesterday}T20:00:00.000Z`,
      },
    ];
    await mount(studentState(plans, reports), 'student');
    const card = query('.week-plan-card');
    const grid = card.querySelector('.week-grid');
    if (!grid) throw new Error('Missing timetable grid');
    expect(grid.textContent).not.toContain('Maths');
    expect(grid.textContent).toContain('Physics');
    expect(grid.textContent).toContain('Chemistry');
    expect(grid.textContent).toContain('✓');
    expect(card.querySelector('.week-grid-mark.rest')?.textContent).toBe('Rest day');
    expect(card.textContent).toContain('1 of 1 days reported');
    expect(card.textContent).toContain('1-day streak');
  });
});

describe('nudging about missing reports', () => {
  it('sends one fixed-word nudge a day', async () => {
    const yesterday = addDays(todayISO(), -1);
    const plans = [
      weekPlan({
        items: [{ id: 'a', title: 'Maths', date: yesterday, time: '08:00', minutes: null, subject: null, done: false }],
      }),
    ];
    await mount(guardianState(plans), 'guardian');
    await click('View student', query('.student-card'));
    const card = query('.week-plan-card');
    expect(card.textContent).toContain('Waiting on 1 daily report');

    await click('Send a nudge', card);
    expect(postNudge).toHaveBeenCalledTimes(1);
    expect(query('.week-plan-card').textContent).toContain('Nudge sent');
  });
});

describe('focus that belonged to the lessons', () => {
  it('counts matching sessions in the review line', async () => {
    const today = todayISO();
    const yesterday = addDays(today, -1);
    const plans = [
      weekPlan({
        items: [
          { id: 'a', title: 'Maths', date: yesterday, time: '08:00', minutes: null, subject: null, done: true },
          { id: 'b', title: 'Physics', date: today, time: '10:00', minutes: null, subject: null, done: false },
        ],
      }),
    ];
    const reports: DayReport[] = [
      {
        id: 'rep-0',
        planId: 'week-1',
        linkId: ninaLinkId,
        date: yesterday,
        doneIds: ['a'],
        note: '',
        createdAt: `${yesterday}T20:00:00.000Z`,
        updatedAt: `${yesterday}T20:00:00.000Z`,
      },
    ];
    const state = studentState(plans, reports);
    state.focusLog = [
      { id: 's1', taskId: null, title: 'maths homework', minutes: 45, date: yesterday, endedAt: `${yesterday}T18:00:00.000Z` },
      { id: 's2', taskId: null, title: 'water the plants', minutes: 30, date: yesterday, endedAt: `${yesterday}T19:00:00.000Z` },
    ];
    await mount(state, 'student');
    expect(query('.week-plan-card').textContent).toContain('45m focused');
  });
});

describe('rolling to the quietest day', () => {
  it('skips a full tomorrow for the emptiest upcoming day', async () => {
    const today = todayISO();
    const plans = [
      weekPlan({
        start: addDays(today, -2),
        items: [
          { id: 'r1', title: 'Evening reading', date: today, time: null, minutes: null, subject: null, done: false },
          { id: 'f1', title: 'Full one', date: addDays(today, 1), time: null, minutes: null, subject: null, done: false },
          { id: 'f2', title: 'Full two', date: addDays(today, 1), time: null, minutes: null, subject: null, done: false },
          { id: 'f3', title: 'Full three', date: addDays(today, 1), time: null, minutes: null, subject: null, done: false },
        ],
      }),
    ];
    await mount(studentState(plans), 'student');
    const card = query('.week-plan-card');
    await click(`Move to ${formatWeekdayShort(addDays(today, 2))}`, card);
    const items = saved().panels.student.inbox.plans[0]?.items ?? [];
    expect(items.find((entry) => entry.id === 'r1')?.date).toBe(addDays(today, 2));
  });
});

describe('keeping the streak', () => {
  it('files a missed day as kept with a reason', async () => {
    const yesterday = addDays(todayISO(), -1);
    const plans = [
      weekPlan({
        items: [{ id: 'a', title: 'Maths', date: yesterday, time: '08:00', minutes: null, subject: null, done: false }],
      }),
    ];
    await mount(studentState(plans), 'student');
    expect(document.body.textContent).toContain('Daily reports to send');
    await click('Review reports');
    await click('Keep my streak');
    setValue('.week-repair-form .input', 'Fever all day.');
    await click('Save');
    expect(document.body.textContent).toContain('All caught up');
    const kept = saved().panels.student.reports?.[0];
    expect(kept?.repair).toBe(true);
    expect(kept?.note).toBe('Fever all day.');
    expect(query('.week-plan-card').textContent).toContain('Streak kept');
  });

  it('offers the mulligan once per plan', async () => {
    const dayBefore = addDays(todayISO(), -2);
    const yesterday = addDays(todayISO(), -1);
    const plans = [
      weekPlan({
        items: [
          { id: 'a', title: 'Maths', date: dayBefore, time: '08:00', minutes: null, subject: null, done: false },
          { id: 'b', title: 'Physics', date: yesterday, time: '10:00', minutes: null, subject: null, done: false },
        ],
      }),
    ];
    const reports: DayReport[] = [
      {
        id: 'rep-kept',
        planId: 'week-1',
        linkId: ninaLinkId,
        date: dayBefore,
        doneIds: [],
        note: 'Fever all day.',
        repair: true,
        createdAt: `${dayBefore}T20:00:00.000Z`,
        updatedAt: `${dayBefore}T20:00:00.000Z`,
      },
    ];
    await mount(studentState(plans, reports), 'student');
    expect(document.body.textContent).toContain('Daily reports to send');
    await click('Review reports');
    // Yesterday still needs its report — but the mulligan is spent.
    expect(document.body.textContent).toContain('Send report');
    expect(document.body.textContent).not.toContain('Keep my streak');
  });
});

describe('saying it quickly', () => {
  it('fills the report note from one-tap templates', async () => {
    const today = todayISO();
    const plans = [
      weekPlan({
        start: addDays(today, -2),
        items: [{ id: 'a', title: 'Maths', date: today, time: '08:00', minutes: null, subject: null, done: true }],
      }),
    ];
    await mount(studentState(plans), 'student');
    const card = query('.week-plan-card');
    await click('Report this day', card);

    await click('Ran out of time.');
    const area = query('.day-report-form textarea');
    if (!(area instanceof HTMLTextAreaElement)) throw new Error('Missing note field');
    expect(area.value).toBe('Ran out of time.');
    // A second tap appends, so mixed days read whole.
    await click('Stuck on one lesson.');
    expect(area.value).toBe('Ran out of time. Stuck on one lesson.');

    await click('Send report');
    expect(saved().panels.student.reports?.[0]?.note).toBe('Ran out of time. Stuck on one lesson.');
  });
});

describe('attaching a prep link', () => {
  it('adds a link to a lesson and sends it normalized', async () => {
    await mount(guardianState(), 'guardian');
    const nina = query('.student-card');
    await click('View student', nina);
    await openLessonsPlan();
    setValue('input[aria-label="Lesson name"]', 'Physics problems');
    await click('Add a lesson');

    await click('Add a link to Physics problems');
    setValue('.week-link-edit .input', 'example.com/worksheet');
    await click('Save', query('.week-link-edit'));

    setValue('.week-plan-composer input', 'Nina’s week');
    await click('Send the plan');
    expect(sendPlan).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendPlan).mock.calls[0]?.[2].items[0]?.url).toBe('https://example.com/worksheet');
  });

  it('refuses a link that is not a web address', async () => {
    await mount(guardianState(), 'guardian');
    const nina = query('.student-card');
    await click('View student', nina);
    await openLessonsPlan();
    setValue('input[aria-label="Lesson name"]', 'Physics problems');
    await click('Add a lesson');

    await click('Add a link to Physics problems');
    setValue('.week-link-edit .input', 'not a link at all');
    await click('Save', query('.week-link-edit'));
    expect(query('.week-plan-composer .field-error').textContent).toContain('not a valid web address');
  });

  it('opens the prep link from the student’s day row', async () => {
    const today = todayISO();
    const yesterday = addDays(today, -1);
    const plans = [
      weekPlan({
        items: [
          { id: 'a', title: 'Maths', date: yesterday, time: '08:00', minutes: null, subject: null, done: true },
          {
            id: 'b',
            title: 'Physics',
            date: today,
            time: '10:00',
            minutes: null,
            subject: null,
            url: 'https://example.com/worksheet',
            done: false,
          },
        ],
      }),
    ];
    const reports: DayReport[] = [
      {
        id: 'rep-0',
        planId: 'week-1',
        linkId: ninaLinkId,
        date: yesterday,
        doneIds: ['a'],
        note: '',
        createdAt: `${yesterday}T20:00:00.000Z`,
        updatedAt: `${yesterday}T20:00:00.000Z`,
      },
    ];
    await mount(studentState(plans, reports), 'student');
    const link = query('.week-plan-card .week-lesson-link');
    expect(link.textContent).toContain('Open link');
    expect(link.getAttribute('href')).toBe('https://example.com/worksheet');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});

describe('reacting to a report', () => {
  const dayBefore = addDays(todayISO(), -2);
  const plans = () => [
    weekPlan({
      items: [{ id: 'a', title: 'Maths', date: dayBefore, time: '08:00', minutes: null, subject: null, done: true }],
    }),
  ];
  const reports = (): DayReport[] => [
    {
      id: 'report-1',
      planId: 'week-1',
      linkId: ninaLinkId,
      date: dayBefore,
      doneIds: ['a'],
      note: '',
      createdAt: `${dayBefore}T20:00:00.000Z`,
      updatedAt: `${dayBefore}T20:00:00.000Z`,
    },
  ];

  it('taps a reaction onto a report and back off', async () => {
    await mount(guardianState(plans(), reports()), 'guardian');
    await click('View student', query('.student-card'));
    const card = query('.week-plan-card');

    await click('React with 🎉', card);
    expect(sendAck).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAck).mock.calls[0]?.[2]).toMatchObject({ text: '', reactions: ['🎉'] });
    expect(query('.week-plan-card .week-ack').textContent).toContain('🎉');

    await click('React with 🎉', query('.week-plan-card'));
    expect(vi.mocked(sendAck).mock.calls[1]?.[2]).toMatchObject({ reactions: [] });
    expect(query('.week-plan-card .week-ack').textContent).not.toContain('🎉');
  });

  it('keeps the reactions when words follow the tap', async () => {
    const acks: ReportAck[] = [
      {
        id: 'ack-1',
        reportId: 'report-1',
        planId: 'week-1',
        linkId: ninaLinkId,
        date: dayBefore,
        text: '',
        reactions: ['💪'],
        createdAt: `${dayBefore}T21:00:00.000Z`,
      },
    ];
    await mount(guardianState(plans(), reports(), acks), 'guardian');
    await click('View student', query('.student-card'));
    const card = query('.week-plan-card');
    expect(card.querySelector('.week-ack-row')).not.toBeNull();

    setValue('.week-ack-row .input', 'Well done.');
    await click('Reply', card);
    expect(sendAck).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAck).mock.calls[0]?.[2]).toMatchObject({ id: 'ack-1', text: 'Well done.', reactions: ['💪'] });
    expect(query('.week-plan-card .week-ack').textContent).toContain('💪');
  });
});

describe('waiting out a dead signal', () => {
  const queuedPlan = (): QueuedPlan => ({
    id: 'queue-1',
    linkId: ninaLinkId,
    draft: {
      cadence: 'week',
      start: todayISO(),
      title: 'Makeup week',
      note: '',
      items: [{ title: 'Maths', date: todayISO(), time: null, minutes: null, subject: null, url: null }],
    },
    createdAt: `${todayISO()}T08:00:00.000Z`,
  });

  async function openComposer(): Promise<void> {
    await mount(guardianState(), 'guardian');
    const nina = query('.student-card');
    await click('View student', nina);
    await openLessonsPlan();
    setValue('input[aria-label="Lesson name"]', 'Chemistry revision');
    await click('Add a lesson');
    setValue('.week-plan-composer input', 'Nina’s catch-up week');
  }

  it('parks the week when sending fails, then sends it on demand', async () => {
    // The send fails, and so does the automatic retry — the week keeps waiting.
    vi.mocked(sendPlan).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    await openComposer();
    await click('Send the plan');

    expect(query('.toast').textContent).toContain("it will send when you're back online");
    expect(document.querySelector('.week-plan-composer')).toBeNull();
    expect(document.body.textContent).toContain('Waiting to send');
    expect(document.body.textContent).toContain('Waiting to send (1)');
    expect(document.body.textContent).toContain('Nina’s catch-up week');
    expect(saved().panels.guardian.queuedPlans?.[0]?.draft.title).toBe('Nina’s catch-up week');

    await click('Send now');
    expect(sendPlan).toHaveBeenCalledTimes(3);
    expect(saved().panels.guardian.queuedPlans ?? []).toEqual([]);
    expect(saved().panels.guardian.links[0]?.plans[0]?.title).toBe('Nina’s catch-up week');
    expect(document.body.textContent).not.toContain('Waiting to send');
  });

  it('cancels a waiting plan', async () => {
    // The signal stays dead, so the queue survives to be cancelled by hand.
    // Twice: StrictMode mounts the auto-flush effect two times.
    vi.mocked(sendPlan).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    await mount(guardianState([], [], [], [queuedPlan()]), 'guardian');
    await click('View student', query('.student-card'));
    expect(document.body.textContent).toContain('Waiting to send');

    await click('Cancel', query('.gplan-list'));
    expect(saved().panels.guardian.queuedPlans ?? []).toEqual([]);
    expect(document.body.textContent).not.toContain('Waiting to send');
  });

  it('sends the queue on its own when the app opens', async () => {
    await mount(guardianState([], [], [], [queuedPlan()]), 'guardian');
    await click('View student', query('.student-card'));
    expect(query('.toast').textContent).toContain('Sent 1 queued plan.');
    expect(saved().panels.guardian.queuedPlans ?? []).toEqual([]);
    expect(saved().panels.guardian.links[0]?.plans[0]?.title).toBe('Makeup week');
  });
});

describe('when the send queue is full', () => {
  it('says to reconnect instead of parking an eleventh week', async () => {
    // The automatic retries fail too, so all ten stay waiting.
    vi.mocked(sendPlan)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    const full = Array.from({ length: 10 }, (_, index) => ({
      id: `queue-${index}`,
      linkId: ninaLinkId,
      draft: {
        cadence: 'week' as const,
        start: todayISO(),
        title: `Waiting week ${index}`,
        note: '',
        items: [{ title: 'Maths', date: todayISO(), time: null, minutes: null, subject: null, url: null }],
      },
      createdAt: `${todayISO()}T08:00:00.000Z`,
    }));
    await mount(guardianState([], [], [], full), 'guardian');
    const nina = query('.student-card');
    await click('View student', nina);
    await openLessonsPlan();
    setValue('input[aria-label="Lesson name"]', 'Chemistry revision');
    await click('Add a lesson');
    setValue('.week-plan-composer input', 'One week too many');
    await click('Send the plan');

    expect(query('.week-plan-composer .field-error').textContent).toContain('queue is full');
    // The composer stays open with the week intact — nothing was parked.
    const title = query('.week-plan-composer input');
    if (!(title instanceof HTMLInputElement)) throw new Error('Missing plan title');
    expect(title.value).toBe('One week too many');
  });
});

describe('changing a week that is already running', () => {
  const today = todayISO();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);

  function runningWeek(partial: Partial<GuardianPlan> = {}): GuardianPlan[] {
    return [
      weekPlan({
        start: yesterday,
        items: [
          { id: 'a', title: 'History', date: yesterday, time: '09:00', end: '10:00', minutes: null, subject: null, done: true },
          { id: 'b', title: 'Maths', date: today, time: '09:00', minutes: null, subject: null, done: false },
          { id: 'c', title: 'Chemistry', date: tomorrow, time: '14:00', end: '16:00', minutes: null, subject: null, done: false },
        ],
        ...partial,
      }),
    ];
  }

  function setField(element: Element, value: string): void {
    const field = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const prototype =
      field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    act(() => field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })));
  }

  it('locks the days behind today and changes the ones that are left', async () => {
    await mount(guardianState(runningWeek()), 'guardian');
    await click('View student', query('.student-card'));
    await click('Change plan');

    const days = [...document.querySelectorAll<HTMLButtonElement>('.week-editor-day')];
    expect(days).toHaveLength(7);
    // Yesterday is a record now: the ticks and the report filed for it stay put.
    expect(days[0]!.disabled).toBe(true);
    expect(days[0]!.textContent).toContain('Locked');
    expect(days[0]!.getAttribute('title')).toBe('This day has gone by.');
    expect(days[1]!.disabled).toBe(false);
    expect(days[1]!.getAttribute('aria-pressed')).toBe('true');

    // The open day is today's, and it already holds the lesson as it was sent.
    const panel = query('.week-editor-panel');
    expect(panel.getAttribute('aria-label')).toBe(formatFullDate(today));
    const rows = [...panel.querySelectorAll('.week-editor-lesson')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector<HTMLInputElement>('input[aria-label="Lesson name"]')!.value).toBe('Maths');
    expect(rows[0]!.querySelector<HTMLInputElement>('input[aria-label="From"]')!.value).toBe('09:00');

    // "Maths from 9 to 11", and a lesson after it: one change, one day.
    setField(rows[0]!.querySelector('input[aria-label="To"]')!, '11:00');
    expect(panel.textContent).toContain('2 h');
    const add = query('.week-editor-add');
    setField(add.querySelector('input[aria-label="Lesson name"]')!, 'Geometry');
    setField(add.querySelectorAll('input[aria-label="From"]')[0]!, '15:00');
    setField(add.querySelectorAll('input[aria-label="To"]')[0]!, '16:30');
    // Scoped to the sheet: the week behind it has buttons of its own.
    await click('Add a lesson', query('.week-editor-add'));
    const panelAfter = query('.week-editor-panel');
    // A draft lesson is still a field, so its title is a value and not text.
    expect(
      [...query('.week-editor-lessons').querySelectorAll<HTMLInputElement>('input[aria-label="Lesson name"]')].map(
        (input) => input.value,
      ),
    ).toEqual(['Maths', 'Geometry']);
    expect(panelAfter.textContent).toContain('15:00 – 16:30');
    expect(panelAfter.textContent).toContain('1 h 30 min');
    // The add row is empty again, ready for the next lesson.
    expect(query<HTMLInputElement>('.week-editor-add input[aria-label="Lesson name"]').value).toBe('');

    const save = [...query<HTMLElement>('.week-editor').querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      (button.textContent ?? '').includes('Save'),
    )!;
    expect(save.textContent).toContain('1 changed day');
    await act(async () => save.click());
    await settle();

    expect(updatePlanDays).toHaveBeenCalledTimes(1);
    const [, linkId, planId, edits] = vi.mocked(updatePlanDays).mock.calls[0]!;
    expect(linkId).toBe(ninaLinkId);
    expect(planId).toBe('week-1');
    expect(edits).toHaveLength(1);
    expect(edits![0]!.date).toBe(today);
    expect(edits![0]!.lessons.map((lesson) => [lesson.title, lesson.time, lesson.end])).toEqual([
      ['Maths', '09:00', '11:00'],
      ['Geometry', '15:00', '16:30'],
    ]);

    // The week on screen is the changed one, and the past day is untouched.
    expect(document.querySelector('.week-editor')).toBeNull();
    const card = query('.week-plan-card');
    expect(card.textContent).toContain('Geometry');
    expect(card.textContent).toContain('09:00 – 11:00');
    const stored = saved().panels.guardian.links[0]!.plans[0]!;
    expect(stored.items.find((item) => item.id === 'a')).toMatchObject({
      date: yesterday,
      time: '09:00',
      end: '10:00',
      done: true,
    });
    expect(stored.items.filter((item) => item.date === today).map((item) => item.title)).toEqual(['Maths', 'Geometry']);
  });

  it('saves nothing until something has changed, and offers no edit at all once the period is closed', async () => {
    await mount(guardianState(runningWeek()), 'guardian');
    await click('View student', query('.student-card'));
    await click('Change plan');
    const save = [...query<HTMLElement>('.week-editor').querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      (button.textContent ?? '').includes('Save'),
    )!;
    expect(save.disabled).toBe(true);
    await click('Cancel', query('.week-editor'));
    expect(document.querySelector('.week-editor')).toBeNull();

    // A period the guardian has closed is a record too.
    await click('Change plan');
    expect(document.querySelectorAll('.week-editor-day')).toHaveLength(7);
    await click('Cancel', query('.week-editor'));
  });

  it('hides the edit once the guardian has approved the period', async () => {
    const closed = runningWeek({ approvedAt: `${today}T09:00:00.000Z` });
    await mount(guardianState(closed), 'guardian');
    await click('View student', query('.student-card'));
    expect(
      [...document.querySelectorAll('button')].some((button) => (button.textContent ?? '').trim() === 'Change plan'),
    ).toBe(false);
  });
});

describe('a student asking for a change', () => {
  const today = todayISO();
  const tomorrow = addDays(today, 1);

  const plans = [
    weekPlan({
      start: today,
      items: [
        { id: 'b', title: 'Maths', date: today, time: '09:00', end: '11:00', minutes: null, subject: null, done: false },
        { id: 'c', title: 'Chemistry', date: tomorrow, time: '14:00', minutes: null, subject: null, done: false },
      ],
    }),
  ];

  function setField(element: Element, value: string): void {
    const field = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const prototype =
      field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    act(() => field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })));
  }

  it('asks for a lesson to be added, and the week waits for the guardian', async () => {
    await mount(studentState(plans), 'student');
    await click('Ask to change');
    const form = query('.week-change-form');
    expect(form.textContent).toContain('The plan stays as it is until they approve it');

    setField(form.querySelector('input[data-autofocus]')!, 'Physics');
    setField(form.querySelector('select.input')!, tomorrow);
    const times = form.querySelectorAll('input[type="time"]');
    setField(times[0]!, '16:00');
    setField(times[1]!, '17:30');
    expect(form.textContent).toContain('16:00 – 17:30');
    setField(form.querySelector('textarea')!, 'We have a test that morning.');

    await click('Send the ask');
    expect(document.querySelector('.week-change-form')).toBeNull();

    // The ask is on its way, and the week itself has not moved.
    const stored = saved().panels.student;
    expect(stored.changeRequests).toHaveLength(1);
    expect(stored.changeRequests![0]).toMatchObject({
      kind: 'add',
      title: 'Physics',
      date: tomorrow,
      time: '16:00',
      end: '17:30',
      note: 'We have a test that morning.',
      state: 'open',
      planId: 'week-1',
      linkId: ninaLinkId,
    });
    expect(stored.inbox.plans[0]!.items.map((item) => item.title)).toEqual(['Maths', 'Chemistry']);

    // And the student reads it back as waiting, with a way to take it back.
    const asks = query('.week-asks-mine');
    expect(asks.textContent).toContain('Physics');
    expect(asks.textContent).toContain('Waiting');
    await click('Take it back', asks);
    expect(saved().panels.student.changeRequests).toHaveLength(0);
  });

  it('asks for one lesson to come off, naming the lesson it means', async () => {
    await mount(studentState(plans), 'student');
    // The ask can start from the lesson itself, so it names the right one.
    const row = [...document.querySelectorAll<HTMLElement>('.week-lesson')].find((lesson) =>
      lesson.textContent?.includes('Chemistry'),
    )!;
    await click('Ask to remove', row);
    const form = query('.week-change-form');
    expect(form.textContent).toContain('Chemistry');
    expect(query('.week-change-option.is-on').textContent).toContain('Chemistry');
    await click('Send the ask');
    expect(saved().panels.student.changeRequests![0]).toMatchObject({
      kind: 'remove',
      title: 'Chemistry',
      itemId: 'c',
      date: tomorrow,
      state: 'open',
    });
  });
});

describe('a guardian answering an ask', () => {
  const today = todayISO();
  const tomorrow = addDays(today, 1);

  const plan = weekPlan({
    start: today,
    items: [{ id: 'b', title: 'Maths', date: today, time: '09:00', end: '11:00', minutes: null, subject: null, done: false }],
  });

  function ask(partial: Partial<PlanChangeRequest> = {}): PlanChangeRequest {
    return {
      id: 'change-1',
      linkId: ninaLinkId,
      planId: 'week-1',
      date: tomorrow,
      kind: 'add',
      title: 'Physics',
      time: '16:00',
      end: '17:30',
      note: 'We have a test that morning.',
      state: 'open',
      createdAt: `${today}T08:00:00.000Z`,
      ...partial,
    };
  }

  function guardianWithAsk(request: PlanChangeRequest, week: GuardianPlan = plan): PlannerState {
    const state = guardianState([week]);
    state.panels.guardian.links[0]!.changeRequests = [request];
    return state;
  }

  it('approves an ask, and the week gains the lesson on both sides', async () => {
    await mount(guardianWithAsk(ask()), 'guardian');
    await click('View student', query('.student-card'));
    const asks = query('.week-asks');
    expect(asks.textContent).toContain('Change requests');
    expect(asks.textContent).toContain('Physics');
    expect(asks.textContent).toContain('We have a test that morning.');
    expect(asks.textContent).toContain('16:00 – 17:30');

    setReply('Good idea.');
    await click('Approve', asks);

    expect(answerChangeRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(answerChangeRequest).mock.calls[0]!.slice(0, 4)).toEqual([
      expect.anything(),
      ninaLinkId,
      'change-1',
      'approved',
    ]);
    const stored = saved().panels.guardian.links[0]!;
    expect(stored.plans[0]!.items.map((item) => item.title)).toEqual(['Maths', 'Physics']);
    expect(stored.plans[0]!.items.find((item) => item.title === 'Physics')).toMatchObject({
      date: tomorrow,
      time: '16:00',
      end: '17:30',
    });
    expect(stored.changeRequests![0]).toMatchObject({ state: 'approved', reply: 'Good idea.' });
    expect(query('.week-asks').textContent).toContain('Approved');
    expect(query('.week-asks').textContent).toContain('Good idea.');
  });

  it('declines an ask with a line back, and the week stays as it was', async () => {
    await mount(guardianWithAsk(ask()), 'guardian');
    await click('View student', query('.student-card'));
    const asks = query('.week-asks');
    setReply('It is the week before the exam.');
    await click('Decline', asks);
    expect(saved().panels.guardian.links[0]!.plans[0]!.items.map((item) => item.title)).toEqual(['Maths']);
    expect(saved().panels.guardian.links[0]!.changeRequests![0]).toMatchObject({
      state: 'declined',
      reply: 'It is the week before the exam.',
    });
    expect(query('.week-asks').textContent).toContain('Declined');
  });

  it('says when the day has gone by, and leaves the decline open', async () => {
    await mount(guardianWithAsk(ask({ date: addDays(today, -1) })), 'guardian');
    await click('View student', query('.student-card'));
    const asks = query('.week-asks');
    expect(asks.textContent).toContain('That day has gone by. You can still decline it with a line back.');
    const approve = [...asks.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => (button.textContent ?? '').trim() === 'Approve',
    )!;
    expect(approve.disabled).toBe(true);
    const decline = [...asks.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => (button.textContent ?? '').trim() === 'Decline',
    )!;
    expect(decline.disabled).toBe(false);
  });

  function setReply(value: string): void {
    const input = query<HTMLInputElement>('.week-ask-actions input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
  }
});

describe('reading the page before it goes to paper', () => {
  const today = todayISO();

  it('shows the printed week in the app, on both pages', async () => {
    await mount(
      studentState([
        weekPlan({
          start: today,
          items: [
            { id: 'b', title: 'Maths', date: today, time: '09:00', end: '11:00', minutes: null, subject: null, done: false },
          ],
        }),
      ]),
      'student',
    );
    // The button is an icon with the plan named in its label, so it is found
    // by what it says rather than by an exact text match.
    const previewButton = [...document.querySelectorAll<HTMLButtonElement>('.week-card-actions button')].find((button) =>
      (button.getAttribute('aria-label') ?? '').startsWith('Preview and print'),
    )!;
    expect(previewButton).toBeTruthy();
    await act(async () => previewButton.click());
    await settle();

    const preview = query('.print-preview');
    expect(preview.textContent).toContain('nothing else from the app goes on it');
    const frame = query<HTMLIFrameElement>('.print-preview-frame');
    const page = frame.getAttribute('srcdoc') ?? '';
    // The document itself: the times are on the page, not only in the app.
    expect(page).toContain('A week of lessons');
    expect(page).toContain('Maths');
    expect(page).toContain('09:00');
    expect(page).toContain('11:00');
    expect(page).toContain('2 h');

    // And the wall version of the same week, without leaving the app.
    await click('Timetable', query('.print-preview-tabs'));
    const wall = query<HTMLIFrameElement>('.print-preview-frame').getAttribute('srcdoc') ?? '';
    expect(wall).toContain('tt-lesson');
    expect(wall).toContain('Maths');

    // Both ways out are beside the page: print it, or keep it as a file.
    expect(query('.print-preview-actions').textContent).toContain('Print');
    expect(query('.print-preview-actions').textContent).toContain('Download');
    await click('Close', query('.sheet-print-preview'));
    expect(document.querySelector('.print-preview')).toBeNull();
  });
});
