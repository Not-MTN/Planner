import { displayTime, timeToMinutes, todayISO } from './dates';
import { eventsForDate, tasksForDate } from './logic';
import type { PlannerState } from './types';
import { t } from './i18n';

export interface ReminderSettings {
  enabled: boolean;
  /** Minutes before an event or timed task to remind. */
  lead: number;
  /** A morning summary of the day. */
  digest: boolean;
  digestTime: string;
}

export interface Reminder {
  key: string;
  title: string;
  body: string;
}

const SETTINGS_KEY = 'planner-reminders';
const FIRED_KEY = 'planner-reminders-fired';
export const LEAD_CHOICES = [0, 5, 10, 15, 30, 60] as const;

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: false, lead: 10, digest: true, digestTime: '08:00' };

export function loadReminderSettings(): ReminderSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<ReminderSettings> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_REMINDERS;
    return {
      enabled: raw.enabled === true,
      lead: LEAD_CHOICES.includes(raw.lead as (typeof LEAD_CHOICES)[number]) ? (raw.lead as number) : DEFAULT_REMINDERS.lead,
      digest: raw.digest !== false,
      digestTime: typeof raw.digestTime === 'string' && /^\d{2}:\d{2}$/.test(raw.digestTime) ? raw.digestTime : DEFAULT_REMINDERS.digestTime,
    };
  } catch {
    return DEFAULT_REMINDERS;
  }
}

export function saveReminderSettings(settings: ReminderSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full — reminders just won't persist */
  }
}

export function loadFired(today: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string' && key.startsWith(today)) : []);
  } catch {
    return new Set();
  }
}

export function saveFired(fired: Set<string>): void {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-300)));
  } catch {
    /* ignore */
  }
}

/** Grace window: reminders older than this are skipped rather than fired late. */
const GRACE = 15;

/**
 * Reminders that should fire at `now` and have not fired yet. Pure, so it can be tested.
 */
export function dueReminders(state: PlannerState, now: Date, settings: ReminderSettings, fired: Set<string>): Reminder[] {
  if (!settings.enabled) return [];
  const today = todayISO(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  const out: Reminder[] = [];
  const inWindow = (target: number) => minute >= target && minute <= target + GRACE;

  for (const event of eventsForDate(state, today)) {
    if (event.completed) continue;
    const key = `${today}|event|${event.id}|${event.startTime}`;
    if (fired.has(key)) continue;
    if (!inWindow(timeToMinutes(event.startTime) - settings.lead)) continue;
    out.push({
      key,
      title: event.title,
      body: settings.lead > 0 ? t("Starts at {0} · in {1} min", { 0: displayTime(event.startTime), 1: settings.lead }) : t("Starting now · {0}", { 0: displayTime(event.startTime) }),
    });
  }
  for (const task of tasksForDate(state, today)) {
    if (task.completed || !task.dueTime) continue;
    const key = `${today}|task|${task.id}|${task.dueTime}`;
    if (fired.has(key)) continue;
    if (!inWindow(timeToMinutes(task.dueTime) - settings.lead)) continue;
    out.push({ key, title: task.title, body: t("Task due at {0}", { 0: displayTime(task.dueTime) }) });
  }
  if (settings.digest) {
    const key = `${today}|digest`;
    if (!fired.has(key) && inWindow(timeToMinutes(settings.digestTime))) {
      const tasks = tasksForDate(state, today).filter((task) => !task.completed).length;
      const events = eventsForDate(state, today).length;
      if (tasks + events > 0) {
        out.push({
          key,
          title: t("Good morning — here is your day"),
          body: t("{0} {1} and {2} open {3} today.", { 0: events, 1: events === 1 ? t("event") : t("events"), 2: tasks, 3: tasks === 1 ? t("task") : t("tasks") }),
        });
      }
    }
  }
  return out;
}

export async function showNotification(reminder: Reminder): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const options: NotificationOptions = { body: reminder.body, tag: reminder.key, icon: '/favicon.svg' };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(reminder.title, options);
      return true;
    }
  } catch {
    /* fall through to the page-level API */
  }
  try {
    new Notification(reminder.title, options);
    return true;
  } catch {
    return false;
  }
}
