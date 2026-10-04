import { addDays, displayTime, timeToMinutes, todayISO } from './dates';
import { eventsForDate, habitsDueOn, isDone, isSkipped, tasksForDate } from './logic';
import type { PlannerState } from './types';
import { t } from './i18n';
import { isNativeMobileShell } from './shared/nativeShell';

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

export interface UpcomingReminder extends Reminder {
  at: Date;
}

const SETTINGS_KEY = 'planner-reminders';
const FIRED_KEY = 'planner-reminders-fired';
const SNOOZE_KEY = 'planner-reminders-snoozed';
export const LEAD_CHOICES = [0, 5, 10, 15, 30, 60] as const;
/** How long a reminder can be put off. Ten minutes for "not now, but soon". */
export const SNOOZE_CHOICES = [10, 30, 60] as const;

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: false, lead: 10, digest: true, digestTime: '08:00' };

function eventReminder(key: string, title: string, startTime: string, settings: ReminderSettings): Reminder {
  return {
    key,
    title: t("Coming up: {0}", { 0: title }),
    body: settings.lead > 0
      ? t("Your {0} starts at {1} — {2} min to get settled.", { 0: title, 1: displayTime(startTime), 2: settings.lead })
      : t("Your {0} starts now. Take a breath and ease into it.", { 0: title }),
  };
}

function taskReminder(key: string, title: string, dueTime: string): Reminder {
  return {
    key,
    title: t("A gentle nudge"),
    body: t("{0} is due at {1}. One step at a time — you’ve got this.", { 0: title, 1: displayTime(dueTime) }),
  };
}

function habitReminder(key: string, name: string): Reminder {
  return {
    key,
    title: t("Time for {0}", { 0: name }),
    body: t("A small step keeps the rhythm going. Check in when you’re ready."),
  };
}

function digestReminder(key: string, eventCount: number, taskCount: number): Reminder {
  const events = eventCount === 1 ? t("1 event") : t("{0} events", { 0: eventCount });
  const tasks = taskCount === 1 ? t("1 open task") : t("{0} open tasks", { 0: taskCount });
  return {
    key,
    title: t("Good morning — here is your day"),
    body: t("A fresh day, at your pace: {0} and {1} ahead. Start with one small thing.", { 0: events, 1: tasks }),
  };
}

function localDateTime(date: string, time: string, lead = 0): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year!, month! - 1, day!, hour!, minute! - lead, 0, 0);
}

/**
 * Future local reminders for native background scheduling. Everything stays
 * on-device; the OS receives only these notification strings and timestamps.
 */
export function upcomingReminders(
  state: PlannerState,
  now: Date,
  settings: ReminderSettings,
  days = 31,
): UpcomingReminder[] {
  if (!settings.enabled || !Number.isFinite(now.getTime()) || days < 1) return [];
  const out: UpcomingReminder[] = [];
  const horizon = Math.min(31, Math.floor(days));
  const startDate = todayISO(now);
  for (let offset = 0; offset < horizon; offset += 1) {
    const date = addDays(startDate, offset);
    for (const event of eventsForDate(state, date)) {
      if (event.completed) continue;
      const key = `${date}|event|${event.id}|${event.startTime}`;
      const at = localDateTime(date, event.startTime, settings.lead);
      if (at > now) out.push({ ...eventReminder(key, event.title, event.startTime, settings), at });
    }
    for (const task of tasksForDate(state, date)) {
      if (task.completed || !task.dueTime) continue;
      const key = `${date}|task|${task.id}|${task.dueTime}`;
      const at = localDateTime(date, task.dueTime, settings.lead);
      if (at > now) out.push({ ...taskReminder(key, task.title, task.dueTime), at });
    }
    for (const habit of habitsDueOn(state, date)) {
      if (!habit.reminderTime || isDone(state, habit.id, date) || isSkipped(state, habit.id, date)) continue;
      const key = `${date}|habit|${habit.id}|${habit.reminderTime}`;
      const at = localDateTime(date, habit.reminderTime);
      if (at > now) out.push({ ...habitReminder(key, habit.name), at });
    }
    if (settings.digest) {
      const key = `${date}|digest`;
      const at = localDateTime(date, settings.digestTime);
      const eventCount = eventsForDate(state, date).filter((event) => !event.completed).length;
      const taskCount = tasksForDate(state, date).filter((task) => !task.completed).length;
      if (at > now && eventCount + taskCount > 0) out.push({ ...digestReminder(key, eventCount, taskCount), at });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

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

/**
 * Snoozes: reminder key → the epoch millisecond it should come back.
 *
 * A reminder fires inside a fifteen-minute grace window around its own time, so
 * simply suppressing it would mean it never comes back at all — the window
 * would have passed. Snoozing therefore *reschedules*: the key keeps its place
 * and is offered again when the new minute arrives.
 */
/** Grace window: reminders older than this are skipped rather than fired late. */
const GRACE = 15;

export function loadSnoozes(now = Date.now()): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const raw = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      // A snooze is kept until its whole grace window has passed — dropping it
      // the instant it came due would mean it never fired at all — and no
      // longer, so the map cannot grow forever.
      if (typeof value === 'number' && Number.isFinite(value) && value + GRACE * 60_000 > now) out.set(key, value);
    }
  } catch {
    /* a corrupt entry just means nothing is snoozed */
  }
  return out;
}

