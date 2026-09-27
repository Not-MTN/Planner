import { ACCENTS, type Accent } from './constants';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'planner-theme';
const ACCENT_KEY = 'planner-accent';

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

const MODE_SET = new Set<string>(THEME_MODES);
const ACCENT_SET = new Set<string>(ACCENTS);

export function loadThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return MODE_SET.has(String(raw)) ? (raw as ThemeMode) : 'system';
  } catch {
    return 'system';
  }
}

export function loadAccent(fallback: Accent): Accent {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(ACCENT_KEY);
    return ACCENT_SET.has(String(raw)) ? (raw as Accent) : fallback;
  } catch {
    return fallback;
  }
}

export function resolvedMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode, accent: Accent): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolvedMode(mode);
  root.dataset.theme = resolved;
  root.dataset.accent = accent;
  root.style.colorScheme = resolved;
  try {
    window.localStorage.setItem(THEME_KEY, mode);
    window.localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // Private modes can block storage; the theme still applies for this visit.
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#161310' : '#f4efe7');
  }
}
