/**
 * Visual regression, in the two directions this app actually breaks.
 *
 * Everything else in e2e/ checks behaviour: a button works, a task moves, the
 * layout stays inside the viewport. None of that notices a screen that is
 * correct but *wrong to look at* — the mirrored padding that never got its RTL
 * override, a dark theme where a card kept its light background, Persian digits
 * that turned back into Latin ones. Those are exactly the changes a refactor
 * makes by accident, and this file is the net under them.
 *
 * Three rules keep the pictures comparable between runs:
 *
 *   1. The clock is frozen (2026-03-12, 09:20 UTC) and the state is seeded, so
 *      "Today" is the same day with the same tasks on every run and on every
 *      machine. A screenshot test that depends on the real date is a test that
 *      fails tomorrow.
 *   2. Animations are disabled and the fonts are awaited before the shutter, so
 *      a half-faded card or a fallback font never becomes the baseline.
 *   3. Baselines are generated where they are compared: CI. Font rendering
 *      differs between machines, so `npm run test:e2e:visual:update` in the
 *      Visual regression workflow is how a new baseline is made, and the
 *      artifact it uploads is what gets committed. See docs/VISUAL_TESTS.md.
 */
import { expect, test, type Page } from '@playwright/test';
import { createEmptyState, type PlannerState } from '../src/types';
import { addEvent, addGoal, addHabit, addNote, addTask, toggleTask } from '../src/mutate';

/** Thursday. The app is frozen here for the whole file. */
const TODAY = '2026-03-12';
const NOW = '2026-03-12T09:20:00.000Z';
const TOMORROW = '2026-03-13';

/**
 * A small, deliberately ordinary planner: enough of every kind of card to have
 * something on screen, and fixed ids and dates so two runs produce two identical
 * pictures.
 */
function seededState(): PlannerState {
  let state = createEmptyState();

  state = addTask(state, { title: 'Finish the physics problem set', priority: 'high', dueDate: TODAY, dueTime: '17:00', category: 'Study', note: '', goalId: null, estimatedMinutes: 45 }, 'task-physics', NOW);
  state = addTask(state, { title: 'Water the plants', priority: 'low', dueDate: TODAY, dueTime: null, category: 'Home', note: '', goalId: null }, 'task-plants', NOW);
  state = addTask(state, { title: 'Read chapter four', priority: 'medium', dueDate: TOMORROW, dueTime: null, category: 'Study', note: 'Notes in the margin are fine.', goalId: null, repeat: 'weekly' }, 'task-read', NOW);
  state = toggleTask(state, 'task-plants', NOW, TODAY, 'task-plants-next');

  state = addEvent(state, { title: 'Chemistry lab', date: TODAY, startTime: '10:00', endTime: '11:30', category: 'Study', note: '', important: true }, 'event-lab', NOW);
  state = addEvent(state, { title: 'Football practice', date: TODAY, startTime: '16:00', endTime: '17:30', category: 'Sport', note: '', important: false }, 'event-football', NOW);

  state = addHabit(state, { name: 'Read for twenty minutes', icon: 'book', accent: 'sage', frequency: { type: 'daily' }, unit: { label: 'pages', target: 10 } }, 'habit-read', NOW, TODAY);
  state = addHabit(state, { name: 'Walk outside', icon: 'walk', accent: 'blue', frequency: { type: 'weekdays' } }, 'habit-walk', NOW, TODAY);

  state = addGoal(state, { title: 'Pass the spring exams', description: 'Steady revision beats a panicked week.', horizon: 'short', deadline: '2026-06-01', milestone: 'Physics: finish the problem sets', milestoneDue: '2026-04-01' }, 'goal-exams', 'milestone-physics', NOW);
  state = addNote(state, { title: 'Things that helped', body: 'Short sessions after school. The phone in another room.', kind: 'journal', date: TODAY, pinned: true }, 'note-help', NOW);

  return state;
}

/**
 * Everything the app reads before its first paint, written in one go.
 *
 * The display preferences matter as much as the language: picking Persian in
 * Settings also switches the *date* language to Persian and the week to
 * Saturday, so a session seeded with `planner-lang=fa` alone would have shown a
 * Persian interface with English day names — a baseline of a state no user can
 * reach. The seeds below are the ones the language switcher itself writes
 * (`SettingsSheet.tsx`, `src/dates.ts`).
 */
async function seed(page: Page, language: 'en' | 'fa', theme: 'light' | 'dark'): Promise<void> {
  const state = seededState();
  const display = { dateLanguage: language === 'fa' ? 'fa' : 'en-GB', timeFormat: '24h', jalali: false };
  await page.addInitScript(
    ([key, value, lang, mode, prefs, weekStart]) => {
      localStorage.clear();
      localStorage.setItem('planner-tour-done', '1');
      localStorage.setItem('planner-lang', lang as string);
      localStorage.setItem('planner-theme', mode as string);
      localStorage.setItem('planner-display', prefs as string);
      localStorage.setItem('planner-week-start', weekStart as string);
      localStorage.setItem(key as string, value as string);
    },
    ['personal-planner.v1', JSON.stringify({ version: 1, exportedAt: NOW, ...state }), language, theme, JSON.stringify(display), language === 'fa' ? '6' : '1'] as const,
  );
}

