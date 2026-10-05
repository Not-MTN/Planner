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
