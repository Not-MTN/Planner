import { useCallback, useEffect, useState } from 'react';
import { COPY, isLang, type Lang } from './copy';
import { Landing } from './Landing';
import { Auth } from './Auth';
import { applyTheme, loadThemeMode, type ThemeMode } from '../theme';
import type { Accent } from '../constants';
import './marketing.css';

const LANG_KEY = 'planner-site-lang';
const ACCENT: Accent = 'sage';

function readPath(): string {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

function readLang(): Lang {
  try {
    const stored = window.localStorage.getItem(LANG_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* storage blocked */
  }
  return 'en';
}

export function Site() {
  const [path, setPath] = useState<string>(readPath);
  const [lang, setLang] = useState<Lang>(readLang);
  const [theme, setTheme] = useState<ThemeMode>(loadThemeMode);
  const [menu, setMenu] = useState(false);
  const c = COPY[lang];

  useEffect(() => {
    applyTheme(theme, ACCENT);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Scroll-reveal: mark anything tagged [data-reveal] once it enters the viewport.
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (nodes.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [path]);

  const navigate = useCallback((to: string) => {
    if (window.location.pathname !== to) window.history.pushState({}, '', to);
    setPath(to);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const onPop = () => {
      setPath(readPath());
      setMenu(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goToSection = (id: string) => {
    if (path !== '/') {
      navigate('/');
      window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 60);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMenu(false);
  };

  const isAuth = path === '/login' || path === '/signup' || path === '/recover';

  return (
    <div className="mkt" dir={lang === 'fa' ? 'rtl' : 'ltr'} data-lang={lang}>
      <header className="nav">
        <div className="wrap nav-inner">
          <button type="button" className="brand" onClick={() => navigate('/')}>
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">{c.brand}</span>
          </button>

          <nav className={`nav-links ${menu ? 'is-open' : ''}`} aria-label={c.navMenu}>
            <button type="button" onClick={() => goToSection('how')}>
              {c.navHow}
            </button>
            <button type="button" onClick={() => goToSection('roles')}>
              {c.navRoles}
            </button>
            <button type="button" onClick={() => goToSection('guardians')}>
              {c.navGuardians}
            </button>
            <button type="button" onClick={() => goToSection('ai')}>
              {c.navAI}
            </button>
            <button type="button" onClick={() => goToSection('privacy')}>
              {c.navPrivacy}
            </button>
          </nav>

          <div className="nav-tools">
            <button
              type="button"
              className="icon-btn"
              aria-label={c.langToggle}
              onClick={() => {
                const next: Lang = lang === 'en' ? 'fa' : 'en';
                setLang(next);
                try {
                  window.localStorage.setItem(LANG_KEY, next);
                } catch {
                  /* ignore */
                }
              }}
            >
              {lang === 'en' ? 'فا' : 'EN'}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={c.themeToggle}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => navigate('/login')}>
              {c.navSignIn}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/signup')}>
              {c.navStart}
            </button>
            <button type="button" className="nav-burger" aria-label={c.navMenu} aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>

      {isAuth ? (
        <Auth lang={lang} mode={path === '/login' ? 'signin' : path === '/recover' ? 'recover' : 'signup'} navigate={navigate} />
      ) : (
        <Landing lang={lang} navigate={navigate} />
      )}

      <footer className="foot">
        <div className="wrap foot-inner">
          <p className="foot-brand">
            <span className="brand-mark" aria-hidden="true" /> {c.brand}
          </p>
          <p className="foot-note">{c.footerBuilt}</p>
          <nav className="foot-links" aria-label={c.footerRights}>
            <button type="button" className="link" onClick={() => goToSection('privacy')}>
              {c.footerPrivacy}
            </button>
            <span className="foot-sep">·</span>
            <button type="button" className="link" onClick={() => goToSection('privacy')}>
              {c.footerTerms}
            </button>
            <span className="foot-sep">·</span>
            <button type="button" className="link" onClick={() => goToSection('privacy')}>
              {c.footerSecurity}
            </button>
          </nav>
          <p className="foot-fine">
            © {new Date().getFullYear()} {c.brand}. {c.footerRights}
          </p>
        </div>
      </footer>
    </div>
  );
}