function saveSnoozes(map: Map<string, number>): void {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    /* storage full — the snooze just won't survive a reload */
  }
}

/** Put a reminder off for `minutes`. Snoozing the same key again replaces it. */
export function snoozeReminder(key: string, minutes: number, now = Date.now()): void {
  if (!key) return;
  const map = loadSnoozes(now);
  map.set(key, now + Math.max(1, minutes) * 60_000);
  saveSnoozes(map);
}

/**
 * Forget snoozes, either for the keys that just fired or wholesale.
 * Called after firing, so a snoozed reminder does not come back twice.
 */
export function clearSnoozes(keys: string[]): void {
  if (keys.length === 0) return;
  const map = loadSnoozes();
  for (const key of keys) map.delete(key);
  saveSnoozes(map);
}

function minuteOfDay(at: number): number {
  const when = new Date(at);
  return when.getHours() * 60 + when.getMinutes();
}

/**
 * Reminders that should fire at `now` and have not fired yet. Pure, so it can be tested.
 */
export function dueReminders(
  state: PlannerState,
  now: Date,
  settings: ReminderSettings,
  fired: Set<string>,
  snoozes: Map<string, number> = new Map(),
): Reminder[] {
  if (!settings.enabled) return [];
  const today = todayISO(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  const out: Reminder[] = [];
  const inWindow = (target: number) => minute >= target && minute <= target + GRACE;
  /**
   * The minute this reminder is due: its own, or the snoozed one if it was put
   * off. A reminder that was snoozed has already fired once, so its `fired`
   * entry is expected — the snooze is what makes it eligible again.
   */
  const dueAt = (key: string, ownMinute: number): number | null => {
    const snoozedUntil = snoozes.get(key);
    if (snoozedUntil === undefined) return fired.has(key) ? null : ownMinute;
    return minuteOfDay(snoozedUntil);
  };

  for (const event of eventsForDate(state, today)) {
    if (event.completed) continue;
    const key = `${today}|event|${event.id}|${event.startTime}`;
    const own = timeToMinutes(event.startTime) - settings.lead;
    const target = dueAt(key, own);
    if (target === null || !inWindow(target)) continue;
    out.push(eventReminder(key, event.title, event.startTime, settings));
  }
  for (const task of tasksForDate(state, today)) {
    if (task.completed || !task.dueTime) continue;
    const key = `${today}|task|${task.id}|${task.dueTime}`;
    const own = timeToMinutes(task.dueTime) - settings.lead;
    const target = dueAt(key, own);
    if (target === null || !inWindow(target)) continue;
    out.push(taskReminder(key, task.title, task.dueTime));
  }
  for (const habit of habitsDueOn(state, today)) {
    if (!habit.reminderTime || isDone(state, habit.id, today) || isSkipped(state, habit.id, today)) continue;
    const key = `${today}|habit|${habit.id}|${habit.reminderTime}`;
    const target = dueAt(key, timeToMinutes(habit.reminderTime));
    if (target === null || !inWindow(target)) continue;
    out.push(habitReminder(key, habit.name));
  }
  if (settings.digest) {
    const key = `${today}|digest`;
    const target = dueAt(key, timeToMinutes(settings.digestTime));
    if (target !== null && inWindow(target)) {
      const tasks = tasksForDate(state, today).filter((task) => !task.completed).length;
      const events = eventsForDate(state, today).filter((event) => !event.completed).length;
      if (tasks + events > 0) {
        out.push(digestReminder(key, events, tasks));
      }
    }
  }
  return out;
}

export async function showNotification(reminder: Reminder): Promise<boolean> {
  // The native OS schedule handles background and foreground delivery there;
  // the page-level Notification API is for browsers and installed PWAs only.
  if (isNativeMobileShell() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const options: NotificationOptions = { body: reminder.body, tag: reminder.key, icon: '/favicon.svg' };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      // Actions only render for a notification shown by a service worker, and
      // only on platforms that support them. Where they do not, the reminder
      // behaves exactly as it did before.
      // `actions` is part of the service-worker notification API, which the
      // DOM's NotificationOptions type does not model.
      const withActions = {
        ...options,
        data: { ...(options.data ?? {}), key: reminder.key, url: '/app#/today' },
        actions: SNOOZE_CHOICES.map((minutes) => ({
          action: `snooze-${minutes}`,
          title: t("Snooze {0} min", { 0: minutes }),
        })),
      } as NotificationOptions & { actions?: { action: string; title: string }[] };
      await registration.showNotification(reminder.title, withActions);
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
