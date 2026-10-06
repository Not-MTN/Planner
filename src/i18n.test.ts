import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMPLETE_LANGS, dictionaryLoaded, digitsIn, faDigits, faNum, getLang, loadDictionary, missingKeys, setLang, t, LANGUAGES } from './i18n';
import { AI_OFFLINE_MESSAGE, GROQ_BILLING_MESSAGE } from './ai';
import { fa } from './locales/fa';
import { fi } from './locales/fi';

/** Every .ts/.tsx file under `dir`, as paths. */
function sourceFiles(dir: string, out = new Set<string>()): Set<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name)) out.add(path);
  }
  return out;
}

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
  // The app fetches a dictionary before its first paint (src/main.tsx); the
  // tests that read one through `missingKeys` do the same, once.
  beforeAll(async () => {
    await Promise.all(COMPLETE_LANGS.map((lang) => loadDictionary(lang)));
  });
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
  it('renders Persian counters and time digits with Eastern Arabic numerals', () => {
    const previous = getLang();
    setLang('fa');
    expect(faNum(1207)).toBe('۱۲۰۷');
    expect(faDigits('07:15')).toBe('۰۷:۱۵');
    setLang(previous);
  });
  it('converts for a caller that carries its own language', () => {
    // The marketing pages keep their own lang, so they pass it in rather than
    // relying on whatever the planner last set.
    expect(digitsIn(1207, 'fa')).toBe('۱۲۰۷');
    expect(digitsIn('25 KB', 'fa')).toBe('۲۵ KB');
    expect(digitsIn(1207, 'en')).toBe('1207');
    expect(digitsIn('۰', 'en')).toBe('۰');
  });
  it('never rewrites a number in place — display only', () => {
    const previous = getLang();
    setLang('fa');
    // Inputs and stored values keep ASCII digits; only what is printed changes.
    expect(faNum(7)).not.toBe(7);
    expect(typeof faNum(7)).toBe('string');
    setLang('en');
    expect(faNum(7)).toBe(7);
    setLang(previous);
  });
  it('interpolates and falls back to English', () => {
    expect(t('Task “{0}” added.', { 0: 'Run' })).toBe('Task “Run” added.');
    expect(t('Not a key')).toBe('Not a key');
  });
  it('fetches a dictionary instead of carrying it in the entry bundle', () => {
    // The two dictionaries are the biggest strings in the build, and a reader
    // uses one of them or none. A static import here puts both back into the
    // entry chunk, where every visitor downloads them before the first screen —
    // which is what `scripts/bundle-budget.mjs` measures and fails on.
    const source = readFileSync('src/i18n.ts', 'utf8');
    expect(source).not.toMatch(/^import \{ (?:fa|fi) \} from/m);
    expect(source).toMatch(/import\('\.\/locales\/fa'\)/);
    expect(source).toMatch(/import\('\.\/locales\/fi'\)/);
    // And nothing else may pull them back in: a static import anywhere in the
    // app would be just as fatal to the budget as one here. Tests are exempt —
    // they compare dictionaries, and they never ship.
    const offenders = [...sourceFiles('src')]
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .flatMap((path) => {
        const found = /^import\s[^;]*from\s['"][^'"]*locales\/(?:fa|fi)['"]/m.test(readFileSync(path, 'utf8'));
        return found ? [path] : [];
      });
    expect(offenders).toEqual([]);
  });
  it('loads a language once, and says whether it is here', async () => {
    // `beforeAll` above loaded both, so this is the repeat call: the same
    // promise, no second fetch.
    expect(dictionaryLoaded('fa')).toBe(true);
    expect(dictionaryLoaded('en')).toBe(true);
    // One request per language: the second call is the first call's promise.
    expect(loadDictionary('fa')).toBe(loadDictionary('fa'));
    // English is the fallback, not a fetch.
    await expect(loadDictionary('en')).resolves.toBeUndefined();
    await loadDictionary('fi');
    const previous = getLang();
    setLang('fi');
    expect(t('Add task')).toBe('Lisää tehtävä');
    setLang('fa');
    expect(t('Add task')).toBe('افزودن کار');
    setLang(previous);
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

/**
 * The completeness check above only sees *literal* t("...") calls. A handful of
 * strings reach t() as a variable instead — the day's motivation line, the
 * shortcut list, the matrix captions, two AI messages — and nothing looked at
 * them, so Persian shipped an English sentence at the top of Today until a
 * screenshot caught it (e2e/visual.spec.ts). Each row below is one such source:
 * the file, the array or constant holding the strings, and a name for the
 * failure. A new dynamic source means a new row.
 */
describe('keys built at runtime are translated too', () => {
  function stringsInArray(file: string, name: string): string[] {
    const text = readFileSync(file, 'utf8');
    const start = text.indexOf(`const ${name} = [`);
    expect(start, `${name} not found in ${file}`).toBeGreaterThan(-1);
    const end = text.indexOf('\n];', start);
    const body = text.slice(start, end < 0 ? undefined : end);
    // Only prose: array elements also carry key names ("q1"), CSS values
    // ("var(--danger)") and single key caps ("K", "Esc"), which are not strings
    // any translator would see.
    return [...body.matchAll(/'([^'\n]+)'/g)]
      .map((match) => match[1])
      .filter((value) => /[A-Za-z]/.test(value) && !/^var\(/.test(value) && !/^[A-Za-z]{1,3}$/.test(value) && !/^q\d$/.test(value));
  }

  const sources: Array<[string, string]> = [
    ['src/constants.ts', 'MOTIVATION'],
    ['src/components/ShortcutsSheet.tsx', 'SHORTCUTS'],
    ['src/views/MatrixView.tsx', 'QUADRANTS'],
  ];

  it('translates every string in them', () => {
    const keys = sources.flatMap(([file, name]) => stringsInArray(file, name));
    expect(keys.length).toBeGreaterThan(25);
    expect(missingKeys(keys, 'fa')).toEqual([]);
  });

  it('translates the messages that are passed to t() as a constant', () => {
    expect(missingKeys([AI_OFFLINE_MESSAGE, GROQ_BILLING_MESSAGE], 'fa')).toEqual([]);
  });
});
