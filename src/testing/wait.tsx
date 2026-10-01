/**
 * Waiting helpers for component tests.
 *
 * React flushes effects and state updates when `act()` exits, which means a
 * polling loop placed *inside* one `act()` can never observe an intermediate
 * render. The wait therefore has to tick act-by-act, and it has to fail loudly
 * when the condition never arrives — a silent timeout turns a broken test into
 * a slow passing one.
 */
import { act } from 'react';

/** Flush a few render ticks. Use when nothing specific can be waited on. */
export async function settle(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

/** Poll until `predicate` is true, flushing React between every tick. */
export async function waitFor(predicate: () => boolean, timeoutMs = 10_000, describe?: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${describe ?? 'a UI condition'}.`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

/** Wait for the planner to finish booting from storage and render. */
export function waitForBoot(read: () => string, timeoutMs = 15_000): Promise<void> {
  return waitFor(() => !read().includes('Loading your planner'), timeoutMs, 'the planner to finish loading');
}
