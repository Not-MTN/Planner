import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const css =
  readFileSync(new URL('./tokens.css', import.meta.url), 'utf8') +
  readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
function luminance(hex: string) {
  const rgb = hex.match(/[\da-f]{2}/gi)!.map((c) => {
    const n = parseInt(c, 16) / 255;
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  });
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}
test('all accent buttons and soft labels meet AA text contrast in both themes', () => {
  const rules = css.matchAll(/\[data-accent="\w+"\] \{ ([^}]+)\}/g);
  let count = 0;
  for (const [, rule] of rules) {
    const token = (name: string) => rule.match(new RegExp(`--${name}: (#[\\da-f]+)`))![1];
    expect(contrast(token('accent'), token('accent-contrast'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('accent-deep'), token('accent-soft'))).toBeGreaterThanOrEqual(4.5);
    count++;
  }
  expect(count).toBe(10);
});
test('secondary light text and category labels remain readable on paper surfaces', () => {
  const colors = ['#665e52', ...Array.from(css.matchAll(/--cat-\w+-text: (#[\da-f]+)/g), m => m[1])];
  for (const color of colors) {
    for (const surface of ['#f5f0e7', '#fffdf9', '#f6f1e7', '#efe8da']) {
      expect(contrast(color, surface)).toBeGreaterThanOrEqual(4.5);
    }
  }
});
test('dark-theme text tokens stay readable on dark surfaces', () => {
  // muted / ink-soft from the [data-theme="dark"] block vs the dark surfaces.
  const colors = ['#b0a594', '#c6bcaa'];
  for (const color of colors) {
    for (const surface of ['#1f1b15', '#262117', '#2d271d']) {
      expect(contrast(color, surface)).toBeGreaterThanOrEqual(4.5);
    }
  }
});