/**
 * A page whose clock never moves, whose animations are off, and whose fonts are
 * loaded. Called before the first navigation so the app boots into the fixed
 * day rather than the real one.
 *
 * The session probe is aborted on purpose: the planner is behind the account
 * gate, and this run has no account server to sign in to. A failed probe is a
 * state the app handles — it renders the local planner offline instead of a
 * sign-in screen — so the seeded state reaches the screen without faking any
 * UI. The gate's own behaviour is covered by src/auth/gate.test.tsx.
 */
async function open(page: Page, options: { language: 'en' | 'fa'; theme: 'light' | 'dark'; path: string }): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date(NOW));
  await seed(page, options.language, options.theme);
  await page.route('**/api/auth/session', (route) => route.abort());
  await page.goto(options.path);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator('html')).toHaveAttribute('dir', options.language === 'fa' ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('data-theme', options.theme);
  // Two frames after the last layout change, so nothing is captured mid-paint.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * The shots themselves. `animations: 'disabled'` fast-forwards CSS transitions
 * and animations to their end state; the toast is masked because it is the one
 * element that appears and disappears on a timer.
 */
async function shoot(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('.toast')],
    maxDiffPixelRatio: 0.002,
  });
}

const VIEWS = [
  { name: 'today', path: '/#/today', ready: '.timeline-card' },
  { name: 'tasks', path: '/#/tasks', ready: '.view .page-head' },
  { name: 'insights', path: '/#/insights', ready: '.stat-row' },
] as const;

const THEMES = ['light', 'dark'] as const;
const LANGUAGES = ['en', 'fa'] as const;

test.describe('key views in every direction and theme', () => {
  // Baselines are captured at one fixed desktop viewport; the mobile layout is
  // covered below with a single RTL, dark case rather than a second matrix.
  test.skip(({ browserName }) => browserName !== 'chromium', 'screenshots are captured in Chromium only');

  test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' });

  for (const view of VIEWS) {
    for (const language of LANGUAGES) {
      for (const theme of THEMES) {
        test(`${view.name} — ${language}, ${theme}`, async ({ page }, testInfo) => {
          test.skip(testInfo.project.name !== 'desktop', 'the matrix runs once, at the desktop viewport');
          await open(page, { language, theme, path: view.path });
          await expect(page.locator(view.ready)).toBeVisible();
          await shoot(page, `${view.name}-${language}-${theme}.png`);
        });
      }
    }
  }
});

/**
 * The screenshot above would catch these too — but only until someone
 * regenerates the baselines without looking. This asserts the property itself,
 * because both failures it guards against have already happened once:
 *
 *   - the day heading printed Latin day and month names inside a Persian page,
 *     when the seed wrote `planner-lang` without the date-language preference;
 *   - the motivation line under it stayed English, because `MOTIVATION` reaches
 *     `t()` as a variable and the completeness test only saw literals.
 *
 * English *content* is fine — task titles, category names, a user's own words.
 * The app's own copy in a Persian interface is not allowed to be Latin.
 */
test.describe('Persian mode renders the app’s own words in Persian', () => {
  test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' });

  test('today — fa', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the matrix runs once, at the desktop viewport');
    await open(page, { language: 'fa', theme: 'light', path: '/#/today' });
    await expect(page.locator('.timeline-card')).toBeVisible();

    const heading = await page.locator('h1.hero-title').innerText();
    expect(heading, 'the day heading must be Persian').toMatch(/[\u0600-\u06FF]/);
    expect(heading, 'the day heading must not use Latin day or month names').not.toMatch(
      /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)\b/,
    );

    const quote = await page.locator('.quote').innerText();
    expect(quote, 'the motivation line must be translated').not.toMatch(/[A-Za-z]/);
  });
});

test.describe('the phone layout in Persian, dark', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'UTC' });

  test('today — fa, dark, phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the phone case sets its own viewport');
    await open(page, { language: 'fa', theme: 'dark', path: '/#/today' });
    await expect(page.locator('.timeline-card')).toBeVisible();
    await expect(page.locator('.tabbar')).toBeVisible();
    await shoot(page, 'phone-today-fa-dark.png');
  });
});

test.describe('the marketing page', () => {
  test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' });

  test('landing — en, light', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the matrix runs once, at the desktop viewport');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto('/');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page.locator('.hero-title')).toBeVisible();
    await shoot(page, 'landing-en-light.png');
  });

  test('landing — fa, dark', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the matrix runs once, at the desktop viewport');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('planner-lang', 'fa');
      localStorage.setItem('planner-theme', 'dark');
    });
    await page.goto('/');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page.locator('.hero-title')).toBeVisible();
    await shoot(page, 'landing-fa-dark.png');
  });
});
