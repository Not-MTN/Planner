/**
 * Tiny translation layer. English text is the key: `t('Add task')`.
 * Missing translations fall back to English, so nothing ever renders blank.
 * Placeholders use braces: t('{count} tasks', { count: 3 }).
 */
import { fa } from './locales/fa';
import { fi } from './locales/fi';

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
export const COMPLETE_LANGS: Lang[] = ['fa'];

const LANG_KEY = 'planner-lang';
const DICTS: Record<Lang, Record<string, string>> = { en: {}, fa, fi };
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
