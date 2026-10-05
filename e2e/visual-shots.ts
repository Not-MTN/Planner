/**
 * Which screenshots the visual suite takes.
 *
 * The names live here, apart from the spec, for one reason: CI has to know
 * whether a baseline is missing *before* Playwright runs (a missing baseline is
 * a written file and a failed test, which is useful on a laptop and useless on
 * a runner). `scripts/check-visual-baselines.mjs` compares this list against the
 * committed baselines, and `src/visualManifest.test.ts` compares it against
 * `e2e/visual-snapshots.json` and against the calls in the spec.
 *
 * No Playwright import here on purpose: the spec needs it, and so does a Vitest
 * test, and only one of those two can load @playwright/test.
 */

export const MATRIX_VIEWS = [
  { name: 'today', path: '/#/today', ready: '.timeline-card' },
  { name: 'tasks', path: '/#/tasks', ready: '.view .page-head' },
  { name: 'insights', path: '/#/insights', ready: '.stat-row' },
] as const;

export const LANGUAGES = ['en', 'fa'] as const;
export const THEMES = ['light', 'dark'] as const;

/** `today-en-light.png` — one name per view × language × theme. */
export function matrixShot(view: string, language: string, theme: string): string {
  return `${view}-${language}-${theme}.png`;
}

/** Everything outside the matrix, in the order the spec takes them. */
export const EXTRA_SHOTS = [
  'phone-today-fa-dark.png',
  'landing-en-light.png',
  'landing-fa-dark.png',
  'student-panel-en-light.png',
  'guardian-roster-fa-dark.png',
  'settings-sync-en-light.png',
  'signin-en-light.png',
] as const;

/**
 * The name of one of `EXTRA_SHOTS`, checked at module load.
 *
 * The spec writes `shot('landing-en-light.png')` rather than a bare string so a
 * typo is a compile error: the parameter only accepts the names in the list.
 */
export function shot(name: (typeof EXTRA_SHOTS)[number]): string {
  return name;
}

/** Every screenshot name the suite produces. */
export function allShotNames(): string[] {
  const matrix = MATRIX_VIEWS.flatMap((view) =>
    LANGUAGES.flatMap((language) => THEMES.map((theme) => matrixShot(view.name, language, theme))),
  );
  return [...matrix, ...EXTRA_SHOTS];
}
