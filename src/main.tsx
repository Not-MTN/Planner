import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { registerPWA } from './pwa';
import { installApiOriginShim, isNativeShell } from './shared/nativeShell';
import { installDeepLinkHandler } from './shared/deepLinks';
import { appRouteFromHash } from './route';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './reporting';
import '@fontsource-variable/estedad';
// Tokens and base resets only. styles.css holds the planner's components and
// is imported by the gate, so the public site never inherits them (and the two
// bundles cannot re-style each other's .check, .hero, .field, .btn, ...).
import './tokens.css';
import './styles-polish.css';

// The marketing site and the planner are two separate bundles: opening the app
// never downloads the landing page, and vice versa.
const Site = lazy(() => import('./marketing/Site').then((module) => ({ default: module.Site })));
// The gate opens the encrypted vault, then renders the planner.
const AccountGate = lazy(() => import('./auth/AccountGate').then((module) => ({ default: module.AccountGate })));

/**
 * "/" and the auth pages are the marketing site; "/app" is the planner.
 * Old planner links ("/#/today") are redirected to "/app#/today" so bookmarks
 * and installed PWA shortcuts keep working.
 *
 * "Old" is not only historical: a guardian's QR code is a link to "/" with a
 * route in its hash, which is where a scanned invite, an App Link and a shared
 * bookmark all arrive. Every route the app knows counts, so `/` with
 * `#/panels?invite=…` opens the invite instead of the landing page.
 */
function bootTarget(): 'app' | 'site' {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/app' || path.startsWith('/app/')) return 'app';
  // The sign-in pages stay sign-in pages everywhere: a signed-out shell lands
  // on /login, and sending it back to the planner instead would bounce between
  // the two forever.
  if (path === '/login' || path === '/signup' || path === '/recover') return 'site';
  if (path === '/' && appRouteFromHash(window.location.hash)) {
    window.history.replaceState({}, '', `/app${window.location.hash}`);
    return 'app';
  }
  // A packaged app opens the planner itself. The landing page is for the
  // website; nobody installs an app to read about it.
  if (path === '/' && isNativeShell()) return 'app';
  try {
    const url = new URL(window.location.href);
    if (path === '/' && !url.searchParams.has('stay')) {
      const shouldRedirect = localStorage.getItem('planner-should-redirect') === '1';
      const hasAuthFlag = localStorage.getItem('planner-auth-flag') === '1';
      const hasLastUser = Boolean(localStorage.getItem('planner-last-user-id'));
      if (shouldRedirect && (hasAuthFlag || hasLastUser)) {
        window.history.replaceState({}, '', '/app');
        return 'app';
      }
    }
  } catch {
    /* storage blocked */
  }
  return 'site';
}

const target = bootTarget();
// Loaded on demand: the i18n module pulls the whole Persian dictionary, which
// the marketing site never needs.
if (target === 'app') void import('./i18n').then((module) => module.applyDocumentLang());
// Must run before anything else issues a request: inside a packaged app the
// API lives on another origin, and every `/api/...` call in the app is
// rewritten to reach it, session cookie included.
installApiOriginShim();
// A link that opened this app — a guardian's invite code, or any address the
// app recognizes — becomes the route it names. Nothing to do in a browser tab:
// the address is already the one the page is on.
void installDeepLinkHandler();
registerPWA();
// Catches what React cannot: throws in handlers and timers, and promises
// nobody awaited. Without it a crash in the browser is invisible to us.
installGlobalErrorHandlers();

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
      <ErrorBoundary area={target}>
        {target === 'app' ? <AccountGate /> : <Site />}
      </ErrorBoundary>
    </Suspense>
  </StrictMode>,
);
