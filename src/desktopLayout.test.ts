import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const polish = readFileSync(new URL('./app-polish.css', import.meta.url), 'utf8');

test('fixed desktop sidebar leaves the planner workspace in the second grid column', () => {
  expect(styles).toMatch(/@media \(min-width: 1024px\) \{[\s\S]*?grid-template-columns: var\(--sidebar\) minmax\(0, 1fr\)/);
  expect(styles).toMatch(/\.app-shell:not\(\.app-shell--standalone\) \.workspace\s*\{\s*grid-column:\s*2\s*;/);
  expect(styles).toMatch(/\.sidebar\s*\{[\s\S]*?position:\s*fixed\s*;/);
  // The fixed sidebar must pin to the inline-start side, matching the grid's
  // reserved first track in both LTR and RTL (Persian sets dir="rtl").
  expect(styles).toMatch(/\.sidebar\s*\{[\s\S]*?inset-inline-start:\s*0\s*;/);
});

test('standalone panel shells keep their workspace in the single grid column', () => {
  // No blanket `.workspace { grid-column: 2; }` may exist: on the sidebar-less
  // panel pages (one-column grid) it would push all content into an implicit
  // auto-sized track on the side of the screen.
  expect(styles).not.toMatch(/^\s*\.workspace\s*\{\s*grid-column:\s*2\s*;/m);
  expect(polish).toMatch(/\.app-shell--standalone \.workspace\s*\{\s*grid-column:\s*1\s*;/);
});
