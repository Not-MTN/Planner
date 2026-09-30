// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { addDays, setWeekStart, todayISO } from './dates';
import { setLang } from './i18n';
import { addTask, logFocus } from './mutate';
import { weekOf, withLinkPlan } from './panels';
import { shortWeek } from './components/charts';
import { postNotice, sendPlan, type PlanDraft } from './auth/links';
import { createEmptyState, type GuardianLink, type GuardianPlan, type Panels, type PlannerState } from './types';

vi.mock('./auth/links', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth/links')>();
  return {
    ...actual,
    syncLinks: vi.fn(async (panels: Panels) => ({ panels, changed: false })),
    refreshResults: vi.fn(async (panels: Panels) => ({ panels, changed: false })),
    readNotices: vi.fn(async (panels: Panels) => ({ panels, changed: false })),
    syncStudentInbox: vi.fn(async (panels: Panels) => ({
      panels,
      changed: false,
      added: { notices: [], plans: [] },
      relayed: 0,
    })),
    shareWeeklyResults: vi.fn(async (_state: PlannerState, panels: Panels) => ({ panels, sent: 0 })),
    sendPlan: vi.fn(async (panels: Panels, linkId: string, draft: PlanDraft) => {
      const now = new Date().toISOString();
      const plan: GuardianPlan = {
        ...draft,
        id: 'sent-plan',
        linkId,
        author: 'Dr Noor',
        createdAt: now,
        updatedAt: now,
        items: draft.items.map((item, index) => ({ ...item, id: `step-${index}`, done: false })),
      };
      return withLinkPlan(panels, linkId, plan);
    }),
    postNotice: vi.fn(async (panels: Panels, _linkId: string, summary: string) => ({
      ...panels,
      guardian: {
        ...panels.guardian,
        notices: [
          {
            id: 'sent-note',
            student: 'alice',
            author: 'Dr Noor',
            summary,
            weekOf: weekOf(),
            createdAt: new Date().toISOString(),
            read: true,
          },
          ...panels.guardian.notices,
        ],
      },
    })),
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
const aliceLinkId = '11111111-1111-1111-1111-111111111111';
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
        <App initialState={state} />
      </StrictMode>,
    ),
  );
  for (
    let index = 0;
    index < 6 && !document.querySelector(route === 'student' ? '.student-panel-view' : '.guardian-roster');
    index += 1
  )
    await settle();
}

function studentState(): PlannerState {
  let state = createEmptyState();
  state.panels.student = {
    ...state.panels.student,
    enabled: true,
    field: 'Science',
    grade: 'school-11',
    subjects: [
      { id: 'physics', name: 'Physics', accent: 'blue', targetMinutes: 60, examDate: addDays(todayISO(), 2) },
      { id: 'maths', name: 'Maths', accent: 'sage', targetMinutes: 120, examDate: null },
    ],
    explanations: [
      {
        id: 'explain',
        summary: 'A lighter week',
        reason: 'PRIVATE_REASON',
        weekOf: weekOf(),
        createdAt: new Date().toISOString(),
      },
    ],
  };
  state = addTask(
    state,
    {
      title: 'PRIVATE_TASK_TITLE',
      category: 'Physics',
      dueDate: todayISO(),
      dueTime: null,
      note: 'PRIVATE_NOTE',
      priority: 'medium',
      goalId: null,
      estimatedMinutes: 25,
    },
    'physics-task',
  );
  state = addTask(
    state,
    {
      title: 'Personal errand',
      category: 'personal',
      dueDate: todayISO(),
      dueTime: null,
      note: '',
      priority: 'medium',
      goalId: null,
    },
    'personal',
  );
  state = logFocus(state, { taskId: 'physics-task', title: 'PRIVATE_TASK_TITLE', minutes: 30 });
  return state;
}

