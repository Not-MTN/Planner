import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('fixed desktop sidebar leaves the planner workspace in the second grid column', () => {
  expect(styles).toMatch(/@media \(min-width: 1024px\) \{[\s\S]*?grid-template-columns: var\(--sidebar\) minmax\(0, 1fr\)/);
  expect(styles).toMatch(/\.workspace\s*\{\s*grid-column:\s*2\s*;/);
  expect(styles).toMatch(/\.sidebar\s*\{[\s\S]*?position:\s*fixed\s*;/);
});
