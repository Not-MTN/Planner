/** Service worker registration and the "Install app" prompt. */

import { snoozeReminder } from './reminders';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

// ── "New version available" flow ─────────────────────────────────────────

let waitingWorker: ServiceWorker | null = null;
const updateListeners = new Set<() => void>();

function markUpdate(worker: ServiceWorker): void {
  waitingWorker = worker;
  updateListeners.forEach((listener) => listener());
}
export function onUpdateAvailable(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

/** Tell the waiting worker to take over; the controllerchange below reloads. */
export function applyUpdate(): void {
  waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
}

export function registerPWA(): void {
  if (typeof window === 'undefined') return;
  // "Snooze 10 min" pressed on a system notification. The worker cannot
  // reschedule anything itself, so it asks an open tab to do it.
  navigator.serviceWorker?.addEventListener('message', (event) => {
    const data = (event as MessageEvent).data as { type?: string; key?: string; minutes?: number } | null;
    if (!data || data.type !== 'planner-snooze') return;
    if (typeof data.key !== 'string' || typeof data.minutes !== 'number') return;
    snoozeReminder(data.key, data.minutes);
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    listeners.forEach((listener) => listener());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((listener) => listener());
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // Only reload after an *update* — never when the first worker claims the page.
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (registration.waiting) markUpdate(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            // A new worker finished installing while we already had a controller → update waiting.
            if (worker.state === 'installed' && navigator.serviceWorker.controller) markUpdate(worker);
          });
        });
      })
      .catch(() => {
        /* offline support is a bonus; the app works without it */
      });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

export function canInstall(): boolean {
  return deferred !== null;
}

export function isInstalled(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  listeners.forEach((listener) => listener());
  return choice.outcome === 'accepted';
}
