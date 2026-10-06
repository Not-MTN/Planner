import { expect, test } from '@playwright/test';
import { bootOffline } from './support';

type LayoutCase = {
  name: string;
  width: number;
  height: number;
  language: 'en' | 'fa';
  theme: 'light' | 'dark';
};

const layouts: LayoutCase[] = [
  { name: 'small phone', width: 320, height: 740, language: 'fa', theme: 'dark' },
  { name: 'phone', width: 390, height: 844, language: 'en', theme: 'light' },
  { name: 'tablet portrait', width: 768, height: 1024, language: 'fa', theme: 'light' },
  { name: 'tablet landscape', width: 1024, height: 768, language: 'en', theme: 'dark' },
  { name: 'desktop', width: 1440, height: 900, language: 'fa', theme: 'dark' },
];

async function bootPlanner(page: import('@playwright/test').Page, language: LayoutCase['language'], theme: LayoutCase['theme']) {
  await bootOffline(page);
  await page.goto('/#/today');
  await page.evaluate(({ nextLanguage, nextTheme }) => {
    localStorage.clear();
    localStorage.setItem('planner-tour-done', '1');
    localStorage.setItem('planner-lang', nextLanguage);
    localStorage.setItem('planner-theme', nextTheme);
  }, { nextLanguage: language, nextTheme: theme });
  await page.reload();
  await expect(page.locator('.quick-add input')).toBeVisible();
}

for (const layout of layouts) {
  test(`${layout.name} layout stays inside the viewport (${layout.language}, ${layout.theme})`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await bootPlanner(page, layout.language, layout.theme);

    await expect(page.locator('html')).toHaveAttribute('dir', layout.language === 'fa' ? 'rtl' : 'ltr');
    await expect(page.locator('html')).toHaveAttribute('data-theme', layout.theme);
    await expect(page.locator('.timeline-card')).toBeVisible();
    if (layout.width < 768) await expect(page.locator('.tabbar')).toBeVisible();
    else await expect(page.locator('.tabbar')).toBeHidden();
    if (layout.width >= 768 && layout.width < 1024) await expect(page.locator('.side-nav-rail')).toBeVisible();

    const dimensions = await page.evaluate(() => {
      const rect = document.querySelector<HTMLElement>('.content')?.getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        content: rect ? { left: rect.left, right: rect.right } : null,
      };
    });
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.content).toBeTruthy();
    expect(dimensions.content!.left).toBeGreaterThanOrEqual(-1);
    expect(dimensions.content!.right).toBeLessThanOrEqual(layout.width + 1);
  });
}

test('tablet navigation flyout announces its state and returns keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1024 });
  await bootPlanner(page, 'en', 'light');
  const plan = page.locator('.side-nav-rail .rail-btn[aria-label="Plan"]');
  await plan.click();

  const flyout = page.locator('#tablet-flyout');
  await expect(plan).toHaveAttribute('aria-expanded', 'true');
  await expect(flyout).toHaveAttribute('role', 'dialog');
  await expect(flyout).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('.tablet-flyout-close')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(flyout).toHaveCount(0);
  await expect(plan).toHaveAttribute('aria-expanded', 'false');
  await expect(plan).toBeFocused();
});
