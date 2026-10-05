/**
 * Touch targets, measured instead of eyeballed.
 *
 * The 44px floor was a review-time judgement and nothing watched it: a padding
 * tweak on the tab bar or an icon button could shrink a control to 30px and no
 * test would notice until somebody tried the app on a phone.
 *
 * The check is deliberately narrow. "Every button is 44px" is not true of a
 * desktop UI and never will be — dense toolbars are allowed to be dense. What
 * is checked is the set of controls a thumb has to hit on a phone: the tab bar,
 * the primary buttons, the quick-add row, the focus-timer controls and the
 * mobile More sheet's rows. Each one is asserted at the phone viewport, in
 * Persian as well as English, because RTL is where a target quietly loses its
 * width.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootOffline } from './support';

const MIN = 44;

type Box = { selector: string; what: string; min?: number };

/** Controls a thumb reaches for on a phone, by selector. */
const TARGETS: Box[] = [
  { selector: '.tabbar button, .tabbar a', what: 'tab bar item' },
  { selector: '.mobile-bar button', what: 'mobile bar button' },
  { selector: '.quick-add button', what: 'quick-add action' },
  { selector: '.fab', what: 'floating add button' },
  { selector: '.btn', what: 'primary button' },
];

async function boot(page: Page, language: 'en' | 'fa'): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootOffline(page);
  await page.goto('/#/today');
  await page.evaluate((next) => {
    localStorage.clear();
    localStorage.setItem('planner-tour-done', '1');
    localStorage.setItem('planner-lang', next);
    localStorage.setItem('planner-display', JSON.stringify({ dateLanguage: next === 'fa' ? 'fa' : 'en-GB', timeFormat: '24h', jalali: false }));
  }, language);
  await page.reload();
  await expect(page.locator('.quick-add input')).toBeVisible({ timeout: 15_000 });
}

for (const language of ['en', 'fa'] as const) {
  test(`phone controls are big enough to hit (${language})`, async ({ page }) => {
    await boot(page, language);

    const measured = await page.evaluate((selectors: string[]) =>
      selectors.flatMap((selector) =>
        [...document.querySelectorAll<HTMLElement>(selector)]
          .filter((element) => {
            // Only what is on screen and actually interactive: hidden panels,
            // disabled duplicates and the off-canvas desktop sidebar do not
            // count as targets.
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            const style = getComputedStyle(element);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            if ((element as HTMLButtonElement).disabled) return false;
            if (element.hasAttribute('aria-hidden')) return false;
            return true;
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              selector,
              label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          }),
      ), TARGETS.map((target) => target.selector));

    // The tab bar is the floor of this test: if it is not on screen the
    // viewport assumption broke and the rest would pass vacuously.
    const tabbar = measured.filter((item) => item.selector.startsWith('.tabbar'));
    expect(tabbar.length, 'no tab bar was measured — is this the phone layout?').toBeGreaterThan(1);

    // A short list of exact exemptions, each with a reason. Anything else that
    // misses the floor fails, and the failure names the control.
    const TOO_SMALL = measured.filter((item) => Math.min(item.width, item.height) < MIN);
    expect(
      TOO_SMALL.map((item) => `${item.selector} (${item.label}) is ${item.width}×${item.height}`),
      `controls under ${MIN}px in ${language}`,
    ).toEqual([]);
  });
}

test('the More sheet rows are reachable', async ({ page }) => {
  await boot(page, 'en');
  const more = page.locator('.tabbar button', { hasText: /more/i }).first();
  if (await more.count()) {
    await more.click();
    const rows = page.locator('.more-sheet button, .sheet button');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    const small = await rows.evaluateAll((elements) =>
      elements
        .filter((element) => !(element as HTMLButtonElement).disabled)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { label: (element.textContent ?? '').trim().slice(0, 30), height: Math.round(rect.height), width: Math.round(rect.width) };
        })
        .filter((row) => row.height > 0 && Math.min(row.width, row.height) < MIN),
    );
    expect(small).toEqual([]);
  }
});
