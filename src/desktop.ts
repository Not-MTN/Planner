/**
 * The desktop app's own two features: staying in the background, and firing
 * reminders while no window is open.
 *
 * Both live in the main process — it is the only thing that outlives the
 * window — and the page reaches them through `window.plannerDesktop`. This
 * module is the page's side of that bridge, kept apart from the rest of the
 * reminder code so a browser tab and a phone app do not have to know about it:
 *
 *   * `desktopPreferences()` / `setDesktopBackground(on)` — whether closing the
 *     window keeps Planner running. The main process owns the value (so the
 *     tray menu can change it too) and broadcasts changes back here.
 *   * `syncDesktopReminders(state, settings)` — hands over the reminders the
 *     page has already computed, so the main process can fire them at the right
 *     minute with or without a window. Planner text never crosses the network
 *     here: it is an IPC call inside the machine.
 *
 * Everything is a no-op outside the desktop app, so callers can wire it up
 * unconditionally.
 */
import type { PlannerState } from './types';
import { shellPlatform } from './shared/nativeShell';
import { upcomingReminders, type ReminderSettings } from './reminders';

export interface DesktopPreferences {
  /** Closing the window hides Planner instead of quitting it. */
  background: boolean;
  backgroundExplained?: boolean;
}

interface DesktopBridge {
  platform?: string;
  getPreferences: () => Promise<DesktopPreferences>;
  setPreferences: (patch: Partial<DesktopPreferences>) => Promise<DesktopPreferences>;
  onPreferences: (listener: (preferences: DesktopPreferences) => void) => () => void;
  setReminders: (schedule: DesktopReminder[]) => Promise<{ scheduled: number }>;
}

export interface DesktopReminder {
  key: string;
  title: string;
  body: string;
  /** ISO timestamp. */
  at: string;
}

function bridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const desktop = (window as Window & { plannerDesktop?: Partial<DesktopBridge> }).plannerDesktop;
  if (!desktop || typeof desktop.getPreferences !== 'function') return null;
  return desktop as DesktopBridge;
}

/** True inside the packaged desktop app, where the bridge exists. */
export function isDesktopShell(): boolean {
  return shellPlatform() === 'desktop' && bridge() !== null;
}

export async function desktopPreferences(): Promise<DesktopPreferences | null> {
  const api = bridge();
  if (!api) return null;
  try {
    return await api.getPreferences();
  } catch {
    return null;
  }
}

/** Persist the choice in the main process; returns what was actually stored. */
export async function setDesktopBackground(background: boolean): Promise<DesktopPreferences | null> {
  const api = bridge();
  if (!api) return null;
  try {
    return await api.setPreferences({ background });
  } catch {
    return null;
  }
}

/**
 * Follow the setting wherever it is changed — the tray menu changes the same
 * value, and the settings screen should not disagree with it.
 */
export function onDesktopPreferences(listener: (preferences: DesktopPreferences) => void): () => void {
  const api = bridge();
  if (!api) return () => undefined;
  try {
    return api.onPreferences(listener);
  } catch {
    return () => undefined;
  }
}

/**
 * The reminders worth handing over: the same list the phone shells schedule,
 * capped the same way. `[]` clears the main process's schedule when reminders
 * are off, so turning the setting off stops background notifications too.
 */
export function desktopReminderSchedule(state: PlannerState, settings: ReminderSettings, now = new Date()): DesktopReminder[] {
  if (!settings.enabled) return [];
  return upcomingReminders(state, now, settings)
    .slice(0, 60)
    .map((reminder) => ({ key: reminder.key, title: reminder.title, body: reminder.body, at: reminder.at.toISOString() }));
}

/** Hand the schedule to the main process. Silent outside the desktop app. */
export async function syncDesktopReminders(state: PlannerState, settings: ReminderSettings, now = new Date()): Promise<void> {
  // No `isTestEnv()` guard here on purpose: this is an in-process hand-off, not
  // a network effect, and the guard is what the bridge check already covers —
  // while also being what keeps this function testable.
  if (!isDesktopShell()) return;
  const api = bridge();
  if (!api) return;
  try {
    await api.setReminders(desktopReminderSchedule(state, settings, now));
  } catch {
    // The in-app reminder check still runs while Planner is open; a failed
    // hand-off only costs reminders behind a closed window.
  }
}
