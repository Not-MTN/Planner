/**
 * Keeps the printed shortcut sheet honest.
 *
 * The sheet drifted twice already: `M` and `R` were answered by `Shell.tsx` but
 * never listed, and `?` was described as "Open settings" while it opened the
 * sheet itself. Reading the two files against each other is the only way this
 * stays true — a human comparing them by eye is exactly what failed.
 *
 * The handler is parsed out of its source rather than imported: `Shell.tsx`
 * pulls in half the app, and the assertion is about the *keys* it answers, which
 * live in one regex-detectable shape (`event.key.toLowerCase() === 'x'`,
 * `event.key === '/'`, and the `?` branch).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function handlerSource(): string {
  const text = readFileSync('src/components/Shell.tsx', 'utf8');
  const start = text.indexOf('const onKey = (event: KeyboardEvent) => {');
  expect(start, 'the key handler moved — update this test with it').toBeGreaterThan(-1);
  const end = text.indexOf('window.addEventListener', start);
  return text.slice(start, end);
}

/** Every single-key shortcut the handler answers, in the sheet's spelling. */
function handledKeys(): Set<string> {
  const source = handlerSource();
  const keys = new Set<string>();
  for (const match of source.matchAll(/event\.key\.toLowerCase\(\) === '([a-z0-9])'/g)) {
    keys.add(match[1].toUpperCase());
  }
  for (const match of source.matchAll(/event\.key === '([^']+)'/g)) {
    keys.add(match[1].toUpperCase());
  }
  // The `?` branch: `event.key === '?' || (event.shiftKey && event.key === '/')`.
  if (/\?/.test(source)) keys.add('?');
  return keys;
}

function sheetEntries(): { keys: string[]; desc: string }[] {
  const text = readFileSync('src/components/ShortcutsSheet.tsx', 'utf8');
  const start = text.indexOf('const SHORTCUTS = [');
  const end = text.indexOf('];', start);
  const body = text.slice(start, end);
  return [...body.matchAll(/\{ keys: \[([^\]]+)\], desc: '([^']+)' \}/g)].map((match) => ({
    keys: [...match[1].matchAll(/'([^']+)'/g)].map((key) => key[1]),
    desc: match[2],
  }));
}

describe('the shortcut sheet matches what the app answers', () => {
  it('lists every single-key shortcut that is not a modifier chord', () => {
    const listed = new Set(sheetEntries().flatMap((entry) => entry.keys.map((key) => key.toUpperCase())));
    // The handler also answers modifier chords (⌘Z, ⌘⇧Z) and Esc, which are
    // listed separately; the comparison is about plain keys.
    const handled = [...handledKeys()].filter((key) => /^([A-Z]|\?|\/)$/.test(key));
    expect(handled.length).toBeGreaterThanOrEqual(5);
    expect([...handled].filter((key) => !listed.has(key))).toEqual([]);
  });

  it('does not list a shortcut the app does not answer', () => {
    const handled = handledKeys();
    const listed = sheetEntries().flatMap((entry) => entry.keys);
    const plain = listed.filter((key) => /^([A-Z]|\?|\/)$/.test(key.toUpperCase()));
    expect(plain.filter((key) => !handled.has(key.toUpperCase()))).toEqual([]);
  });

  it('describes `?` as the sheet, not as settings', () => {
    const question = sheetEntries().find((entry) => entry.keys.includes('?'));
    expect(question, 'the `?` row disappeared').toBeTruthy();
    expect(question!.desc).toMatch(/shortcut/i);
    expect(question!.desc).not.toMatch(/settings/i);
  });

  it('translates every shortcut description, since the sheet shows them', () => {
    const fa = readFileSync('src/locales/fa.ts', 'utf8');
    for (const entry of sheetEntries()) {
      expect(fa.includes(`"${entry.desc}":`), `no Persian for "${entry.desc}"`).toBe(true);
    }
  });
});
