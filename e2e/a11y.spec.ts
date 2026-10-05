/**
 * Accessibility, checked by a machine.
 *
 * The app has been written with accessibility in mind from the start — the
 * charts have text alternatives, the icon buttons are labelled, the modals trap
 * focus — but nothing *checked* any of it, so the first real regression would
 * have been found by a person who needed the feature.
 *
 * axe-core is the right tool for the half that is a machine's job: contrast,
 * labels, roles, heading order, landmark structure, form names. It is not a
 * substitute for a keyboard or a screen reader; it is the floor, and the floor
 * is where regressions land.
 *
 * Three rules make this useful rather than noisy:
 *
 *   1. **Serious and critical only.** axe also reports minor and moderate
 *      findings, some of which are stylistic and some of which are wrong in a
 *      headless browser. Serious and critical are the ones that make a screen
 *      unusable.
 *   2. **Known exceptions are named, with a reason.** An ignore list that only
 *      grows is a way of not testing, so each entry says why it exists.
 *   3. **Both languages and both themes**, because RTL and dark mode are where
 *      contrast and layout bugs actually appear.
 *
 * The scan runs against the production build (playwright.config.ts), which is
 * what people use.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { bootOffline, panelFixture } from './support';
import { createEmptyState } from '../src/types';

type Screen = { name: string; path: string; ready: string; state?: unknown };

/** The panel screens need enabled panels in the planner state to render at all. */
function panelState(): unknown {
  const state = createEmptyState();
  return { ...state, panels: { ...state.panels, ...panelFixture() } };
}

const SCREENS: Screen[] = [
  { name: 'today', path: '/#/today', ready: '.timeline-card' },
  { name: 'tasks', path: '/#/tasks', ready: '.view .page-head' },
  { name: 'insights', path: '/#/insights', ready: '.stat-row' },
  { name: 'the student panel', path: '/#/student', ready: '.student-panel-view', state: panelState() },
  { name: 'the guardian roster', path: '/#/guardian', ready: '.guardian-roster', state: panelState() },
  { name: 'the landing page', path: '/', ready: '.hero-title' },
];

/**
 * Rules switched off for a stated reason.
 *
 * Each one is a deliberate, arguable trade — not a bug being hidden. If axe
 * stops reporting an entry here, that is not a failure (the exception simply
 * became unnecessary); keeping the reason next to it is what stops the list
 * from growing silently.
 */
const EXCEPTIONS: Record<string, string> = {
  // Several labelled landmarks (sidebar, mobile bar, settings sheet) share a
  // role by design, which axe flags as ambiguous when they are nested rather
  // than siblings. The labels are what a screen reader reads out.
  'landmark-unique': 'labelled landmarks share a role by design',
};

/**
 * Wait for the screen to stop moving before measuring it.
 *
 * The app animates views and sheets in with an opacity transition, and axe reads
 * *computed* colours: a panel caught at 34% opacity reports the blended grey of
 * a half-loaded screen, not the colour anybody chose. Reduced motion shortens
 * those transitions to almost nothing; waiting for the last one to finish is
 * what makes the measurement repeatable.
 */
async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'), undefined, { timeout: 5_000 })
    .catch(() => undefined);
}

async function analyze(page: Page): Promise<string[]> {
  await settled(page);
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']);
  for (const rule of Object.keys(EXCEPTIONS)) builder.disableRules(rule);
  const results = await builder.analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.length} node(s) — ${violation.help}`);
}

/**
 * Seed the display preferences (and, for the panels, the state) before the app
 * reads them, then wait for the screen to be genuinely on screen: a route that
 * failed to render is trivially accessible, so the scan would pass for the
 * wrong reason.
 */
async function scan(page: Page, screen: Screen, options: { language: 'en' | 'fa'; theme: 'light' | 'dark' }): Promise<string[]> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootOffline(page);
  await page.goto(screen.path);
  await page.evaluate(
    ([language, theme, state]) => {
      localStorage.clear();
      localStorage.setItem('planner-tour-done', '1');
      localStorage.setItem('planner-lang', language);
      localStorage.setItem('planner-theme', theme);
      localStorage.setItem('planner-week-start', language === 'fa' ? '6' : '1');
      localStorage.setItem(
        'planner-display',
        JSON.stringify({ dateLanguage: language === 'fa' ? 'fa' : 'en-GB', timeFormat: '24h', jalali: false }),
      );
      if (state) localStorage.setItem('personal-planner.v1', JSON.stringify({ version: 1, exportedAt: '2026-03-12T09:20:00.000Z', ...(state as object) }));
    },
    [options.language, options.theme, screen.state ?? null] as const,
  );
  await page.reload();
  await expect(page.locator(screen.ready)).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return analyze(page);
}

for (const language of ['en', 'fa'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`no serious accessibility violations — ${language}, ${theme}`, () => {
      test.use({ viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'UTC' });

      for (const screen of SCREENS) {
        test(`${screen.name}`, async ({ page }) => {
          expect(await scan(page, screen, { language, theme }), `${screen.name} (${language}, ${theme})`).toEqual([]);
        });
      }
    });
  }
}

test.describe('the gate and the settings sheet', () => {
  test.use({ viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'UTC' });

  /**
   * The screen a signed-out browser visitor actually lands on.
   *
   * The in-app gate (`AccountGate`) answers a 401 by sending the tab to
   * `/login`, and it shows its own startup screen for a few hundred
   * milliseconds before that — scanning that flash would be a race, and a race
   * is a test that fails on a slow runner for no reason. `/login` is the
   * stable screen a person reads, so that is the one measured here.
   */
  test('sign-in screen', async ({ page }) => {
    // Reduced motion collapses the reveal animations. Measuring contrast while
    // a panel is still fading in reads the *blended* colour and reports a
    // failure nobody would ever see — the scan, not the animation, is the
    // thing under test.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await bootOffline(page);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 15_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(await analyze(page)).toEqual([]);
  });

  test('settings sheet, opened over the planner', async ({ page }) => {
    // Same reason as the sign-in screen above: the sheet fades in, and an
    // opacity mid-flight is not a colour anyone chose.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await bootOffline(page);
    // The tour is dimmed over the app for a first-time visitor, and its overlay
    // swallows the click below. This test is about the settings sheet, not the
    // tour (`e2e/tour.spec.ts` covers that).
    await page.addInitScript(() => localStorage.setItem('planner-tour-done', '1'));
    await page.goto('/#/today');
    await expect(page.locator('.quick-add input')).toBeVisible({ timeout: 15_000 });
    await page.locator('.side-tool[data-tour="settings"]').click();
    await expect(page.locator('#set-tab-app')).toBeVisible();
    expect(await analyze(page)).toEqual([]);
  });
});
