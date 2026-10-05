import type { PlannerState } from './types';
import { addDays, todayISO } from './dates';
import { eventsForDate, habitsDueOn, isDone, isSkipped, tasksForDate } from './logic';
import type { ReminderSettings } from './reminders';
import { isNativeMobileShell, shellPlatform } from './shared/nativeShell';
import { t } from './i18n';

const ENABLED_KEY = 'planner-background-push-enabled';
/** The device's push token and the secret that proves we own it. Not a credential: the token is opaque to us and only works through the server. */
const DEVICE_KEY = 'planner-push-device';
export interface PushJob { key: string; sendAt: string }

/**
 * How this build delivers a reminder while Planner is closed.
 *
 * A browser tab uses **Web Push**: the service worker subscribes and the server
 * posts to that subscription. A phone app uses the **device's own notification
 * service** — FCM on Android, APNs on iOS: the OS hands the app a token, the app
 * hands the token and its reminder schedule to the server, and a cron sends a
 * content-free alert at each scheduled time. It is the same setting in both
 * cases; only the transport differs, and the transport is the shell's decision,
 * never the user's.
 */
export type PushTransport = 'web' | 'device';

export function pushTransport(): PushTransport {
  return isNativeMobileShell() ? 'device' : 'web';
}

/** Whether this build can do background reminders at all. */
export function backgroundPushSupported(): boolean {
  if (pushTransport() === 'device') return true;
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

interface DeviceRegistration {
  platform: 'android' | 'ios';
  token: string;
  secret: string;
}

function readDeviceRegistration(): DeviceRegistration | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceRegistration>;
    if (
      (parsed.platform === 'android' || parsed.platform === 'ios') &&
      typeof parsed.token === 'string' && parsed.token.length > 0 &&
      typeof parsed.secret === 'string' && parsed.secret.length > 0
    ) {
      return { platform: parsed.platform, token: parsed.token, secret: parsed.secret };
    }
  } catch {
    /* an unreadable registration is no registration */
  }
  return null;
}

function saveDeviceRegistration(value: DeviceRegistration | null): void {
  try {
    if (value) localStorage.setItem(DEVICE_KEY, JSON.stringify(value));
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* storage is full or disabled; the toggle still works for this session */
  }
}

/** 32 random bytes, base64url — the secret half of the token pair. */
function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendDeviceSubscription(registration: DeviceRegistration, jobs: PushJob[], method: 'POST' | 'DELETE' = 'POST'): Promise<void> {
  await readJson(await fetch('/api/push/device', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: registration.platform, token: registration.token, secret: registration.secret, jobs }),
  }));
}

/**
 * Ask the OS for a token. The plugin answers through listeners rather than a
 * promise, and it stays silent when there is nothing to register with (no
 * `google-services.json` on Android, no push capability on iOS), so the wait
 * has to time out instead of hanging the settings screen.
 */
async function registerDeviceToken(): Promise<string> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const current = await PushNotifications.checkPermissions();
  const permission = current.receive === 'granted' ? current : await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') throw new Error(t('Notification permission was not granted.'));
  return await new Promise<string>((resolve, reject) => {
    const handles: Array<{ remove: () => Promise<void> }> = [];
    let settled = false;
    const finish = (error: Error | null, token = '') => {
      if (settled) return;
      settled = true;
      for (const handle of handles) void handle.remove();
      if (error) reject(error);
      else resolve(token);
    };
    const timer = setTimeout(() => finish(new Error(t('The notification service did not answer. Check the app build and try again.'))), 15_000);
    const done = (error: Error | null, token = '') => {
      clearTimeout(timer);
      finish(error, token);
    };
    void PushNotifications.addListener('registration', (value) => done(null, value.value)).then((handle) => handles.push(handle));
    void PushNotifications.addListener('registrationError', (error) => done(new Error(error.error || t('Could not register this device for notifications.')))).then((handle) => handles.push(handle));
    void PushNotifications.register().catch((error: unknown) => done(error instanceof Error ? error : new Error(String(error))));
  });
}

