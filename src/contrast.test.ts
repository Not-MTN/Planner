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
/** `color-mix(in srgb, fg share, bg)`: a plain channel-wise blend. */
function mix(fg: string, bg: string, share: number): string {
  const channels = (hex: string) => hex.match(/[\da-f]{2}/gi)!.map((c) => parseInt(c, 16));
  const [f, b] = [channels(fg), channels(bg)];
  return '#' + f.map((v, i) => Math.round(v * share + b[i] * (1 - share)).toString(16).padStart(2, '0')).join('');
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
test('your own chat bubble — text and timestamp — meets AA on the solid accent in both themes', () => {
  // The bubble you write sits on var(--accent) with var(--accent-contrast)
  // words (held above), and its timestamp is that contrast colour toned
  // 10% toward the accent. 90% is the strongest step down that still
  // clears AA on the lightest accent; this holds the line if a token moves.
  const rules = css.matchAll(/\[data-accent="\w+"\] \{ ([^}]+)\}/g);
  let count = 0;
  for (const [, rule] of rules) {
    const token = (name: string) => rule.match(new RegExp(`--${name}: (#[\\da-f]+)`))![1];
    expect(contrast(mix(token('accent-contrast'), token('accent'), 0.9), token('accent'))).toBeGreaterThanOrEqual(4.5);
    // The pairing that must never reach the screen: contrast-coloured text
    // on the soft tint is ~1.1–1.3:1 — your own messages, invisible.
    expect(contrast(token('accent-contrast'), token('accent-soft'))).toBeLessThan(2);
    count++;
  }
  expect(count).toBe(10);
});
test('the chat bubble rules ship background and text colour as one winning pair', () => {
  // A cascade bug, not a palette bug: responsive-beauty.css once styled the
  // bubble with `.chat-bubble.is-mine`, which lost the background to
  // panels.css `.chat-row.is-mine .chat-bubble` (accent-soft) but kept the
  // near-white text colour — 1.1:1 in the light theme, 1.3:1 in the dark.
  // No token test can see a specificity loss, so this one reads the rules:
  // the mine-bubble rule must out-rank panels.css and set the pair together.
  const responsive = readFileSync(new URL('./responsive-beauty.css', import.meta.url), 'utf8');
  const mine = responsive.match(/\.chat-row\.is-mine \.chat-bubble\.is-mine \{([^}]+)\}/);
  expect(mine, 'mine-bubble rule with a winning selector').not.toBeNull();
  expect(mine![1]).toContain('background: var(--accent)');
  expect(mine![1]).toContain('color: var(--accent-contrast)');
  const meta = responsive.match(/\.chat-row\.is-mine \.chat-bubble \.chat-meta \{([^}]+)\}/);
  expect(meta, 'mine timestamp rule').not.toBeNull();
  expect(meta![1]).toContain('var(--accent-contrast) 90%');
  // And a waiting bubble may not fade its words away in either stylesheet.
  const panels = readFileSync(new URL('./panels.css', import.meta.url), 'utf8');
  for (const sheet of [responsive, panels]) {
    for (const [, rule] of sheet.matchAll(/\.chat-bubble\.is-waiting \{([^}]+)\}/g)) {
      expect(rule).not.toContain('opacity');
    }
  }
});
