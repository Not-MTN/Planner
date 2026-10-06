// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  desktopPreferences,
  desktopReminderSchedule,
  isDesktopShell,
  onDesktopPreferences,
  setDesktopBackground,
  syncDesktopReminders,
} from './desktop';
import { DEFAULT_REMINDERS } from './reminders';
import { todayISO } from './dates';
import { createEmptyState } from './types';

interface DesktopWindow extends Window {
  plannerDesktop?: unknown;
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
}

/** A stand-in for the preload bridge, with the parts the page actually calls. */
function fakeBridge(overrides: Partial<Record<string, unknown>> = {}) {
  const listeners: Array<(preferences: { background: boolean }) => void> = [];
  const setReminders = vi.fn(async (_schedule: unknown[]) => ({ scheduled: 0 }));
  const api = {
    getPreferences: vi.fn(async () => ({ background: true, backgroundExplained: false })),
    setPreferences: vi.fn(async (patch: { background: boolean }) => ({ background: patch.background, backgroundExplained: false })),
    onPreferences: vi.fn((listener: (preferences: { background: boolean }) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
    setReminders,
    ...overrides,
  };
  return { api, emit: (preferences: { background: boolean }) => listeners.forEach((listener) => listener(preferences)) };
}

function shellWith(bridge: unknown): void {
  (window as DesktopWindow).plannerDesktop = bridge;
  (window as DesktopWindow).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'desktop' };
}

afterEach(() => {
  delete (window as DesktopWindow).plannerDesktop;
  delete (window as DesktopWindow).Capacitor;
});

describe('the desktop background setting', () => {
  it('is invisible outside the desktop app', async () => {
    expect(isDesktopShell()).toBe(false);
    expect(await desktopPreferences()).toBeNull();
    expect(await setDesktopBackground(true)).toBeNull();
    expect(onDesktopPreferences(() => undefined)).toBeTypeOf('function');
    // A no-op, not a failure: the phone and browser builds call this too.
    await expect(syncDesktopReminders(createEmptyState(), DEFAULT_REMINDERS)).resolves.toBeUndefined();
  });

  it('reads, writes and follows the value the main process owns', async () => {
    const { api, emit } = fakeBridge();
    shellWith(api);
    expect(isDesktopShell()).toBe(true);
    expect(await desktopPreferences()).toEqual({ background: true, backgroundExplained: false });

    const saved = await setDesktopBackground(false);
    expect(api.setPreferences).toHaveBeenCalledWith({ background: false });
    expect(saved).toEqual({ background: false, backgroundExplained: false });

    // The tray menu changes the same value; the page hears about it.
    const seen: boolean[] = [];
    const stop = onDesktopPreferences((preferences) => seen.push(preferences.background));
    emit({ background: true });
    stop();
    emit({ background: false });
    expect(seen).toEqual([true]);
  });

  it('survives a bridge that answers with an error', async () => {
    const { api } = fakeBridge({
      getPreferences: vi.fn(async () => { throw new Error('gone'); }),
      setPreferences: vi.fn(async () => { throw new Error('gone'); }),
      onPreferences: vi.fn(() => { throw new Error('gone'); }),
    });
    shellWith(api);
    // A window that is closing mid-call must not take the settings screen down.
    expect(await desktopPreferences()).toBeNull();
    expect(await setDesktopBackground(true)).toBeNull();
    expect(onDesktopPreferences(() => undefined)).toBeTypeOf('function');
  });
});

describe('the reminder schedule handed to the desktop app', () => {
  it('is empty while reminders are off, so turning them off clears the queue', () => {
    expect(desktopReminderSchedule(createEmptyState(), { ...DEFAULT_REMINDERS, enabled: false })).toEqual([]);
  });

  it('carries the same reminders the phone shells schedule, as plain data', () => {
    const now = new Date(2026, 9, 5, 8, 0, 0);
    const date = todayISO(now);
    const state = createEmptyState();
    state.events.push({
      id: 'event-1', title: 'Private meeting name', date, startTime: '09:00', endTime: null, category: 'personal',
      note: '', important: false, completed: false, sortOrder: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(), repeat: null,
    });
    const settings = { ...DEFAULT_REMINDERS, enabled: true, lead: 10, digest: true, digestTime: '08:30' };
    const schedule = desktopReminderSchedule(state, settings, now);
    expect(schedule.map((item) => item.key)).toEqual([`${date}|digest`, `${date}|event|event-1|09:00`]);
    // The text does stay in the payload — it is the reminder itself — but only
    // over IPC, and the payload is plain JSON a structured clone can carry.
    expect(schedule[0]).toMatchObject({ title: expect.any(String), body: expect.any(String), at: expect.any(String) });
    expect(JSON.parse(JSON.stringify(schedule))).toEqual(schedule);
  });

  it('hands the list over and stops quietly when the bridge fails', async () => {
    const { api } = fakeBridge();
    shellWith(api);
    const now = new Date(2026, 9, 5, 8, 0, 0);
    const date = todayISO(now);
    const state = createEmptyState();
    state.tasks.push({
      id: 'task-1', title: 'Practice', completed: false, priority: 'medium', dueDate: date, dueTime: '10:00', category: 'personal',
      note: '', goalId: null, sortOrder: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(), repeat: null, subtasks: [], waiting: null, estimatedMinutes: null,
    });
    await syncDesktopReminders(state, { ...DEFAULT_REMINDERS, enabled: true }, now);
    expect(api.setReminders).toHaveBeenCalledTimes(1);
    expect(api.setReminders.mock.calls[0][0]).toEqual([expect.objectContaining({ key: `${date}|task|task-1|10:00` })]);

    const failing = fakeBridge({ setReminders: vi.fn(async () => { throw new Error('no window'); }) });
    shellWith(failing.api);
    await expect(syncDesktopReminders(state, { ...DEFAULT_REMINDERS, enabled: true }, now)).resolves.toBeUndefined();
  });
});
