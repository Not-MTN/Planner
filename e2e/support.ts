/**
 * Shared boot helpers for the browser suites.
 *
 * The one thing every spec needs and none of them owned: the planner sits
 * behind the account gate, and these runs have no account server. Aborting the
 * session probe puts the app into a state it already handles — it renders the
 * local planner offline instead of a sign-in screen — which is what a spec
 * about the planner (not about signing in) wants.
 *
 * It lives here, with the explanation, because six copies of a comment is how
 * the seventh spec forgets it. `e2e/visual.spec.ts` predates this file and does
 * the same thing inline; new specs should call this.
 */
import { expect, type Page } from '@playwright/test';
import { type Panels } from '../src/types';

/**
 * Make the app boot the local planner without an account server.
 *
 * Call before the first `goto()`. The plan's own state still comes from the
 * spec: this only removes the server from the picture.
 */
export async function bootOffline(page: Page): Promise<void> {
  await page.route('**/api/auth/session', (route) => route.abort());
}

/** Wait for the shell to be interactive, which is the signal every spec uses. */
export async function expectPlannerReady(page: Page): Promise<void> {
  await expect(page.locator('.quick-add input')).toBeVisible({ timeout: 15_000 });
}

/**
 * A small, fixed panel fixture: one student with two subjects and a headline,
 * one guardian with a linked student and a week of results.
 *
 * Shared because two suites want the same thing — the visual baselines of the
 * panel screens (`e2e/visual.spec.ts`) and the accessibility scan of them
 * (`e2e/a11y.spec.ts`) — and two copies of a fixture drift into two different
 * screens. Ids and dates are fixed so pictures and results are comparable
 * between runs.
 *
 * `e2e/panels.spec.ts` keeps its own, richer fixture: that file asserts on the
 * privacy boundary, and its `PRIVATE_…` markers exist to be looked for.
 */
export function panelFixture(): Pick<Panels, 'student' | 'guardian'> {
  return {
    student: {
      enabled: true,
      field: 'Natural sciences',
      grade: 'school-11',
      subjects: [
        { id: 'physics', name: 'Physics', accent: 'blue', examDate: '2026-03-20', targetMinutes: 120 },
        { id: 'maths', name: 'Mathematics', accent: 'sage', examDate: null, targetMinutes: 180 },
      ],
      explanations: [{ id: 'headline', weekOf: '2026-03-09', summary: 'A steady week', reason: '', createdAt: '2026-03-12T09:20:00.000Z' }],
    } as Panels['student'],
    guardian: {
      enabled: true,
      kind: 'advisor',
      field: 'Science',
      notices: [],
      links: [
        {
          id: 'alice',
          username: 'alice',
          displayName: 'Alice Bennett',
          status: 'linked',
          linkId: '11111111-1111-1111-1111-111111111111',
          wrappedShareKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
          code: null,
          history: [],
          plans: [],
          results: {
            weekOf: '2026-03-09',
            planned: 5,
            done: 3,
            focusMinutes: 90,
            subjects: [{ name: 'Physics', minutes: 90 }],
            headline: 'A steady week',
            updatedAt: '2026-03-12T09:20:00.000Z',
          },
        },
      ],
    } as Panels['guardian'],
  };
}