async function configureDevicePush(enabled: boolean): Promise<void> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const existing = readDeviceRegistration();
  if (!enabled) {
    if (existing) {
      await sendDeviceSubscription(existing, [], 'DELETE').catch(() => undefined);
    }
    try {
      await PushNotifications.unregister();
    } catch {
      /* nothing was registered with the OS */
    }
    saveDeviceRegistration(null);
    localStorage.setItem(ENABLED_KEY, '0');
    return;
  }
  const config = await readJson(await fetch('/api/push/config', { cache: 'no-store' }));
  if (config.configured !== true || (config.transports as { device?: boolean } | undefined)?.device !== true) {
    throw new Error(t('Background push is not configured on this server yet.'));
  }
  const token = await registerDeviceToken();
  const platform: 'android' | 'ios' = shellPlatform() === 'ios' ? 'ios' : 'android';
  if (platform === 'android') {
    // Without a channel Android 8+ posts the reminder to a generic one; naming
    // it is what lets someone turn Planner's reminders down without silencing
    // the whole app. The server addresses it by the same id.
    try {
      await PushNotifications.createChannel({
        id: 'planner-reminders',
        name: t('Planner reminders'),
        description: t('A generic alert at the times you chose. It never shows task, event or habit text.'),
        importance: 3,
        visibility: 0,
      });
    } catch {
      /* the channel already exists, or the platform has no channels */
    }
  }
  // The same device keeps the same secret across toggles; a new token is a new
  // device as far as the server is concerned, and gets a new secret with it.
  const secret = existing && existing.platform === platform && existing.token === token ? existing.secret : randomSecret();
  const registration: DeviceRegistration = { platform, token, secret };
  // Prove the server accepted the pair before claiming the setting works.
  await sendDeviceSubscription(registration, []);
  saveDeviceRegistration(registration);
  localStorage.setItem(ENABLED_KEY, '1');
}

export function backgroundPushEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
}

export function buildPushJobs(state: PlannerState, now = new Date(), settings: ReminderSettings): PushJob[] {
  if (!settings.enabled) return [];
  const jobs: PushJob[] = [];
  const start = todayISO(now);
  for (let offset = 0; offset <= 30; offset += 1) {
    const date = addDays(start, offset);
    const day = new Date(`${date}T00:00:00`);
    for (const event of eventsForDate(state, date)) {
      if (event.completed) continue;
      const [hour, minute] = event.startTime.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute - settings.lead);
      if (at <= now) continue;
      jobs.push({ key: `${date}|event|${event.id}|${event.startTime}`, sendAt: at.toISOString() });
    }
    for (const task of tasksForDate(state, date)) {
      if (task.completed || !task.dueTime) continue;
      const [hour, minute] = task.dueTime.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute - settings.lead);
      if (at <= now) continue;
      jobs.push({ key: `${date}|task|${task.id}|${task.dueTime}`, sendAt: at.toISOString() });
    }
    for (const habit of habitsDueOn(state, date)) {
      if (!habit.reminderTime || isDone(state, habit.id, date) || isSkipped(state, habit.id, date)) continue;
      const [hour, minute] = habit.reminderTime.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (at <= now) continue;
      jobs.push({ key: `${date}|habit|${habit.id}|${habit.reminderTime}`, sendAt: at.toISOString() });
    }
    if (settings.digest) {
      const [hour, minute] = settings.digestTime.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (at > now && (tasksForDate(state, date).some((task) => !task.completed) || eventsForDate(state, date).length > 0)) {
        jobs.push({ key: `${date}|digest`, sendAt: at.toISOString() });
      }
    }
  }
  return jobs.slice(0, 250);
}

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const decoded = atob(padded);
  const output = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let i = 0; i < decoded.length; i += 1) output[i] = decoded.charCodeAt(i);
  return output;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = result.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Push setup failed (${response.status}).`);
  }
  return result;
}

export async function configureBackgroundPush(enabled: boolean): Promise<void> {
  if (pushTransport() === 'device') return configureDevicePush(enabled);
  if (!enabled) {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/subscription', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON(), jobs: [] }) });
        await subscription.unsubscribe();
      }
    }
    localStorage.setItem(ENABLED_KEY, '0');
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Background push notifications are not supported in this browser.');
  }
  const config = await readJson(await fetch('/api/push/config', { cache: 'no-store' }));
  const transports = config.transports as { web?: boolean } | undefined;
  if (!transports?.web || typeof config.publicKey !== 'string') {
    throw new Error('Background push is not configured on this server yet.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  if (!(await navigator.serviceWorker.getRegistration())) throw new Error('Install or reload Planner once so its service worker is ready.');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.publicKey) });
  }
  localStorage.setItem(ENABLED_KEY, '1');
}

export async function refreshBackgroundPushSchedule(state: PlannerState, settings: ReminderSettings): Promise<void> {
  if (!backgroundPushEnabled()) return;
  if (pushTransport() === 'device') {
    const registration = readDeviceRegistration();
    if (!registration) return;
    try {
      await sendDeviceSubscription(registration, buildPushJobs(state, new Date(), settings));
    } catch {
      // A failed schedule refresh is not worth interrupting anyone: the next
      // change re-sends it, and the device's own local schedule is untouched.
    }
    return;
  }
  if (!('serviceWorker' in navigator)) return;
  const config = await readJson(await fetch('/api/push/config', { cache: 'no-store' }));
  if (config.configured !== true) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const jobs = buildPushJobs(state, new Date(), settings);
  await readJson(await fetch('/api/push/subscription', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON(), jobs }),
  }));
}
