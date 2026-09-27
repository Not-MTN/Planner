/**
 * Tiny translation layer. English text is the key: `t('Add task')`.
 * Missing translations fall back to English, so nothing ever renders blank.
 * Placeholders use braces: t('{count} tasks', { count: 3 }).
 */
import { fa } from './locales/fa';

export type Lang = 'en' | 'fa';
export const LANGUAGES: { id: Lang; label: string; dir: 'ltr' | 'rtl' }[] = [
  { id: 'en', label: 'English', dir: 'ltr' },
  { id: 'fa', label: 'فارسی', dir: 'rtl' },
];

const LANG_KEY = 'planner-lang';
const DICTS: Record<Lang, Record<string, string>> = { en: {}, fa };
let lang: Lang = 'en';

export function getLang(): Lang {
  return lang;
}

export function isRTL(): boolean {
  return LANGUAGES.find((item) => item.id === lang)?.dir === 'rtl';
}

export function loadLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    lang = raw === 'fa' ? 'fa' : 'en';
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

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
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
