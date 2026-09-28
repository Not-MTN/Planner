import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/today');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('first open asks for a language, then walks the app', async ({ page }) => {
  const bubble = page.locator('[data-tour-bubble]');
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('Welcome to Planner');
  await expect(bubble).toContainText('Pick your language');

  await bubble.getByRole('button', { name: 'English' }).click();
  await expect(bubble).toContainText('Type like you think');
  await expect(page.locator('.tour-spot')).toBeVisible();

  await bubble.getByRole('button', { name: 'Next' }).click();
  await expect(bubble).toContainText('One tap plans the day');
  await bubble.getByRole('button', { name: 'Next' }).click();
  await expect(bubble).toContainText('Your hours');
  await bubble.getByRole('button', { name: 'Back' }).click();
  await expect(bubble).toContainText('One tap plans the day');
  await bubble.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.locator('[data-tour-bubble]')).toHaveCount(0);

  // Done is remembered: a reload shows no tour.
  await page.reload();
  await expect(page.locator('[data-tour-bubble]')).toHaveCount(0);
});

test('switching language on the first step reloads and resumes the tour', async ({ page }) => {
  const bubble = page.locator('[data-tour-bubble]');
  await expect(bubble).toBeVisible();
  await bubble.getByRole('button', { name: 'فارسی' }).click();
  // After the reload the tour is past the language step, in Persian.
  await expect(bubble).toBeVisible({ timeout: 8000 });
  await expect(bubble).not.toContainText('Pick your language');
  const dir = await page.evaluate(() => document.documentElement.dir);
  expect(dir).toBe('rtl');
});

test('the small how-it-works button replays the tour', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium' || (await page.evaluate(() => window.innerWidth < 760)).valueOf(), 'Sidebar replay check runs on desktop chromium');
  await page.evaluate(() => localStorage.setItem('planner-tour-done', '1'));
  await page.reload();
  await page.getByRole('button', { name: 'How Planner works' }).first().click();
  await expect(page.locator('[data-tour-bubble]')).toBeVisible();
  await page.locator('[data-tour-bubble]').getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.locator('[data-tour-bubble]')).toHaveCount(0);
});
