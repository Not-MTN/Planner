import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
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
  await expect(page.locator('.board-anytime')).toContainText('Someday idea');
  await card.dragTo(page.locator('.board-today'));
  await expect(page.locator('.board-today')).toContainText('Someday idea');
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
  await expect(page.getByText('Sync across devices')).toBeVisible();
  await expect(page.getByText('Reminders', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Export \.ics/ })).toBeVisible();
});

test('keyboard users can reach the main navigation', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(page.getByText('Skip to content')).toBeFocused();
});
