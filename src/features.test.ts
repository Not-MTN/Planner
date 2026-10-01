import { afterEach, describe, expect, it } from 'vitest';
import { displayTime, formatMonthLong, monthGrid, setDisplayPrefs, setWeekStart, startOfWeek, weekdayHeaders } from './dates';
import { parseICS, toBusyICS, toICS } from './ics';
import { focusSummary, habitLinks, productiveHours, weeklyReport } from './insights';
import { extractTags } from './components/Markdown';
import { addAIMemory, addEvent, addFixedCommitment, addHabit, addNote, addTask, clearAIMemory, deleteAIMemory, logFocus, resizeEvent, toggleHabit, toggleSubtask, toggleTask, updateAIMemory, updateNote, updateTask } from './mutate';
import { parseQuickAdd } from './quickAdd';
import { nextDueAfterCompletion, nextOccurrence } from './recurrence';
import { dueReminders, DEFAULT_REMINDERS } from './reminders';
import { autoSchedule } from './scheduler';
import { parseBackup, sanitizeState, serialize } from './storage';
import { createEmptyState, type PlannerState, type TaskInput } from './types';

const baseTask: TaskInput = { title: 'Water plants', priority: 'medium', dueDate: '2026-09-28', dueTime: null, category: 'home', note: '', goalId: null };

describe('recurrence', () => {
  it('steps each rule forward', () => {
    expect(nextOccurrence('2026-09-28', 'daily')).toBe('2026-09-29');
    expect(nextOccurrence('2026-09-28', 'weekly')).toBe('2026-10-05');
    expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextOccurrence('2028-02-29', 'yearly')).toBe('2029-02-28');
    // Friday → Monday
    expect(nextOccurrence('2026-10-02', 'weekdays')).toBe('2026-10-05');
  });

  it('skips past dates for overdue repeating tasks', () => {
    expect(nextDueAfterCompletion('2026-09-01', 'weekly', '2026-09-27')).toBe('2026-09-29');
    expect(nextDueAfterCompletion(null, 'daily', '2026-09-27')).toBe('2026-09-28');
  });

  it('completing a repeating task spawns the next copy with fresh steps', () => {
    let state = addTask(createEmptyState(), { ...baseTask, repeat: 'weekly', subtasks: [{ id: 's1', title: 'Fern', completed: false }] }, 't1', 'now');
    state = toggleSubtask(state, 't1', 's1');
    expect(state.tasks[0].subtasks[0].completed).toBe(true);
    state = toggleTask(state, 't1', '2026-09-28T10:00:00.000Z', '2026-09-28', 't2');
    expect(state.tasks).toHaveLength(2);
    const [done, next] = state.tasks;
    expect(done.completed).toBe(true);
    // The rule stays on the finished copy: un-checking it must not end the series.
    expect(done.repeat).toBe('weekly');
    expect(done.completedAt).toBe('2026-09-28T10:00:00.000Z');
    expect(done.spawnedId).toBe('t2');
    expect(next).toMatchObject({ id: 't2', completed: false, repeat: 'weekly', dueDate: '2026-10-05' });
    expect(next.subtasks[0].completed).toBe(false);
  });

  it('un-completing a repeating task takes back the copy it spawned and keeps the rule', () => {
    let state = addTask(createEmptyState(), { ...baseTask, repeat: 'daily', dueDate: '2026-09-28' }, 't1', 'now');
    state = toggleTask(state, 't1', '2026-09-28T10:00:00.000Z', '2026-09-28', 't2');
    expect(state.tasks).toHaveLength(2);
    state = toggleTask(state, 't1', '2026-09-28T11:00:00.000Z', '2026-09-28', 't3');
    // Back to one task, still repeating, no stale copy left behind.
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: 't1', completed: false, repeat: 'daily', completedAt: null, spawnedId: null });
  });

  it('re-completing a repeating task never grows the series', () => {
    let state = addTask(createEmptyState(), { ...baseTask, repeat: 'daily', dueDate: '2026-09-28' }, 't1', 'now');
    for (const [index, id] of ['a', 'b', 'c'].entries()) {
      state = toggleTask(state, 't1', `2026-09-28T1${index}:00:00.000Z`, '2026-09-28', `spawn-${id}`);
      expect(state.tasks).toHaveLength(2);
      state = toggleTask(state, 't1', `2026-09-28T1${index}:30:00.000Z`, '2026-09-28');
      expect(state.tasks).toHaveLength(1);
    }
    expect(state.tasks[0].repeat).toBe('daily');
  });

  it('leaves a spawned copy alone once the user has worked on it', () => {
    let state = addTask(createEmptyState(), { ...baseTask, repeat: 'daily', dueDate: '2026-09-28', subtasks: [{ id: 's1', title: 'Step', completed: false }] }, 't1', 'now');
    state = toggleTask(state, 't1', '2026-09-28T10:00:00.000Z', '2026-09-28', 't2');
    // The user ticks a step on tomorrow's copy — it is their work now.
    state = toggleSubtask(state, 't2', state.tasks[1].subtasks[0].id);
    state = toggleTask(state, 't1', '2026-09-28T11:00:00.000Z', '2026-09-28');
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks.find((task) => task.id === 't2')?.subtasks[0].completed).toBe(true);
  });

  it('stamps completedAt when a task is completed through updateTask', () => {
    let state = addTask(createEmptyState(), baseTask, 't1', 'now');
    state = updateTask(state, 't1', { completed: true }, '2026-09-28T10:00:00.000Z');
    expect(state.tasks[0]).toMatchObject({ completed: true, completedAt: '2026-09-28T10:00:00.000Z' });
    state = updateTask(state, 't1', { completed: false }, '2026-09-28T11:00:00.000Z');
    expect(state.tasks[0]).toMatchObject({ completed: false, completedAt: null });
    // A patch that does not mention completion leaves the stamp untouched.
    state = updateTask(state, 't1', { completed: true }, '2026-09-28T12:00:00.000Z');
    state = updateTask(state, 't1', { title: 'Watered' }, '2026-09-28T13:00:00.000Z');
    expect(state.tasks[0].completedAt).toBe('2026-09-28T12:00:00.000Z');
  });

  it('non-repeating tasks toggle without copies', () => {
    let state = addTask(createEmptyState(), baseTask, 't1');
    state = toggleTask(state, 't1');
    state = toggleTask(state, 't1');
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].completedAt).toBeNull();
  });

  it('updateTask cleans subtasks and repeat values', () => {
    let state = addTask(createEmptyState(), baseTask, 't1');
    state = updateTask(state, 't1', { repeat: 'bogus' as never, subtasks: [{ id: 'a', title: '  ', completed: false }, { id: 'b', title: 'Real', completed: true }] });
    expect(state.tasks[0].repeat).toBeNull();
    expect(state.tasks[0].subtasks).toEqual([{ id: 'b', title: 'Real', completed: true }]);
  });
});

