import { expect, test, type Page } from '@playwright/test';
import { bootOffline, expectPlannerReady } from './support';

/**
 * Installing the app, and opening it with no network.
 *
 * Two promises the app makes outside a browser tab, and neither is visible in a
 * screenshot: an installed Planner has a name, an icon and a standalone window,
 * and it opens on a train with no signal. Both are easy to break from a hundred
 * miles away — an icon renamed in `public/`, a bad `start_url`, a service worker
 * whose cache strategy stops covering the assets a cold start needs — and both
 * fail silently until a user complains.
 *
 * The checks are about the *contract*, not about Chromium's install UI (which
 * cannot be driven headlessly): the manifest says what it must say, every icon
 * it points at exists at the size it claims, the page links it, and the worker
 * really does serve the app after the network is gone.
 */

interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

interface Manifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  lang?: string;
  dir?: string;
  icons?: ManifestIcon[];
}

const PNG = /^image\/png/;

/** Width and height out of a PNG's IHDR chunk — no image library needed. */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Load the page and wait until a service worker controls it. */
async function primeServiceWorker(page: Page): Promise<void> {
  await page.goto('/#/today');
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 20_000 });
  // The first load is not served by the worker (it installs during it), so one
  // reload is what puts the caches in the position a returning visitor finds.
  await page.reload();
  await expectPlannerReady(page);
}

test.beforeEach(async ({ page }) => {
  await bootOffline(page);
});

test('the manifest promises an installable app', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as Manifest;

  expect(manifest.name).toBeTruthy();
  expect(manifest.short_name).toBeTruthy();
  // Chrome truncates a longer short_name on the home screen rather than
  // wrapping it, so the limit is a real constraint, not a style preference.
  expect(manifest.short_name!.length).toBeLessThanOrEqual(12);
  expect(manifest.start_url).toBeTruthy();
  expect(manifest.start_url!.startsWith('/')).toBe(true);
  expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  // The install UI renders `name`/`short_name`, which are English, so the
  // direction is stated rather than left to the browser's locale — an installed
  // app on a Persian phone would otherwise be mirrored to match the phone.
  expect(['ltr', 'rtl', 'auto']).toContain(manifest.dir);
  expect(manifest.lang ?? '').toMatch(/^[a-z]{2}/);

  // Android's install prompt wants a 192 and a 512; a maskable 512 is what
  // keeps the icon from being cropped into a circle with its edges cut off.
  const icons = manifest.icons ?? [];
  expect(icons.some((icon) => icon.sizes === '192x192' && (icon.purpose ?? 'any').includes('any'))).toBe(true);
  expect(icons.some((icon) => icon.sizes === '512x512' && (icon.purpose ?? 'any').includes('any'))).toBe(true);
  expect(icons.some((icon) => icon.purpose?.includes('maskable') && icon.sizes === '512x512')).toBe(true);
});

test('every icon the manifest promises exists at the size it claims', async ({ request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as Manifest;
  for (const icon of manifest.icons ?? []) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    if (icon.type === 'image/svg+xml') {
      expect(response.headers()['content-type'], icon.src).toContain('svg');
      continue;
    }
    expect(response.headers()['content-type'], icon.src).toMatch(PNG);
    const declared = /^(\d+)x(\d+)$/.exec(icon.sizes ?? '');
    if (!declared) continue;
    const size = pngSize(await response.body());
    expect(size, `${icon.src} is not a PNG`).not.toBeNull();
    // A manifest that lies about its icon sizes installs a stretched or
    // letterboxed icon, and the store listing uses the same files.
    expect({ width: size!.width, height: size!.height }, icon.src).toEqual({ width: Number(declared[1]), height: Number(declared[2]) });
  }

  // iOS ignores the manifest's icons and uses these two.
  const apple = await request.get('/apple-touch-icon.png');
  expect(apple.status()).toBe(200);
  expect(pngSize(await apple.body())).toEqual({ width: 180, height: 180 });
});

test('the page links the manifest and the tags an installed app needs', async ({ page }) => {
  await page.goto('/#/today');
  const links = await page.evaluate(() => ({
    manifest: document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute('href') ?? null,
    apple: document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
    capable: document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-capable"]')?.content ?? null,
    title: document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.content ?? null,
    viewport: document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? '',
    themeColors: [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content),
  }));
  expect(links.manifest).toBe('/manifest.webmanifest');
  expect(links.apple).toBe('/apple-touch-icon.png');
  expect(links.capable).toBe('yes');
  expect(links.title).toBeTruthy();
  // Without `viewport-fit=cover` the installed app has white bands on a phone
  // with rounded corners; the CSS already handles the safe areas.
  expect(links.viewport).toContain('viewport-fit=cover');
  expect(links.themeColors).toHaveLength(2);
});

test('the app registers its service worker and hands the page over to it', async ({ page }) => {
  await page.goto('/#/today');
  await page.waitForFunction(async () => (await navigator.serviceWorker?.ready) !== undefined, undefined, { timeout: 20_000 });
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      origin: location.origin,
      scope: registration.scope,
      active: registration.active?.scriptURL ?? null,
      controlling: navigator.serviceWorker.controller?.scriptURL ?? null,
    };
  });
  expect(state.active).toContain('/sw.js');
  expect(state.scope).toContain(state.origin);
  // `ready` resolves once there is an active worker; the page is controlled
  // after `clients.claim()` (there is no `clientId` dance here on purpose — the
  // app has no per-client work to do at activation), so wait for it rather than
  // asserting on the moment `ready` returned.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });
  expect((await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)) ?? '').toContain('/sw.js');
});

test('with the network down the app still opens, and an edit still sticks', async ({ page, context }) => {
  await primeServiceWorker(page);

  await context.setOffline(true);
  try {
    await page.reload();
    // The shell came out of the cache: this is the difference between "an
    // installed app" and "a bookmark that shows a dinosaur".
    await expectPlannerReady(page);

    // The store is local, so work continues with no network at all.
    const input = page.locator('.quick-add input');
    await input.fill('Buy milk on the way home');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    const saved = await page.evaluate(() =>
      (JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}').tasks as Array<{ title: string }> | undefined)?.some(
        (task) => task.title === 'Buy milk on the way home',
      ),
    );
    expect(saved).toBe(true);

    // Routing is local too: moving between screens is a hash change, and the
    // task is really in the board rather than only on the screen it was typed on.
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Select Buy milk on the way home' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('coming back online updates the worker rather than serving a stale shell', async ({ page, context }) => {
  await primeServiceWorker(page);
  await context.setOffline(true);
  await page.reload();
  await expectPlannerReady(page);
  await context.setOffline(false);

  // The shell is network-first: one navigation with the network back must not
  // still be answering from the cache it fell back to.
  const response = await page.reload();
  expect(response?.status()).toBe(200);
  await expectPlannerReady(page);
});
