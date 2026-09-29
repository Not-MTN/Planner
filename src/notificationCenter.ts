import type { Reminder } from './reminders';

export interface PlannerNotification extends Reminder {
  createdAt: string;
  read: boolean;
}

const STORAGE_KEY = 'planner-notification-center';
const CHANGE_EVENT = 'planner-notification-center-change';

function emitChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function loadNotifications(): PlannerNotification[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is PlannerNotification =>
      Boolean(item && typeof item === 'object' &&
        typeof (item as PlannerNotification).key === 'string' &&
        typeof (item as PlannerNotification).title === 'string' &&
        typeof (item as PlannerNotification).body === 'string' &&
        typeof (item as PlannerNotification).createdAt === 'string' &&
        typeof (item as PlannerNotification).read === 'boolean'),
    );
  } catch {
    return [];
  }
}

export function saveNotifications(items: PlannerNotification[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    // Notification history is a convenience; never block planner saves.
  }
  emitChange();
}

export function appendNotifications(reminders: Reminder[], now = new Date()): void {
  if (reminders.length === 0) return;
  const current = loadNotifications();
  const known = new Set(current.map((item) => item.key));
  const added = reminders.filter((item) => !known.has(item.key)).map((item) => ({
    ...item,
    createdAt: now.toISOString(),
    read: false,
  }));
  if (added.length > 0) saveNotifications([...added, ...current]);
}

export function markNotificationsRead(keys?: string[]): void {
  const selected = keys ? new Set(keys) : null;
  saveNotifications(loadNotifications().map((item) =>
    !item.read && (!selected || selected.has(item.key)) ? { ...item, read: true } : item,
  ));
}

export function clearNotifications(): void {
  saveNotifications([]);
}

export function subscribeNotifications(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
