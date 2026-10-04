// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addEvent } from './mutate';
import { DEFAULT_REMINDERS, type ReminderSettings } from './reminders';
import { createEmptyState } from './types';
import { getReminderPermission, requestReminderPermission, syncNativeReminders } from './nativeReminders';

const notifications = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  cancelAll: vi.fn(),
  schedule: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: notifications }));

type ShellWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
const shell = window as ShellWindow;
const SETTINGS: ReminderSettings = { ...DEFAULT_REMINDERS, enabled: true, digest: false, lead: 10 };
const NOW = new Date(2026, 8, 30, 9, 0, 0);

beforeEach(() => {
  notifications.checkPermissions.mockReset();
  notifications.requestPermissions.mockReset();
  notifications.cancelAll.mockReset().mockResolvedValue(undefined);
  notifications.schedule.mockReset().mockResolvedValue(undefined);
  notifications.addListener.mockReset();
  shell.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
});

afterEach(() => {
  delete shell.Capacitor;
});

function stateWithEvent() {
  return addEvent(createEmptyState(), {
    title: 'Dentist',
    date: '2026-09-30',
    startTime: '10:00',
    endTime: null,
    category: 'personal',
    note: '',
    important: false,
  }, 'event-1', NOW.toISOString());
}

describe('native reminder permission', () => {
  it('checks permission without opening a prompt', async () => {
    notifications.checkPermissions.mockResolvedValue({ display: 'prompt' });
    expect(await getReminderPermission()).toBe('prompt');
    expect(notifications.checkPermissions).toHaveBeenCalledOnce();
    expect(notifications.requestPermissions).not.toHaveBeenCalled();
  });

  it('asks for notification permission only from the explicit enable flow', async () => {
    notifications.checkPermissions.mockResolvedValue({ display: 'prompt' });
    notifications.requestPermissions.mockResolvedValue({ display: 'granted' });
    expect(await requestReminderPermission()).toBe('granted');
    expect(notifications.requestPermissions).toHaveBeenCalledOnce();
  });
});

describe('native schedule synchronization', () => {
  it('schedules upcoming event reminders locally at their lead time', async () => {
    notifications.checkPermissions.mockResolvedValue({ display: 'granted' });
    await syncNativeReminders(stateWithEvent(), SETTINGS, NOW);

    expect(notifications.cancelAll).toHaveBeenCalledOnce();
    expect(notifications.schedule).toHaveBeenCalledOnce();
    const payload = notifications.schedule.mock.calls[0]?.[0] as {
      notifications: Array<{ title: string; body: string; schedule: { at: Date }; isExactNotification: boolean }>;
    };
    expect(payload.notifications).toHaveLength(1);
    expect(payload.notifications[0]).toMatchObject({
      title: 'Coming up: Dentist',
      schedule: { at: new Date(2026, 8, 30, 9, 50, 0) },
      isExactNotification: false,
    });
    expect(payload.notifications[0]?.body).toContain('get settled');
  });

  it('clears the old schedule and never schedules without notification permission', async () => {
    notifications.checkPermissions.mockResolvedValue({ display: 'denied' });
    await syncNativeReminders(stateWithEvent(), SETTINGS, NOW);
    expect(notifications.cancelAll).toHaveBeenCalledOnce();
    expect(notifications.schedule).not.toHaveBeenCalled();
  });

  it('cancels pending notices when reminders are switched off without prompting', async () => {
    notifications.checkPermissions.mockResolvedValue({ display: 'prompt' });
    await syncNativeReminders(stateWithEvent(), { ...SETTINGS, enabled: false }, NOW);
    expect(notifications.cancelAll).toHaveBeenCalledOnce();
    expect(notifications.checkPermissions).not.toHaveBeenCalled();
    expect(notifications.requestPermissions).not.toHaveBeenCalled();
  });
});