function guardianState(): PlannerState {
  const state = createEmptyState();
  const base: GuardianLink = {
    id: 'alice',
    username: 'alice',
    displayName: 'Alice',
    status: 'linked',
    history: [],
    linkId: aliceLinkId,
    code: null,
    wrappedShareKey: shareKey,
    results: {
      weekOf: weekOf(),
      planned: 4,
      done: 3,
      focusMinutes: 75,
      subjects: [{ name: 'Physics', minutes: 75 }],
      headline: 'A steady week',
      updatedAt: new Date().toISOString(),
    },
    plans: [],
  };
  state.panels.guardian = {
    ...state.panels.guardian,
    enabled: true,
    kind: 'advisor',
    field: 'Science',
    links: [
      base,
      {
        ...base,
        id: 'amir',
        username: 'amir',
        displayName: 'Amir',
        results: { ...base.results!, weekOf: addDays(weekOf(), -7) },
      },
      { ...base, id: 'nina', username: 'nina', displayName: 'Nina', linkId: ninaLinkId, results: null },
      { ...base, id: 'sara', username: 'sara', displayName: 'Sara', status: 'pending', results: null },
    ],
    notices: [],
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
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollTo = () => undefined;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  setLang('en');
  vi.unstubAllGlobals();
});

describe('actionable student panel', () => {
  it('adds subject-linked tasks from exam preparation, opens focus, and completes tasks in the real planner', async () => {
    await mount(studentState());
    expect(query('.study-task-list').textContent).not.toContain('Personal errand');
    await click('Add revision for Physics');
    expect(query<HTMLInputElement>('.study-task-form input').value).toBe('Revise Physics');
    setValue('.study-task-form input', 'Practice exam questions');
    setValue('.study-task-form input[type="number"]', '30');
    await click('Save study task');
    expect(saved().tasks.find((task) => task.title === 'Practice exam questions')).toMatchObject({
      category: 'Physics',
      dueDate: todayISO(),
      estimatedMinutes: 30,
    });
    await click('Focus on Practice exam questions');
    expect(query('.focus-title').textContent).toBe('Practice exam questions');
    await click('End focus session');
    await act(async () => query<HTMLInputElement>('input[aria-label="Complete Practice exam questions"]').click());
    await settle();
    expect(saved().tasks.find((task) => task.title === 'Practice exam questions')?.completed).toBe(true);
    expect(document.querySelector('input[aria-label="Complete Practice exam questions"]')).toBeNull();
  });

  it('edits subjects and keeps task ids, focus minutes, and categories in step', async () => {
    await mount(studentState());
    await click('Edit Physics');
    setValue('.subject-form input', 'Physical science');
    setValue('.subject-form input[type="number"]', '1.5');
    await click('Save subject');
    expect(saved().panels.student.subjects[0]).toMatchObject({
      id: 'physics',
      name: 'Physical science',
      targetMinutes: 90,
    });
    expect(saved().tasks[0]).toMatchObject({ id: 'physics-task', category: 'Physical science' });
    expect(query('.subject-tile').textContent).toContain('30m');
    expect(query('.subject-tile [role="progressbar"]').getAttribute('aria-valuenow')).toBe('33');
  });

  it('rejects duplicate subjects with an inline error instead of silently adding another tracker', async () => {
    await mount(studentState());
    await click('Subject');
    setValue('.subject-form input', ' physics ');
    await click('Add subject');
    expect(query('.subject-form [role="alert"]').textContent).toContain('already track');
    expect(document.querySelectorAll('.subject-tile')).toHaveLength(2);
  });

  it('confirms removing a subject and leaves its tasks and focus history intact', async () => {
    await mount(studentState());
    await click('Remove Physics');
    expect(query('[role="dialog"]').textContent).toContain('tasks, events, and focus history are kept');
    await click('Remove subject');
    expect(saved().panels.student.subjects.map((subject) => subject.name)).toEqual(['Maths']);
    expect(saved().tasks[0].id).toBe('physics-task');
    expect(saved().focusLog).toHaveLength(1);
  });

  it('previews exactly the weekly sharing boundary, never private task titles, reasons, or notes', async () => {
    await mount(studentState());
    const preview = query('.panel-sharing-preview');
    await act(async () => query<HTMLElement>('.panel-sharing-preview summary').click());
    expect(preview.textContent).toContain('A lighter week');
    expect(preview.textContent).toContain('Physics');
    expect(preview.textContent).not.toContain('PRIVATE_TASK_TITLE');
    expect(preview.textContent).not.toContain('PRIVATE_REASON');
    expect(preview.textContent).not.toContain('PRIVATE_NOTE');
    expect(preview.textContent).not.toContain(addDays(todayISO(), 2));
    const axis = query('.student-charts .chart-axis');
    expect(axis.firstElementChild?.textContent).toBe(shortWeek(addDays(weekOf(), -35)));
    expect(axis.lastElementChild?.textContent).toBe(shortWeek(weekOf()));
    expect(query('.completion-ring').getAttribute('aria-label')).toContain('planned items');
  });

  it('renders the new study controls in Persian', async () => {
    setLang('fa');
    await mount(studentState());
    expect(document.documentElement.dir).toBe('rtl');
    expect(query('.study-queue-card').textContent).toContain('صف مطالعهٔ شما');
    expect(query('.exam-agenda').textContent).toContain('امتحان‌های پیش رو');
  });
});

