/**
 * Touch targets, measured instead of eyeballed.
 *
 * The 44px floor was a review-time judgement and nothing watched it: a padding
 * tweak on the tab bar or an icon button could shrink a control to 30px and no
 * test would notice until somebody tried the app on a phone.
 *
 * The app has grown touch sizing in `@media (pointer: coarse)` for a while —
 * but the first version of this file measured under a *mouse* pointer, so it
 * saw the cursor sizes: the bar's round icons at 36×36, the dictate mic at
 * 34×34, buttons at 30–40px. Measuring in the Pixel 7 project is what makes the
 * assertion true of a thumb, and the gaps it still found — the mic, the 40px
 * pills — are closed in the same block.
 *
 * Two tiers, because "every button is 44px" is not true of a desktop UI and
 * never will be:
 *
 *   - THUMB (44px): the controls a thumb reaches for on a phone — the mobile
 *     bar, the quick-add row, the tab bar, the FAB, and the ordinary/small
 *     buttons in the content.
 *   - FLOOR (24px): the deliberately dense ones — `.btn-tiny` and the row
 *     icons inside a task, habit or list row. WCAG 2.5.8 (Target Size,
 *     Minimum) asks for 24×24 and the rows around them are far apart, so they
 *     are asserted at the floor rather than exempted: an 18px control still
 *     fails.
 *
 * Everything is measured in the `mobile` project (Pixel 7: coarse pointer,
 * touch), which is the only configuration where the CSS floor applies. The
 * specs skip under a mouse project instead of passing vacuously; CI runs them
 * there explicitly. English and Persian both, because RTL is where a target
 * quietly loses its width.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootOffline } from './support';

/** The floor for anything dense but still reachable (WCAG 2.5.8). */
const FLOOR = 24;
/** The floor for what a thumb has to hit (WCAG 2.5.5 / the app's own rule). */
const THUMB = 44;

type Target = { selector: string; what: string; min: number };

/** The phone controls this file grades, by selector. */
const TARGETS: Target[] = [
  { selector: '.tabbar button, .tabbar a', what: 'tab bar item', min: THUMB },
  { selector: '.mobile-bar button', what: 'mobile bar button', min: THUMB },
  { selector: '.quick-add button', what: 'quick-add action', min: THUMB },
  { selector: '.fab', what: 'floating add button', min: THUMB },
  { selector: '.btn:not(.btn-tiny)', what: 'primary button', min: THUMB },
  // Dense, but still tap targets: the inline buttons inside list rows and the
  // small round icons beside a task or habit. Measured at the WCAG minimum
  // rather than exempted — this is the assertion that catches an 18px one.
  { selector: '.btn-tiny', what: 'dense inline button', min: FLOOR },
  { selector: '.icon-btn', what: 'row icon button', min: FLOOR },
];

type Box = { selector: string; what: string; label: string; width: number; height: number; min: number };

async function boot(page: Page, language: 'en' | 'fa'): Promise<void> {
  // The CSS floor is scoped to a coarse pointer; under a mouse project the
  // measurement below would be meaningless rather than failing.
  test.skip(!test.info().project.use.isMobile, 'touch targets are measured with touch emulation');
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
  expect(
    await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
    'the phone emulation did not report a coarse pointer, so the CSS floor cannot apply',
  ).toBe(true);
}

for (const language of ['en', 'fa'] as const) {
  test(`phone controls are big enough to hit (${language})`, async ({ page }) => {
    await boot(page, language);

    // The strictest applicable minimum per element, measured once. Passing the
    // targets in as an argument keeps this callback self-contained: the first
    // version referenced the outer `MIN` constant and died in the browser.
    const measured = await page.evaluate((targets: Target[]): Box[] => {
      const seen = new Map<HTMLElement, Box>();
      for (const target of targets) {
        for (const element of document.querySelectorAll<HTMLElement>(target.selector)) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue; // not on screen
          const style = getComputedStyle(element);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          if ((element as HTMLButtonElement).disabled) continue;
          if (element.hasAttribute('aria-hidden') || element.closest('[aria-hidden="true"]')) continue;
          const label = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40);
          const box: Box = {
            selector: target.selector,
            what: target.what,
            label,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            min: target.min,
          };
          const previous = seen.get(element);
          // An element can match several selectors (a `.btn` is also a
          // `.quick-add button`); the strictest minimum wins.
          if (!previous || box.min > previous.min) seen.set(element, box);
        }
      }
      return [...seen.values()];
    }, TARGETS);

    // The tab bar is the floor of this test: if it is not on screen the
    // viewport assumption broke and the rest could pass vacuously.
    const tabbar = measured.filter((item) => item.selector.startsWith('.tabbar'));
    expect(tabbar.length, 'no tab bar was measured — is this the phone layout?').toBeGreaterThan(1);

    const tooSmall = measured.filter((item) => Math.min(item.width, item.height) < item.min);
    expect(
      tooSmall.map((item) => `${item.what} (${item.label}) is ${item.width}×${item.height}, under ${item.min}`),
      `controls under their ${THUMB}px/${FLOOR}px floors in ${language}`,
    ).toEqual([]);
  });
}

test('the More sheet rows are reachable', async ({ page }) => {
  await boot(page, 'en');
  const more = page.locator('.tabbar button', { hasText: /more/i }).first();
  await expect(more).toBeVisible();
  await more.click();
  const rows = page.locator('.more-list button, .more-list a');
  const count = await rows.count();
  expect(count, 'the More sheet had no rows to measure').toBeGreaterThan(0);
  const small = await rows.evaluateAll(
    (elements, floor: number) =>
      elements
        .filter((element) => !(element as HTMLButtonElement).disabled)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: (element.textContent ?? '').trim().slice(0, 30),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })
        .filter((row) => row.height > 0 && Math.min(row.width, row.height) < floor),
    THUMB,
  );
  expect(small).toEqual([]);
});