describe('quick add repeats', () => {
  it('reads "every" phrases', () => {
    expect(parseQuickAdd('Stretch every day 7am', null)).toMatchObject({ title: 'Stretch', repeat: 'daily', startTime: '07:00' });
    expect(parseQuickAdd('Standup weekdays', null)).toMatchObject({ title: 'Standup', repeat: 'weekdays' });
    const gym = parseQuickAdd('Gym every monday', null);
    expect(gym).toMatchObject({ title: 'Gym', repeat: 'weekly' });
    expect(new Date(`${gym?.date}T12:00`).getDay()).toBe(1);
    expect(parseQuickAdd('Every day is a gift', null)?.repeat).toBe('daily');
    expect(parseQuickAdd('Plain task', null)?.repeat).toBeNull();
  });
});

describe('storage migration', () => {
  it('fills new fields for old backups and keeps new ones', () => {
    const old = sanitizeState({ tasks: [{ id: 'a', title: 'Old', priority: 'low' }] }) as PlannerState;
    expect(old.tasks[0]).toMatchObject({ repeat: null, subtasks: [] });
    expect(old.focusLog).toEqual([]);
    expect(old.aiMemory).toEqual([]);
    let state = addTask(createEmptyState(), { ...baseTask, repeat: 'monthly', subtasks: [{ id: 's', title: 'Step', completed: true }] }, 't');
    state = logFocus(state, { taskId: 't', title: 'Water plants', minutes: 25 }, 'f', '2026-09-27T09:00:00.000Z', '2026-09-27');
    state = addNote(state, { title: 'N', body: 'b', kind: 'idea', date: null, pinned: true }, 'n');
    const round = parseBackup(serialize(state));
    expect(round.ok && round.state.tasks[0]).toMatchObject({ repeat: 'monthly', subtasks: [{ id: 's', title: 'Step', completed: true }] });
    expect(round.ok && round.state.focusLog).toHaveLength(1);
    expect(round.ok && round.state.notes[0].pinned).toBe(true);
  });

  it('rejects silly focus entries', () => {
    expect(logFocus(createEmptyState(), { taskId: null, title: 'x', minutes: 0 }).focusLog).toHaveLength(0);
  });

  it('keeps explicit AI memory editable, deduplicated, and removable', () => {
    let state = addAIMemory(createEmptyState(), { text: '  Mornings are best for deep work.  ', category: 'preference' }, 'm1', '2026-09-27T09:00:00.000Z');
    state = addAIMemory(state, { text: 'mornings are best for deep work.', category: 'routine' }, 'duplicate', '2026-09-27T09:01:00.000Z');
    expect(state.aiMemory).toHaveLength(1);
    expect(state.aiMemory[0]).toMatchObject({ id: 'm1', text: 'Mornings are best for deep work.', category: 'preference' });
    state = updateAIMemory(state, 'm1', { category: 'routine', text: 'I protect Sunday evenings for family.' }, '2026-09-27T10:00:00.000Z');
    expect(state.aiMemory[0]).toMatchObject({ category: 'routine', text: 'I protect Sunday evenings for family.' });
    expect(deleteAIMemory(state, 'm1').aiMemory).toEqual([]);
    expect(clearAIMemory(state).aiMemory).toEqual([]);
  });
});

