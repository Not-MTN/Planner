import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/today');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('first visit asks for a language, then teaches the app step by step', async ({ page }) => {
  const bubble = page.locator('[data-tour-bubble]');
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('Welcome to Planner');
  await expect(bubble.getByRole('button', { name: /English/ })).toBeVisible();

  await bubble.getByRole('button', { name: /English/ }).click();

  // Walks the day → quick add → plan … each with a spotlight.
  await expect(bubble).toContainText('Your day at a glance');
  await expect(bubble).toContainText('Tour 1 of 13');
  await expect(page.locator('.tour-spot')).toBeVisible();

  // Showcase: the page under the overlay cannot be pressed.
  await page.locator('.quick-add input').click({ position: { x: 4, y: 4 }, timeout: 1200 }).catch(() => undefined);
  await expect(page.locator('.quick-add input')).not.toBeFocused();

  await bubble.getByRole('button', { name: 'Next' }).click();
  await expect(bubble).toContainText('Type like you think');
  await bubble.getByRole('button', { name: 'Next' }).click();
  await expect(bubble).toContainText('One tap plans the day');
  await bubble.getByRole('button', { name: 'Next' }).click();
  await expect(bubble).toContainText('Your hours, gently held');
  await bubble.getByRole('button', { name: 'Back' }).click();
  await expect(bubble).toContainText('One tap plans the day');

  // Walk to the end and finish.
  for (let i = 0; i < 10; i += 1) {
    await bubble.getByRole('button', { name: 'Next' }).click();
  }
  await expect(bubble).toContainText("That's the whole tour");
  await bubble.getByRole('button', { name: 'Start planning' }).click();
  await expect(bubble).toHaveCount(0);

  // Remembered: reload shows no tour.
  await page.reload();
  await expect(bubble).toHaveCount(0);
});

test('Escape skips the whole tour', async ({ page }) => {
  const bubble = page.locator('[data-tour-bubble]');
  await expect(bubble).toBeVisible();
  await bubble.press('Escape');
  await expect(bubble).toHaveCount(0);
  await page.reload();
  await expect(bubble).toHaveCount(0);
});

test('choosing فارسی reloads with RTL and resumes where the tour left off', async ({ page }) => {
  const bubble = page.locator('[data-tour-bubble]');
  await expect(bubble).toBeVisible();
  await bubble.getByRole('button', { name: /فارسی/ }).click();
  await expect(bubble).toBeVisible({ timeout: 8000 });
  await expect(bubble).not.toContainText('Pick your language');
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
  await bubble.getByRole('button', { name: 'رد کردن تور' }).click();
  await expect(bubble).toHaveCount(0);
});

test('the tour only reopens from the how-it-works buttons', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('planner-tour-done', '1'));
  await page.reload();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-tour-bubble]')).toHaveCount(0); // no auto-replay

  const isMobile = await page.evaluate(() => window.innerWidth < 760);
  if (isMobile) {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'How Planner works' }).click();
  } else {
    await page.getByTitle('How Planner works').click();
  }
  const bubble = page.locator('[data-tour-bubble]');
  await expect(bubble).toBeVisible();
  await bubble.getByRole('button', { name: 'Skip tour' }).click();
  await expect(bubble).toHaveCount(0);
});

test('the Why Planner sheet opens from settings and offers the tour', async ({ page, isMobile }) => {
  test.skip(isMobile ?? false, 'desktop sidebar settings');
  await page.evaluate(() => localStorage.setItem('planner-tour-done', '1'));
  await page.reload();
  await page.locator('[data-tour="settings"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('New here?');
  await dialog.getByRole('button', { name: 'Why Planner?' }).click();
  const about = page.getByRole('dialog');
  await expect(about).toContainText('Private by design');
  await expect(about).toContainText('Works everywhere');
  await about.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
