import { expect, test, type Page } from '@playwright/test';
import { bootOffline } from './support';
import { addDays, todayISO } from '../src/dates';
import { addTask, logFocus } from '../src/mutate';
import { weekOf } from '../src/panels';
import { createEmptyState, type GuardianLink, type PlannerState } from '../src/types';

/** Local/offline fixture: no fake accounts or authentication bypass in the app itself. */
function panelFixture(): PlannerState {
  let state = createEmptyState();
  state.panels.student = {
    ...state.panels.student,
    enabled: true,
    field: 'Natural sciences',
    grade: 'school-11',
    subjects: [
      { id: 'physics', name: 'Physics', accent: 'blue', examDate: addDays(todayISO(), 2), targetMinutes: 120 },
      { id: 'maths', name: 'Mathematics', accent: 'sage', examDate: null, targetMinutes: 180 },
    ],
    explanations: [
      {
        id: 'headline',
        weekOf: weekOf(),
        summary: 'A lighter week',
        reason: 'PRIVATE_REASON',
        createdAt: new Date().toISOString(),
      },
    ],
  };
  state = addTask(
    state,
    {
      title: 'Private physics homework',
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
  state = logFocus(state, { taskId: 'physics-task', title: 'Private physics homework', minutes: 30 });
  const base: GuardianLink = {
    id: 'alice',
    username: 'alice',
    displayName: 'Alice Bennett',
    status: 'linked',
    linkId: '11111111-1111-1111-1111-111111111111',
    wrappedShareKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
    code: null,
    history: [],
    plans: [],
    results: {
      weekOf: weekOf(),
      planned: 5,
      done: 3,
      focusMinutes: 90,
      subjects: [{ name: 'Physics', minutes: 90 }],
      headline: 'A steady week',
      updatedAt: new Date().toISOString(),
    },
  };
  state.panels.guardian = {
    enabled: true,
    kind: 'advisor',
    field: 'Science',
    notices: [],
    links: [
      base,
      {
        ...base,
        id: 'amir',
        username: 'amir',
        displayName: 'Amir Hassan',
        results: { ...base.results!, weekOf: addDays(weekOf(), -7) },
      },
      { ...base, id: 'nina', username: 'nina', displayName: 'Nina Patel', results: null },
      { ...base, id: 'sara', username: 'sara', displayName: 'Sara Williams', status: 'pending', results: null },
    ],
  };
  return state;
}

async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  // Exercise the supported offline boot with the saved planner, not the sign-in flow.
  await bootOffline(page);
  await page.addInitScript((state) => {
    if (localStorage.getItem('panel-e2e-seeded')) return;
    localStorage.clear();
    localStorage.setItem('planner-tour-done', '1');
    localStorage.setItem('planner-week-start', '1');
    localStorage.setItem('personal-planner.v1', JSON.stringify(state));
    localStorage.setItem('panel-e2e-seeded', '1');
  }, panelFixture());
});

test('student panels add revision tasks, focus, complete, and preserve subject edits on reload', async ({ page }) => {
  await page.goto('/app#/student');
  await page.getByRole('button', { name: 'Add revision for Physics', exact: true }).click();
  const form = page.locator('.study-task-form');
  await form.getByLabel('Study task', { exact: true }).fill('Practice exam questions');
  await form.getByLabel('Estimated minutes', { exact: true }).fill('30');
  await form.getByRole('button', { name: 'Save study task' }).click();
  await expect(page.locator('.study-task-list')).toContainText('Practice exam questions');
  await page.getByRole('button', { name: 'Focus on Practice exam questions' }).click();
  await expect(page.getByRole('dialog', { name: 'Focus session' })).toBeVisible();
  await page.getByRole('button', { name: 'End focus session' }).click();
  // Completing a queued task immediately removes its row, so assert stored completion rather than a detached checkbox.
  await page.getByRole('checkbox', { name: 'Complete Practice exam questions', exact: true }).click();
  await expect(page.locator('.study-task-list')).not.toContainText('Practice exam questions');
  await page.getByRole('button', { name: 'Edit Physics', exact: true }).click();
  await page.locator('.subject-form').getByLabel('Subject', { exact: true }).fill('Physical science');
  await page.locator('.subject-form').getByLabel('Target hours per week').fill('1.5');
  await page.getByRole('button', { name: 'Save subject', exact: true }).click();
  await page.reload();
  await expect(page.locator('.subject-tile').first()).toContainText('Physical science');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}'));
  expect(stored.tasks.find((task: { title: string }) => task.title === 'Practice exam questions')).toMatchObject({
    completed: true,
    category: 'Physical science',
  });
  expect(stored.panels.student.subjects[0].targetMinutes).toBe(90);
  await expectNoOverflow(page);
});

