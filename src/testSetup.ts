/**
 * Housekeeping between test files.
 *
 * `isolate: false` (vite.config.ts) lets files share a worker and a module
 * registry, which is most of the suite's wall time — and it means state a file
 * leaves behind is state the next file inherits. Two kinds are cleared here:
 *
 *   - globals a test stubbed (fetch, timers, `window.matchMedia`), after every
 *     test, because the next test in the same file expects the real ones;
 *   - the module registry itself, after the *last* test in a file. That is the
 *     one that leaks across files: a `vi.mock` registered by one file stays
 *     registered for every later import of that module, so the next file gets
 *     the previous file's fake. Clearing it once the file is done gives the
 *     next file the fresh registry `isolate: true` used to hand every file —
 *     and does it between files rather than between tests, because resetting
 *     mid-file would split a file's own imports from the components they
 *     render (React context identity, most visibly).
 *
 * Server-side module state (the rate limiter, the report buffer) still lives
 * for the whole run; a file that cares resets it itself, and `loginEdge.test.ts`
 * is the one that does.
 */
import { afterAll, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => {
  // The module registry, and the two storages a file is most likely to have
  // written a preference into (the language, the theme, the app's own state).
  // Both matter for the same reason: the next file starts from what this one
  // left, and it did not agree to that.
  vi.resetModules();
  try {
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
  } catch {
    /* a jsdom-less file has neither */
  }
});
