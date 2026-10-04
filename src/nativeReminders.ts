import type { PlannerState } from './types';
import { isNativeMobileShell, shellPlatform } from './shared/nativeShell';
import { upcomingReminders, type ReminderSettings } from './reminders';
import { t } from './i18n';

export type ReminderPermission = 'granted' | 'prompt' | 'denied';

function normalizePermission(value: string): ReminderPermission {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  return 'prompt';
}

/** Read permission only; never opens a prompt on render or app launch. */
export async function getReminderPermission(): Promise<ReminderPermission> {
  if (isNativeMobileShell()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permission = await LocalNotifications.checkPermissions();
      return normalizePermission(permission.display);
    } catch {
      return 'prompt';
    }
  }
  if (typeof Notification === 'undefined') return 'denied';
  return normalizePermission(Notification.permission);
}

/** Request notifications only after the user turns reminders on. */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (isNativeMobileShell()) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return 'granted';
    const permission = await LocalNotifications.requestPermissions();
    return normalizePermission(permission.display);
  }
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return normalizePermission(Notification.permission);
  }
  return normalizePermission(await Notification.requestPermission());
}

/**
 * Replace the native device schedule with the next month of reminders. Android
 * and iOS wake the app to deliver these even when Planner is closed. We use
 * inexact alarms on Android: useful timing without asking for special exact-
 * alarm access. Permission is checked, never requested, here.
 */
export async function syncNativeReminders(
  state: PlannerState,
  settings: ReminderSettings,
  now = new Date(),
): Promise<void> {
  if (!isNativeMobileShell()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  if (!settings.enabled) {
    await LocalNotifications.cancelAll();
    return;
  }
  await LocalNotifications.cancelAll();
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') return;

  // iOS allows at most 64 pending local notifications. Leave a little room for
  // future app notifications and keep Android's schedule equally lightweight.
  const scheduled = upcomingReminders(state, now, settings).slice(0, 60);
  if (scheduled.length === 0) return;
  if (shellPlatform() === 'android') {
    // A named, high-importance channel gives reminders a branded light colour,
    // sound and vibration while leaving the final controls with the user in
    // Android Settings. Re-creating an existing channel is safe.
    await LocalNotifications.createChannel({
      id: 'planner-reminders',
      name: t('Planner reminders'),
      description: t('Gentle nudges for your schedule, tasks, and habits.'),
      importance: 4,
      visibility: 1,
      lights: true,
      lightColor: '#6F846C',
      vibration: true,
    }).catch(() => undefined);
  }
  await LocalNotifications.schedule({
    notifications: scheduled.map((reminder, index) => ({
      id: index + 1,
      title: reminder.title,
      body: reminder.body,
      schedule: { at: reminder.at },
      channelId: 'planner-reminders',
      smallIcon: 'ic_stat_planner',
      iconColor: '#6F846C',
      // Approximate timing avoids Android's special "Alarms & reminders"
      // settings screen; allow-while-idle still delivers during ordinary Doze.
      isExactNotification: false,
      allowWhileIdle: true,
      extra: { key: reminder.key, route: 'today' },
      threadIdentifier: 'planner-reminders',
      group: 'planner-reminders',
    })),
  });
}

/** Open the day view when the person taps one of Planner's native reminders. */
export async function listenForNativeNotificationTaps(onTap: () => void): Promise<() => void> {
  if (!isNativeMobileShell()) return () => undefined;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const listener = await LocalNotifications.addListener('localNotificationActionPerformed', () => onTap());
    return () => { void listener.remove(); };
  } catch {
    return () => undefined;
  }
}