test('student panels show only weekly results in the guardian preview', async ({ page }) => {
  await page.goto('/app#/student');
  await page.locator('.panel-sharing-preview summary').click();
  const preview = page.locator('.sharing-preview-body');
  await expect(preview).toContainText('A lighter week');
  await expect(preview).toContainText('Physics');
  await expect(preview).not.toContainText('Private physics homework');
  await expect(preview).not.toContainText('PRIVATE_NOTE');
  await expect(preview).not.toContainText('PRIVATE_REASON');
});

test('guardian panels filter the roster and offer editable dated plan starters', async ({ page }) => {
  await page.goto('/app#/guardian');
  await expect(page.locator('.student-card')).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Search students' }).fill('@ALICE');
  await expect(page.locator('.student-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search students' }).fill('');
  await page.getByLabel('Filter students').selectOption('waiting');
  await expect(page.locator('.student-card')).toHaveCount(2);
  await expect(page.locator('.student-card', { hasText: 'Nina Patel' })).toContainText('Awaiting results');
  await expect(page.locator('.student-card', { hasText: 'Sara Williams' })).toContainText('Invitation pending');
  await page.getByLabel('Filter students').selectOption('all');
  const alice = page.locator('.student-card', { hasText: 'Alice Bennett' });
  await alice.getByRole('button', { name: 'View student', exact: true }).click();
  await alice.getByRole('button', { name: 'A week', exact: true }).click();
  await page.getByRole('button', { name: 'Exam preparation', exact: true }).click();
  await expect(page.locator('.plan-step-row')).toHaveCount(3);
  await expect(page.locator('.plan-composer-summary')).toContainText('1h 5m');
  await page.getByLabel('Step 1 title', { exact: true }).fill('Review chapter 4');
  await page.getByLabel('Step 1 date', { exact: true }).fill(addDays(weekOf(), 7));
  expect(
    await page
      .getByLabel('Step 1 date', { exact: true })
      .evaluate((element: HTMLInputElement) => element.validity.rangeOverflow),
  ).toBe(true);
  await expectNoOverflow(page);
});

test('panels keep forms usable in Persian, dark mode, and narrow layouts', async ({ page }) => {
  await page.goto('/app#/student');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    localStorage.setItem('planner-lang', 'fa');
    localStorage.setItem('planner-theme', 'dark');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.study-queue-card')).toContainText('صف مطالعهٔ شما');
  await page.getByRole('button', { name: 'افزودن کار مطالعاتی', exact: true }).click();
  await expect(page.locator('.study-task-form')).toBeVisible();
  await expectNoOverflow(page);
  await page.goto('/app#/guardian');
  await expect(page.locator('.guardian-roster')).toContainText('به‌روز در این هفته');
  await page.locator('.student-card').first().getByRole('button', { name: 'نمایش دانش‌آموز', exact: true }).click();
  await page.getByRole('button', { name: 'یک هفته', exact: true }).click();
  await expect(page.locator('.guardian-plan-composer')).toBeVisible();
  await expectNoOverflow(page);
});
