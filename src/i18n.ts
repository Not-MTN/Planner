/**
 * Tiny translation layer. English text is the key: `t('Add task')`.
 * Missing translations fall back to English, so nothing ever renders blank.
 * Placeholders use braces: t('{count} tasks', { count: 3 }).
 */

export type Lang = 'en' | 'fa' | 'fi';
export const LANGUAGES: { id: Lang; label: string; dir: 'ltr' | 'rtl' }[] = [
  { id: 'en', label: 'English', dir: 'ltr' },
  { id: 'fi', label: 'Suomi', dir: 'ltr' },
  { id: 'fa', label: 'فارسی', dir: 'rtl' },
];

/**
 * Languages that are expected to cover every string in the app.
 *
 * A new language starts partial — translating two thousand strings before anyone
 * can try it is how languages never get added — and missing keys fall back to
 * English, so nothing renders blank. This is the list of the ones that have
 * finished that journey, and it is what the tests hold to.
 */
export const COMPLETE_LANGS: Lang[] = ['fa', 'fi'];

const LANG_KEY = 'planner-lang';

/**
 * Dictionaries arrive on demand, not with the app.
 *
 * They are the largest strings in the build — a couple of hundred kilobytes of
 * text between them — and a reader uses exactly one of them, or none. Importing
 * them here put all of that in the entry bundle, where every visitor downloaded
 * Persian and Finnish before the first screen and the entry went over its
 * budget. Each one is a separate chunk now, fetched once for the language that
 * is actually being read (`loadDictionary`).
 *
 * The cost of that trade is the moment between import and load: `t()` falls
 * back to the English key, which is why the app waits for the dictionary before
 * it renders (src/main.tsx) rather than painting and filling in later.
 */
const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<Record<string, string>>> = {
  fa: () => import('./locales/fa').then((module) => module.fa),
  fi: () => import('./locales/fi').then((module) => module.fi),
};

const DICTS: Record<Lang, Record<string, string>> = { en: {}, fa: {}, fi: {} };
const loading = new Map<Lang, Promise<void>>();

/** Is the dictionary for `target` here? English is the fallback, so it always is. */
export function dictionaryLoaded(target: Lang): boolean {
  return target === 'en' || Object.keys(DICTS[target]).length > 0;
}

/**
 * Fetch a language's dictionary, once.
 *
 * Safe to call from anywhere and as often as you like: repeat calls share the
 * one request. A failure is not an error the reader should see — English keys
 * still render — so the promise resolves (and `dictionaryLoaded` stays false).
 */
export function loadDictionary(target: Lang): Promise<void> {
  if (target === 'en') return Promise.resolve();
  const existing = loading.get(target);
  if (existing) return existing;
  const request = LOADERS[target]()
    .then((dictionary) => {
      DICTS[target] = dictionary;
    })
    .catch(() => {
      /* the English key is the fallback: a missing chunk is a slower app, not a broken one */
    });
  loading.set(target, request);
  return request;
}

let lang: Lang = 'en';

export function getLang(): Lang {
  return lang;
}
export function loadLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    lang = raw === 'fa' || raw === 'fi' ? raw : 'en';
  } catch {
    lang = 'en';
  }
  return lang;
}

export function setLang(next: Lang): void {
  lang = next;
  // The planner reloads after a language change, so this is belt and braces for
  // any caller that does not (and for the reload's own window, where the
  // dictionary is already in the module cache).
  void loadDictionary(next);
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* ignore */
  }
  applyDocumentLang();
}

export function applyDocumentLang(): void {
  if (typeof document === 'undefined') return;
  const info = LANGUAGES.find((item) => item.id === lang) ?? LANGUAGES[0];
  document.documentElement.lang = info.id;
  document.documentElement.dir = info.dir;
}

const EASTERN_ARABIC = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/**
 * Eastern Arabic numerals for Persian screens: "14:05" → "۱۴:۰۵".
 * No-op in English, so Latin-script output never changes.
 * Only ever applied to display strings — input `value`s keep ASCII digits.
 */
export function faDigits(value: string): string {
  return digitsIn(value, lang);
}

/**
 * The same conversion for callers that carry the language themselves.
 *
 * The marketing pages keep their own `lang` (the site and the planner can be in
 * different languages on the same screen), so they pass it in rather than
 * relying on the module's current one.
 */
export function digitsIn(value: number | string, target: Lang): string {
  const text = String(value);
  if (target !== 'fa') return text;
  return text.replace(/[0-9]/g, (digit) => EASTERN_ARABIC[Number(digit)]);
}

/** Display a number: Persian digits in fa, the plain number in English. */
export function faNum(value: number): number | string {
  return lang === 'fa' ? faDigits(String(value)) : value;
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!(name in vars)) return match;
    const value = vars[name];
    // Numbers — and bare numeric strings like "14:30" — follow the language
    // (۱۲ in Persian). Anything with letters (titles, names) is left as given.
    const numeric = typeof value === 'number' || /^\d+([:.]\d+)*$/.test(String(value));
    return numeric ? faDigits(String(value)) : String(value);
  });
}

export function t(text: string, vars?: Record<string, string | number>): string {
  return interpolate(DICTS[lang][text] ?? text, vars);
}

/** Plural helper: tn(n, '{count} task', '{count} tasks'). Persian needs no plural form. */
export function tn(count: number, one: string, other: string, vars?: Record<string, string | number>): string {
  return t(count === 1 ? one : other, { count, ...vars });
}

/** For tests: every key a dictionary is missing. */
export function missingKeys(keys: string[], target: Lang): string[] {
  return keys.filter((key) => !(key in DICTS[target]));
}

// Read the saved language at import so module-level constants translate on first use.
loadLang();
