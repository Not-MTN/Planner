import type { PlannerState } from './types';
import { addDays, todayISO } from './dates';
import { eventsForDate, tasksForDate } from './logic';
import type { ReminderSettings } from './reminders';

const ENABLED_KEY = 'planner-background-push-enabled';
export interface PushJob { key: string; sendAt: string }

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
  if (config.configured !== true || typeof config.publicKey !== 'string') {
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
  if (!backgroundPushEnabled() || !('serviceWorker' in navigator)) return;
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