describe('reminders', () => {
  const settings = { ...DEFAULT_REMINDERS, enabled: true, lead: 10, digest: false };
  const state = addEvent(createEmptyState(), { title: 'Call', date: '2026-09-27', startTime: '14:00', endTime: null, category: 'work', note: '', important: false }, 'e1');

  it('fires inside the window once', () => {
    const at = new Date(2026, 8, 27, 13, 50);
    const due = dueReminders(state, at, settings, new Set());
    expect(due).toHaveLength(1);
    expect(dueReminders(state, at, settings, new Set([due[0].key]))).toHaveLength(0);
  });

  it('does not fire too early, too late, or when disabled', () => {
    expect(dueReminders(state, new Date(2026, 8, 27, 13, 40), settings, new Set())).toHaveLength(0);
    expect(dueReminders(state, new Date(2026, 8, 27, 14, 30), settings, new Set())).toHaveLength(0);
    expect(dueReminders(state, new Date(2026, 8, 27, 13, 50), { ...settings, enabled: false }, new Set())).toHaveLength(0);
  });

  it('sends a morning digest', () => {
    const due = dueReminders(state, new Date(2026, 8, 27, 8, 2), { ...settings, digest: true, digestTime: '08:00' }, new Set());
    expect(due.map((item) => item.key)).toContain('2026-09-27|digest');
  });
});

describe('ics', () => {
  it('round-trips events and exports weekly blocks with RRULE', () => {
    let state = addEvent(createEmptyState(), { title: 'Lunch, with Ana; ok', date: '2026-09-28', startTime: '12:00', endTime: '13:00', category: 'social', note: 'line1\nline2', important: false }, 'e');
    state = addFixedCommitment(state, { title: 'Class', weekday: 2, startTime: '08:00', endTime: '09:00', category: 'learning', note: '' }, 'f');
    const ics = toICS(state, new Date(2026, 8, 27));
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU');
    const parsed = parseICS(ics);
    expect(parsed.events[0]).toMatchObject({ title: 'Lunch, with Ana; ok', date: '2026-09-28', startTime: '12:00', endTime: '13:00', note: 'line1\nline2' });
  });

  it('turns all-day events into tasks and handles folded lines', () => {
    const text = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261001', 'SUMMARY:Mum’s birth', ' day', 'END:VEVENT', 'BEGIN:VEVENT', 'SUMMARY:No date', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const parsed = parseICS(text);
    expect(parsed.tasks[0]).toMatchObject({ title: 'Mum’s birthday', dueDate: '2026-10-01' });
    expect(parsed.skipped).toBe(1);
  });

  it('exports repeating events and a busy calendar without titles', () => {
    const state = addEvent(createEmptyState(), {
      title: 'Secret 1:1',
      date: '2026-09-28',
      startTime: '10:00',
      endTime: '10:30',
      category: 'work',
      note: 'private',
      important: true,
      repeat: 'weekly',
    }, 'e');
    const ics = toICS(state, new Date(2026, 8, 27));
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    const busy = toBusyICS(state, new Date(2026, 8, 27));
    expect(busy).toContain('SUMMARY:Busy');
    expect(busy).not.toContain('Secret');
    expect(busy).not.toContain('private');
  });
});

