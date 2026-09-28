/** True under Vitest — network effects (sync loops, feed refreshes) stay off in unit tests. */
export function isTestEnv(): boolean {
  return import.meta.env.MODE === 'test';
}
