import { expect, test } from '@playwright/test';
import { bootOffline, expectPlannerReady } from './support';

test.beforeEach(async ({ page }) => {
  await bootOffline(page);
  await page.goto('/#/today');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('planner-tour-done', '1'); // specs here are not about the tour
  });
  await page.reload();
});

test('quick add a repeating task, complete it, and see the next one', async ({ page }) => {
  const input = page.locator('.quick-add input');
  await input.fill('Stretch every day');
  await input.press('Enter');
  await expect(page.locator('.repeat-chip').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mark Stretch complete' }).first().click();
  const tasks = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}').tasks.length);
  expect(tasks).toBe(2);
});

test('task board drag and drop moves a task to Today', async ({ page }) => {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: 'Add task' }).first().click();
  await page.locator('[role="dialog"] input[data-autofocus]').first().fill('Someday idea');
  await page.locator('[role="dialog"] input[type="date"]').first().fill('');
  await page.locator('[role="dialog"] form').first().evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.getByRole('radio', { name: 'Board' }).click();
  const card = page.locator('.board-card', { hasText: 'Someday idea' });
  const today = page.locator('.board-today');
  await expect(page.locator('.board-anytime')).toContainText('Someday idea');

  // `card.dragTo(today)` drove the browser's own drag pipeline and never
  // delivered a drop (the column showed its "Drop here" hint and kept zero
  // tasks). Dispatching the three events the board actually listens to, with
  // one DataTransfer shared between them, tests the app's contract — dragstart
  // writes `task:<id>`, dragover accepts the column, drop reads it back.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent('dragstart', { dataTransfer });
  await today.dispatchEvent('dragover', { dataTransfer });
  await today.dispatchEvent('drop', { dataTransfer });
  await expect(today).toContainText('Someday idea');

  // The keyboard path is the accessible half of the same move and does not
  // depend on pointer machinery: the focused card moves one column with the
  // arrow keys. Today → Tomorrow, because that is the next column that accepts
  // a drop.
  const moved = page.locator('.board-card', { hasText: 'Someday idea' });
  await moved.focus();
  await moved.press('ArrowRight');
  await expect(page.locator('.board-tomorrow')).toContainText('Someday idea');
  await expect(today).not.toContainText('Someday idea');
});

test('works offline after the first visit', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service worker check runs in Chromium');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.quick-add')).toBeVisible();
  await context.setOffline(false);
});

test('settings expose sync, reminders and calendar tools', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  // Settings groups its panels in tabs and only mounts the open one, so each
  // claim is checked in the tab that owns it.
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('tab', { name: 'Sync & backup' }).click();
  await expect(sheet.getByText('Sync across devices')).toBeVisible();
  await sheet.getByRole('tab', { name: 'Reminders' }).click();
  await expect(sheet.getByText('Reminders').first()).toBeVisible();
  await sheet.getByRole('tab', { name: 'Connections' }).click();
  await expect(sheet.getByRole('button', { name: /Export \.ics/ })).toBeVisible();
});

test('keyboard users can reach the main navigation', async ({ page }) => {
  // Wait for the shell: pressing Tab while the account gate is still swapping
  // itself for the planner leaves focus on an element that is about to
  // disappear, and the first tab stop is then nobody.
  await expectPlannerReady(page);
  await page.keyboard.press('Tab');
  const firstStop = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
  expect(firstStop, 'the first Tab should land on the skip link').toBe('Skip to content');
  await page.keyboard.press('Enter');
  await expect(page.locator('#content')).toBeFocused();
});
