import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPLETE_LANGS, missingKeys, t, LANGUAGES } from './i18n';
import { fa } from './locales/fa';
import { fi } from './locales/fi';

function sourceKeys(dir: string, out = new Set<string>()): Set<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'locales' && name !== 'server') sourceKeys(path, out);
    } else if (/\.tsx?$/.test(name) && !name.includes('.test.')) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) out.add(JSON.parse(match[1][0] === "'" ? `"${match[1].slice(1, -1).replace(/"/g, '\\"')}"` : match[1]));
    }
  }
  return out;
}

describe('i18n', () => {
  const dictionaries = { fa, fi };
  it('has a translation for every UI string, in every language that claims to be finished', () => {
    for (const lang of COMPLETE_LANGS) {
      expect(missingKeys([...sourceKeys('src')], lang), lang).toEqual([]);
    }
  });
  it('keeps placeholders intact in every language', () => {
    for (const [name, dictionary] of Object.entries(dictionaries)) {
      for (const [key, value] of Object.entries(dictionary)) {
        const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
        expect(names(value), `${name}: ${key}`).toBe(names(key));
      }
    }
  });
  it('only offers languages it has a direction for', () => {
    for (const language of LANGUAGES) expect(['ltr', 'rtl']).toContain(language.dir);
  });
  it('interpolates and falls back to English', () => {
    expect(t('Task “{0}” added.', { 0: 'Run' })).toBe('Task “Run” added.');
    expect(t('Not a key')).toBe('Not a key');
  });
});

/**
 * A sentence must not be built from translated fragments around markup: the
 * fragments translate one by one, but nobody can reorder them, so Persian ends
 * up reading as spliced English. If a sentence needs a value inside it, that
 * value belongs in a placeholder on one whole-sentence key (components/Rich.tsx).
 *
 * Only the one unambiguous signature is checked: a string that *opens* with
 * punctuation or whitespace. Such a fragment can only ever be the tail of a
 * sentence spliced in JSX — ". Try protecting that hour.", ", you finish",
 * "(your Neon connection string) …". Ordinary lowercase labels ("min", "vs",
 * "Delete saved view") are legitimate on their own and stay allowed.
 */
describe('translated sentences stay whole', () => {
  it('has no t() fragment that opens mid-sentence', () => {
    // Punctuation and whitespace at the *start* mean "this is the tail of a
    // sentence". Curly quotes are excluded — “{0}” legitimately opens one.
    const FRAGMENT = /^[\s.,;:!?·)\]}—–-]/;
    // Markdown report lines ("- [x] {0}") and file names (".env.local") are
    // syntax, not prose. A real sentence never starts with "- " or ".x".
    const NOT_PROSE = /^- |^\.\w/;
    const offenders = [...sourceKeys('src')].filter((key) => FRAGMENT.test(key) && !NOT_PROSE.test(key));
    expect(offenders).toEqual([]);
  });
});
