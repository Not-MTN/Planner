// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import { RELEASES_API, RELEASES_PAGE, dismissVersion } from './shared/updates';

// The notice only belongs in a packaged app; the website has its own service
// worker prompt. Flipped per test rather than stubbed away, so both halves of
// that rule are covered.
const shell = vi.hoisted(() => ({ native: false }));
vi.mock('./shared/nativeShell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shared/nativeShell')>()),
  isNativeShell: () => shell.native,
}));

/**
 * The notice a packaged app shows when a newer release exists.
 *
 * It is checked here rather than in updates.ts alone because the plumbing is
 * where a feature like this fails quietly: the check can be correct and still
 * never reach the screen, and the whole point of the thing is that someone sees
 * it. The app has to keep working when the check fails, too.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let fetchSpy: ReturnType<typeof vi.spyOn>;

function releaseResponse(tag: string): Response {
  return new Response(JSON.stringify({ tag_name: tag }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Mount the app and let the update check's promise settle. */
async function mountApp(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}

function text(): string {
  return document.body.textContent ?? '';
}

/** Does the app ask GitHub for the newest release? */
function askedForLatest(): boolean {
  return fetchSpy.mock.calls.some((call: unknown[]) => String(call[0]).includes(RELEASES_API));
}

beforeEach(() => {
  shell.native = true;
  localStorage.clear();
  document.body.innerHTML = '';
  // jsdom has no matchMedia; the app's tour and narrow-screen checks need it.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollTo = () => undefined;
  // The first-run tour would otherwise cover the app in a dialog.
  localStorage.setItem('planner-tour-done', '1');
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  fetchSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('the update notice', () => {
  it('says so, with a download link, when a newer release exists', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => releaseResponse('v99.0.0'));
    await mountApp();

    expect(askedForLatest()).toBe(true);
    expect(text()).toContain('99.0.0');
    const link = Array.from(document.querySelectorAll('a')).find((a) => a.getAttribute('href') === RELEASES_PAGE);
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain('Download');
  });

  it('stays quiet when this build is already the newest', async () => {
    // The same version this build was made from, published as a release.
    const { currentVersion } = await import('./shared/updates');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => releaseResponse(`v${currentVersion()}`));
    await mountApp();
    expect(text()).not.toContain('is available to download');
  });

  it('does not ask again about a version the reader waved away', async () => {
    dismissVersion('99.0.0');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => releaseResponse('v99.0.0'));
    await mountApp();
    expect(text()).not.toContain('99.0.0');
  });

  it('does not appear on the website, which updates itself', async () => {
    shell.native = false;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => releaseResponse('v99.0.0'));
    await mountApp();
    // Not even asked: a browser tab has the service worker for this.
    expect(askedForLatest()).toBe(false);
    expect(text()).not.toContain('99.0.0');
  });

  it('is invisible, and harmless, when the request fails', async () => {
    // No network is the normal state for this app, not an error worth showing.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await mountApp();
    expect(text()).not.toContain('is available to download');
    // The planner itself still rendered.
    expect(text().length).toBeGreaterThan(0);
  });
});
