import { describe, expect, it } from 'vitest';
import { buildPushJobs } from './push';
import { todayISO } from './dates';
import { createEmptyState } from './types';
import { DEFAULT_REMINDERS } from './reminders';

describe('background push reminder scheduling', () => {
  it('schedules generic event/task alerts and a digest without uploading titles', () => {
    const now = new Date(2026, 8, 30, 8, 0, 0);
    const date = todayISO(now);
    const state = createEmptyState();
    state.events.push({ id: 'event-opaque-id', title: 'Private meeting name', date, startTime: '09:00', endTime: null, category: 'personal', note: '', important: false, completed: false, sortOrder: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(), repeat: null });
    state.tasks.push({ id: 'task-opaque-id', title: 'Private task name', completed: false, priority: 'medium', dueDate: date, dueTime: '10:00', category: 'personal', note: '', goalId: null, sortOrder: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(), repeat: null, subtasks: [], waiting: null, estimatedMinutes: null });
    const jobs = buildPushJobs(state, now, { ...DEFAULT_REMINDERS, enabled: true, digest: true, digestTime: '08:30', lead: 10 });
    expect(jobs.map((job) => job.key)).toEqual(expect.arrayContaining([
      `${date}|event|event-opaque-id|09:00`,
      `${date}|task|task-opaque-id|10:00`,
      `${date}|digest`,
    ]));
    expect(JSON.stringify(jobs)).not.toContain('Private meeting name');
    expect(JSON.stringify(jobs)).not.toContain('Private task name');
  });

  it('does not schedule past reminders or anything when reminders are disabled', () => {
    const now = new Date(2026, 8, 30, 10, 0, 0);
    const state = createEmptyState();
    const date = todayISO(now);
    state.events.push({ id: 'old', title: 'Past', date, startTime: '09:00', endTime: null, category: 'personal', note: '', important: false, completed: false, sortOrder: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(), repeat: null });
    expect(buildPushJobs(state, now, { ...DEFAULT_REMINDERS, enabled: false })).toEqual([]);
  });
});
