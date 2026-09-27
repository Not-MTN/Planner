import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingKeys, t } from './i18n';
import { fa } from './locales/fa';

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
  it('has a Persian translation for every UI string', () => {
    expect(missingKeys([...sourceKeys('src')], 'fa')).toEqual([]);
  });
  it('keeps placeholders intact in Persian', () => {
    for (const [key, value] of Object.entries(fa)) {
      const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(names(value), key).toBe(names(key));
    }
  });
  it('interpolates and falls back to English', () => {
    expect(t('Task “{0}” added.', { 0: 'Run' })).toBe('Task “Run” added.');
    expect(t('Not a key')).toBe('Not a key');
  });
});