describe('week start', () => {
  afterEach(() => setWeekStart(1));
  it('supports Sunday-first weeks', () => {
    setWeekStart(0);
    expect(startOfWeek('2026-09-27')).toBe('2026-09-27');
    expect(weekdayHeaders()[0]).toBe('Sun');
    expect(monthGrid(2026, 9)[0]).toBe('2026-08-30');
  });
});

describe('insights', () => {
  it('summarises focus and productive hours', () => {
    let state = createEmptyState();
    for (let i = 0; i < 3; i += 1) state = logFocus(state, { taskId: null, title: 'Write', minutes: 25 }, `f${i}`, new Date(2026, 8, 27, 10, i).toISOString(), '2026-09-27');
    const summary = focusSummary(state, '2026-09-27');
    expect(summary.totalMinutes).toBe(75);
    expect(summary.topTasks[0]).toEqual({ title: 'Write', minutes: 75 });
    expect(productiveHours(state).bestHour).toBe(10);
  });

  it('finds habit links and writes a weekly report', () => {
    let state = addHabit(createEmptyState(), { name: 'Run', icon: 'walk', accent: 'sage', frequency: { type: 'daily' } }, 'h', 'now', '2026-08-01');
    for (let d = 1; d <= 20; d += 1) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      const run = d % 2 === 0;
      if (run) state = toggleHabit(state, 'h', date);
      const count = run ? 3 : 1;
      for (let k = 0; k < count; k += 1) {
        const id = `t${d}-${k}`;
        state = addTask(state, { ...baseTask, title: id, dueDate: date }, id);
        state = toggleTask(state, id, new Date(`${date}T12:00:00`).toISOString(), date);
      }
    }
    const links = habitLinks(state, '2026-09-21');
    expect(links[0]).toMatchObject({ name: 'Run' });
    expect(links[0].lift).toBeGreaterThan(1);
    expect(weeklyReport(state, '2026-09-20')).toContain('## Habits');
  });
});

describe('scheduler & resize', () => {
  it('fits untimed tasks around events', () => {
    let state = addEvent(createEmptyState(), { title: 'Meeting', date: '2026-09-28', startTime: '09:00', endTime: '10:00', category: 'work', note: '', important: false });
    state = addTask(state, { ...baseTask, title: 'A', priority: 'low' }, 'a');
    state = addTask(state, { ...baseTask, title: 'B', priority: 'high' }, 'b');
    state = addTask(state, { ...baseTask, title: 'Old', dueDate: '2026-09-20' }, 'old');
    const plan = autoSchedule(state, '2026-09-28', { from: 8 * 60 + 30 });
    expect(plan.map((item) => [item.title, item.time])).toEqual([['B', '10:10'], ['A', '10:50'], ['Old', '11:30']]);
  });

  it('resizes only to valid end times', () => {
    let state = addEvent(createEmptyState(), { title: 'Gym', date: '2026-09-28', startTime: '09:00', endTime: '10:00', category: 'health', note: '', important: false }, 'e');
    state = resizeEvent(state, 'e', '10:45');
    expect(state.events[0].endTime).toBe('10:45');
    expect(resizeEvent(state, 'e', '08:00')).toBe(state);
  });
});

describe('notes', () => {
  it('extracts tags and toggles pins', () => {
    expect(extractTags('Ideas #work and #Home, not a#tag')).toEqual(['work', 'home']);
    let state = addNote(createEmptyState(), { title: 'T', body: 'b', kind: 'quick', date: null }, 'n');
    state = updateNote(state, 'n', { pinned: true });
    expect(state.notes[0].pinned).toBe(true);
    state = updateNote(state, 'n', { title: 'Renamed' });
    expect(state.notes[0].pinned).toBe(true);
  });
});

describe('display preferences', () => {
  afterEach(() => setDisplayPrefs({ dateLanguage: 'en-GB', timeFormat: '24h' }));
  it('formats 12-hour times and localised dates', () => {
    expect(displayTime('14:05')).toBe('14:05');
    setDisplayPrefs({ dateLanguage: 'fi', timeFormat: '12h' });
    expect(displayTime('14:05')).toBe('2:05 pm');
    expect(displayTime('00:00')).toBe('12 am');
    expect(displayTime('12:30')).toBe('12:30 pm');
    expect(formatMonthLong('2026-09-27').toLowerCase()).toContain('syys');
    setDisplayPrefs({ dateLanguage: 'en-GB', timeFormat: '24h' });
    expect(weekdayHeaders()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});