describe('guardian roster and planning', () => {
  it('searches and filters the roster and recovers from a no-match result', async () => {
    await mount(guardianState(), 'guardian');
    expect(document.querySelectorAll('.student-card')).toHaveLength(4);
    setValue('input[aria-label="Search students"]', '@ALICE');
    expect(document.querySelectorAll('.student-card')).toHaveLength(1);
    expect(query('.student-card').textContent).toContain('Alice');
    setValue('input[aria-label="Search students"]', '');
    setValue('select[aria-label="Filter students"]', 'waiting');
    expect(document.querySelectorAll('.student-card')).toHaveLength(2);
    expect(document.body.textContent).toContain('Linked. Their first results');
    setValue('select[aria-label="Filter students"]', 'older');
    expect(query('.student-name').textContent).toBe('Amir');
    setValue('input[aria-label="Search students"]', 'Nobody');
    expect(document.body.textContent).toContain('No matching students');
    await click('Clear filters');
    expect(document.querySelectorAll('.student-card')).toHaveLength(4);
  });

  it('sends a dated plan to a linked student even before the first weekly results arrive', async () => {
    await mount(guardianState(), 'guardian');
    const nina = [...document.querySelectorAll('.student-card')].find(
      (card) => card.querySelector('.student-name')?.textContent === 'Nina',
    )!;
    await click('View student', nina);
    expect(nina.textContent).toContain('before their first results arrive');
    await click('A week', nina);
    setValue('.guardian-plan-composer input', 'Physics revision');
    setValue('input[aria-label="Step 1 title"]', 'Practice chapter 4');
    setValue('input[aria-label="Step 1 subject"]', 'Physics');
    setValue('input[aria-label="Step 1 minutes"]', '25');
    setValue('input[aria-label="Step 1 date"]', todayISO());
    await click('Send the plan');
    expect(sendPlan).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendPlan).mock.calls[0][1]).toBe(ninaLinkId);
    expect(vi.mocked(sendPlan).mock.calls[0][2].items).toEqual([
      { title: 'Practice chapter 4', subject: 'Physics', minutes: 25, date: todayISO() },
    ]);
    expect(saved().panels.guardian.links.find((link) => link.id === 'nina')?.plans[0].title).toBe('Physics revision');
    expect(document.querySelector('.guardian-plan-composer')).toBeNull();
  });

  it('offers editable starters and prevents sending dates outside the selected plan', async () => {
    await mount(guardianState(), 'guardian');
    const alice = [...document.querySelectorAll('.student-card')].find(
      (card) => card.querySelector('.student-name')?.textContent === 'Alice',
    )!;
    await click('View student', alice);
    await click('A week', alice);
    await click('Exam preparation');
    expect(document.querySelectorAll('.plan-step-row')).toHaveLength(3);
    expect(query('.plan-composer-summary').textContent).toContain('1h 5m');
    setValue('input[aria-label="Step 1 date"]', addDays(weekOf(), 7));
    // Dispatch submit directly to exercise app validation in addition to native date bounds.
    await act(async () =>
      query<HTMLFormElement>('.guardian-plan-composer').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    expect(query('.guardian-plan-composer [role="alert"]').textContent).toContain('inside the plan');
    expect(sendPlan).not.toHaveBeenCalled();
  });

  it('turns an AI question into an editable message and sends it to the shared circle', async () => {
    await mount(guardianState(), 'guardian');
    const alice = [...document.querySelectorAll('.student-card')].find(
      (card) => card.querySelector('.student-name')?.textContent === 'Alice',
    )!;
    await click('View student', alice);
    await click('Ask', alice);
    await click('Use this question', alice);
    expect(query<HTMLTextAreaElement>('.notice-form textarea').value).toBe('What would help with revision?');
    await click('Send note', alice);
    expect(postNotice).toHaveBeenCalledWith(expect.anything(), aliceLinkId, 'What would help with revision?');
    expect(query('.notice-card').textContent).toContain('What would help with revision?');
    expect(query<HTMLTextAreaElement>('.notice-form textarea').value).toBe('');
  });
});
