// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendNotifications, clearNotifications, loadNotifications, markNotificationsRead, subscribeNotifications } from './notificationCenter';

beforeEach(() => localStorage.clear());

describe('notification center', () => {
  it('stores reminders newest-first and ignores duplicate keys', () => {
    const now = new Date('2026-09-29T08:00:00.000Z');
    appendNotifications([{ key: 'today|event|1|09:00', title: 'Class', body: 'Starts soon' }], now);
    appendNotifications([{ key: 'today|event|1|09:00', title: 'Class', body: 'Starts soon' }], new Date(now.getTime() + 1000));
    expect(loadNotifications()).toEqual([{ key: 'today|event|1|09:00', title: 'Class', body: 'Starts soon', createdAt: now.toISOString(), read: false }]);
  });

  it('marks selected or all reminders read and clears the history', () => {
    appendNotifications([
      { key: 'a', title: 'A', body: 'One' },
      { key: 'b', title: 'B', body: 'Two' },
    ]);
    markNotificationsRead(['a']);
    expect(loadNotifications().find((item) => item.key === 'a')?.read).toBe(true);
    expect(loadNotifications().find((item) => item.key === 'b')?.read).toBe(false);
    markNotificationsRead();
    expect(loadNotifications().every((item) => item.read)).toBe(true);
    clearNotifications();
    expect(loadNotifications()).toEqual([]);
  });

  it('notifies open centers when reminder history changes', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeNotifications(callback);
    appendNotifications([{ key: 'a', title: 'A', body: 'One' }]);
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    clearNotifications();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
