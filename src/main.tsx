import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { registerPWA } from './pwa';
import '@fontsource-variable/estedad';
// Tokens and base resets only. styles.css holds the planner's components and
// is imported by the gate, so the public site never inherits them (and the two
// bundles cannot re-style each other's .check, .hero, .field, .btn, ...).
import './tokens.css';

// The marketing site and the planner are two separate bundles: opening the app
// never downloads the landing page, and vice versa.
const Site = lazy(() => import('./marketing/Site').then((module) => ({ default: module.Site })));
// The gate opens the encrypted vault, then renders the planner.
const AccountGate = lazy(() => import('./auth/AccountGate').then((module) => ({ default: module.AccountGate })));

/**
 * "/" and the auth pages are the marketing site; "/app" is the planner.
 * Old planner links ("/#/today") are redirected to "/app#/today" so bookmarks
 * and installed PWA shortcuts keep working.
 */
function bootTarget(): 'app' | 'site' {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/app' || path.startsWith('/app/')) return 'app';
  if (path === '/' && /^#\/(today|calendar|tasks|habits|goals|notes|insights|plans|ai|day|quickadd)/.test(window.location.hash)) {
    window.history.replaceState({}, '', `/app${window.location.hash}`);
    return 'app';
  }
  return 'site';
}

const target = bootTarget();
// Loaded on demand: the i18n module pulls the whole Persian dictionary, which
// the marketing site never needs.
if (target === 'app') void import('./i18n').then((module) => module.applyDocumentLang());
registerPWA();

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

root.innerHTML = '';

createRoot(root).render(
  <StrictMode>
    <Suspense
      fallback={
        <div className="boot-shell" aria-hidden="true">
          <p className="boot-kicker">Planner</p>
          <div className="boot-line" />
          <div className="boot-panel" />
        </div>
      }
    >
      {target === 'app' ? <AccountGate /> : <Site />}
    </Suspense>
  </StrictMode>,
);
