import { describe, expect, it } from 'vitest';
import { monthGrid, startOfWeek, addDays, isValidISODate, weekDates } from './dates';
import { agendaWindow, dayLoad, dayScore, essentialHabits, eventsForDate, fixedEventsForDate, goalProgress, habitStats, habitStreaks, hasAgendaPlans, insightTotals, isDueOn, isPlannedDay, laterAgenda, loadLevel, overdueTasks, quietestDay, weekLeftovers } from './logic';
import { addEvent, addFixedCommitment, addGoal, addHabit, addHabits, addMilestone, addNote, addTask, carryWeekLeftovers, clearCompletedTasks, copyWeek, duplicateTask, moveTask, swapEventTimes, toggleHabit, toggleMilestone, toggleTask, updateEvent } from './mutate';
import { occursOn } from './recurrence';
import { parseQuickAdd } from './quickAdd';
import { parseHash, toHash } from './route';
import { loadFrom, parseBackup, sanitizeState, saveTo, serialize } from './storage';
import { ESSENTIAL_PRESETS, presetToInput } from './presets';
import { createEmptyState, type PlannerState } from './types';

function memoryStorage(initial?: Record<string, string>): Storage {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('dates', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeek('2026-09-27')).toBe('2026-09-21');
    expect(startOfWeek('2026-09-21')).toBe('2026-09-21');
  });

  it('crosses month boundaries by calendar date', () => {
    expect(addDays('2026-09-30', 2)).toBe('2026-10-02');
  });

  it('builds a Monday-first September 2026 grid', () => {
    const cells = monthGrid(2026, 9);
    expect(cells[0]).toBe('2026-08-31');
    expect(cells).toContain('2026-09-01');
    expect(cells).toContain('2026-09-27');
    expect(cells.length === 35 || cells.length === 42).toBe(true);
  });

  it('rejects impossible dates', () => {
    expect(isValidISODate('2026-02-31')).toBe(false);
    expect(isValidISODate('2026-09-27')).toBe(true);
  });
});

describe('routing', () => {
  const now = new Date(2026, 8, 27);

  it('round-trips known routes and falls back safely', () => {
    const day = { name: 'day' as const, date: '2026-09-27' };
    expect(parseHash(toHash(day))).toEqual(day);
    const calendar = { name: 'calendar' as const, tab: 'week' as const, date: '2026-09-27' };
    expect(parseHash(toHash(calendar))).toEqual(calendar);
    expect(parseHash(toHash({ name: 'insights' }))).toEqual({ name: 'insights' });
    expect(parseHash(toHash({ name: 'ai', tab: 'review' }))).toEqual({ name: 'ai', tab: 'review' });
    expect(parseHash('#/ai', now)).toEqual({ name: 'ai', tab: 'plan' });
    expect(parseHash('#/nope', now)).toEqual({ name: 'today' });
    expect(parseHash('#/day/2026-02-31', now)).toEqual({ name: 'today' });
  });

  it('keeps legacy routes working', () => {
    expect(parseHash('#/daily/2026-09-24', now)).toEqual({ name: 'day', date: '2026-09-24' });
    expect(parseHash('#/weekly/2026-09-24', now)).toEqual({ name: 'calendar', tab: 'week', date: '2026-09-24' });
    expect(parseHash('#/month/2026/9', now)).toEqual({ name: 'calendar', tab: 'month', date: '2026-09-01' });
    expect(parseHash('#/monthly/2026/10', now)).toEqual({ name: 'calendar', tab: 'month', date: '2026-10-01' });
    expect(parseHash('#/future', now)).toEqual({ name: 'calendar', tab: 'agenda', date: '2026-09-27' });
    expect(parseHash('#/progress', now)).toEqual({ name: 'insights' });
  });
});

describe('quick add', () => {
  const today = '2026-09-27'; // a Sunday

  it('parses a plain title into a task for the default day', () => {
    const parse = parseQuickAdd('Buy oat milk', today);
    expect(parse?.kind).toBe('task');
    expect(parse?.title).toBe('Buy oat milk');
    expect(parse?.date).toBe(today);
    expect(parse?.priority).toBeNull();
  });

  it('understands tomorrow, times, categories, and priorities', () => {
    expect(parseQuickAdd('زنگ به مامان فردا ۱۷:۰۰ #کار فوری', today)).toMatchObject({
      title: 'زنگ به مامان',
      date: '2026-09-28',
      startTime: '17:00',
      category: 'work',
      priority: 'high',
    });
    const parse = parseQuickAdd('Call mom tomorrow 5pm #personal !high', today);
    expect(parse?.kind).toBe('task');
    expect(parse?.title).toBe('Call mom');
    expect(parse?.date).toBe('2026-09-28');
    expect(parse?.startTime).toBe('17:00');
    expect(parse?.category).toBe('personal');
    expect(parse?.priority).toBe('high');
  });

  it('turns a time range into an event', () => {
    const parse = parseQuickAdd('Deep work 9:30-11:30 #work', today);
    expect(parse?.kind).toBe('event');
    expect(parse?.title).toBe('Deep work');
    expect(parse?.startTime).toBe('09:30');
    expect(parse?.endTime).toBe('11:30');
    expect(parse?.date).toBe(today);
  });

  it('handles spoken ranges and weekdays', () => {
    const parse = parseQuickAdd('Dentist tuesday 2 to 4pm', today);
    expect(parse?.kind).toBe('event');
    expect(parse?.date).toBe('2026-09-29');
    expect(parse?.startTime).toBe('14:00');
    expect(parse?.endTime).toBe('16:00');
  });

  it('reads relative dates and next weekdays', () => {
    expect(parseQuickAdd('Ship the thing in 3 days', today)?.date).toBe('2026-09-30');
    expect(parseQuickAdd('Standup next monday 9am', today)?.date).toBe('2026-10-05');
    expect(parseQuickAdd('Review notes next week', today)?.date).toBe('2026-10-04');
  });

  it('does not mistake titles like 9-1-1 for times', () => {
    const parse = parseQuickAdd('Watch 9-1-1 tonight', today);
    expect(parse?.kind).toBe('task');
    expect(parse?.title).toBe('Watch 9-1-1 tonight');
    expect(parse?.startTime).toBeNull();
  });

  it('keeps unknown hashtags in the title', () => {
    const parse = parseQuickAdd('Try #noscope mode', today);
    expect(parse?.title).toBe('Try #noscope mode');
  });
});

describe('planner logic', () => {
  const now = '2026-09-27T10:00:00.000Z';

  function withHabit(): PlannerState {
    return addHabit(
      createEmptyState(),
      { name: 'Read', icon: 'book', accent: 'sage', frequency: { type: 'weekdays' } },
      'h1',
      now,
      '2026-09-01',
    );
  }

  it('schedules weekday habits and scores the day', () => {
    let state = withHabit();
    expect(isPlannedDay(state.habits[0], '2026-09-25')).toBe(true);
    expect(isPlannedDay(state.habits[0], '2026-09-26')).toBe(false);
    state = addTask(state, {
      title: 'Draft',
      priority: 'high',
      dueDate: '2026-09-25',
      dueTime: '09:00',
      category: 'work',
      note: '',
      goalId: null,
    }, 't1', now);
    state = toggleTask(state, 't1', now);
    state = toggleHabit(state, 'h1', '2026-09-25');
    const score = dayScore(state, '2026-09-25', true);
    expect(score.tasksDone).toBe(1);
    expect(score.habitsDone).toBe(1);
    expect(score.ratio).toBe(1);
  });

  it('keeps a weekly target from looking like a daily miss', () => {
    let state = addHabit(
      createEmptyState(),
      { name: 'Workout', icon: 'stretch', accent: 'sage', frequency: { type: 'weekly', times: 3 } },
      'h1',
      now,
      '2026-09-01',
    );
    expect(isDueOn(state, state.habits[0], '2026-09-21')).toBe(true);
    state = toggleHabit(state, 'h1', '2026-09-21');
    state = toggleHabit(state, 'h1', '2026-09-22');
    state = toggleHabit(state, 'h1', '2026-09-23');
    expect(isDueOn(state, state.habits[0], '2026-09-24')).toBe(false);
    expect(isDueOn(state, state.habits[0], '2026-09-23')).toBe(true);
    const stats = habitStats(state, state.habits[0], weekDates('2026-09-23'), '2026-09-27');
    expect(stats.done).toBe(3);
    expect(stats.expected).toBe(3);
    expect(stats.ratio).toBe(1);
  });

  it('updates goal progress from milestones and linked tasks', () => {
    let state = addGoal(
      createEmptyState(),
      { title: 'Learn German', description: '', horizon: 'long', deadline: '2026-12-01', milestone: 'Chapter 1' },
      'g1',
      'm1',
      now,
    );
    state = addMilestone(state, 'g1', 'Chapter 2', 'm2', now);
    state = toggleMilestone(state, 'g1', 'm1', now);
    state = addTask(state, {
      title: 'Vocabulary',
      priority: 'medium',
      dueDate: '2026-09-27',
      dueTime: null,
      category: 'learning',
      note: '',
      goalId: 'g1',
    }, 't1', now);
    expect(goalProgress(state.goals[0], state.tasks)).toEqual({ done: 1, total: 3, ratio: 1 / 3 });
  });

  it('swaps event times without swapping dates', () => {
    let state = addEvent(createEmptyState(), {
      title: 'Breakfast',
      date: '2026-09-27',
      startTime: '08:00',
      endTime: '08:30',
      category: 'personal',
      note: '',
      important: false,
    }, 'a', now);
    state = addEvent(state, {
      title: 'Study',
      date: '2026-09-27',
      startTime: '09:00',
      endTime: null,
      category: 'learning',
      note: '',
      important: false,
    }, 'b', now);
    state = swapEventTimes(state, 'a', 'b', now);
    const breakfast = state.events.find((event) => event.id === 'a');
    const study = state.events.find((event) => event.id === 'b');
    expect(breakfast?.startTime).toBe('09:00');
    expect(study?.startTime).toBe('08:00');
    expect(study?.endTime).toBe('08:30');
    expect(breakfast?.date).toBe('2026-09-27');
  });

  it('keeps an event’s length when the start time moves past the end', () => {
    let state = addEvent(createEmptyState(), {
      title: 'Walk',
      date: '2026-09-27',
      startTime: '08:00',
      endTime: '09:00',
      category: 'health',
      note: '',
      important: false,
    }, 'e1', now);
    state = updateEvent(state, 'e1', { startTime: '18:00' }, now);
    expect(state.events[0].startTime).toBe('18:00');
    expect(state.events[0].endTime).toBe('19:00');
    state = updateEvent(state, 'e1', { startTime: '23:30' }, now);
    expect(state.events[0].endTime).toBeNull();
  });

  it('moves a carried task onto a future day without dropping its time', () => {
    let state = addTask(createEmptyState(), {
      title: 'Call',
      priority: 'medium',
      dueDate: '2026-09-25',
      dueTime: '15:00',
      category: 'personal',
      note: '',
      goalId: null,
    }, 't1', now);
    state = moveTask(state, 't1', '2026-09-28', now);
    expect(state.tasks[0].dueDate).toBe('2026-09-28');
    expect(state.tasks[0].dueTime).toBe('15:00');
  });

  it('builds a future window that starts tomorrow and ignores habit-only days', () => {
    let state = addHabit(createEmptyState(), {
      name: 'Read',
      icon: 'book',
      accent: 'sage',
      frequency: { type: 'daily' },
    }, 'h1', now, '2026-09-01');
    state = addEvent(state, {
      title: 'Dentist',
      date: '2026-09-29',
      startTime: '11:00',
      endTime: null,
      category: 'health',
      note: '',
      important: true,
    }, 'e1', now);
    const days = agendaWindow(state, '2026-09-27', 7);
    expect(days[0].date).toBe('2026-09-28');
    expect(days).toHaveLength(7);
    expect(hasAgendaPlans(days[0])).toBe(false);
    expect(days[0].habits).toHaveLength(1);
    expect(hasAgendaPlans(days[1])).toBe(true);
    expect(laterAgenda(state, '2026-09-27', 1).events).toHaveLength(1);
    expect(laterAgenda(state, '2026-09-27', 7).events).toHaveLength(0);
    expect(dayLoad(days[1])).toBeGreaterThan(0);
    expect(loadLevel(0)).toBe('quiet');
    expect(loadLevel(2)).toBe('steady');
    expect(loadLevel(5)).toBe('full');
    expect(quietestDay(days)?.date).toBe('2026-09-28');
    expect(agendaWindow(state, '2026-09-27', 90)).toHaveLength(90);
  });
});

describe('streaks and totals', () => {
  const now = '2026-09-27T10:00:00.000Z';
  const today = '2026-09-27';

  it('counts habit streaks and survives an unfinished today', () => {
    let state = addHabit(
      createEmptyState(),
      { name: 'Read', icon: 'book', accent: 'sage', frequency: { type: 'daily' } },
      'h1',
      now,
      '2026-09-20',
    );
    state = toggleHabit(state, 'h1', '2026-09-24');
    state = toggleHabit(state, 'h1', '2026-09-25');
    state = toggleHabit(state, 'h1', '2026-09-26');
    expect(habitStreaks(state, state.habits[0], today)).toEqual({ current: 3, best: 3 });
    state = toggleHabit(state, 'h1', today);
    expect(habitStreaks(state, state.habits[0], today)).toEqual({ current: 4, best: 4 });
  });

  it('counts weekly-target streaks in weeks', () => {
    let state = addHabit(
      createEmptyState(),
      { name: 'Gym', icon: 'stretch', accent: 'sage', frequency: { type: 'weekly', times: 2 } },
      'h1',
      now,
      '2026-09-07',
    );
    state = toggleHabit(state, 'h1', '2026-09-14');
    state = toggleHabit(state, 'h1', '2026-09-16');
    state = toggleHabit(state, 'h1', '2026-09-21');
    state = toggleHabit(state, 'h1', '2026-09-23');
    expect(habitStreaks(state, state.habits[0], today)).toEqual({ current: 2, best: 2 });
  });

  it('clears completed tasks in one step', () => {
    let state = addTask(createEmptyState(), {
      title: 'Done thing',
      priority: 'low',
      dueDate: null,
      dueTime: null,
      category: 'personal',
      note: '',
      goalId: null,
    }, 't1', now);
    state = toggleTask(state, 't1', now);
    state = addTask(state, {
      title: 'Open thing',
      priority: 'low',
      dueDate: null,
      dueTime: null,
      category: 'personal',
      note: '',
      goalId: null,
    }, 't2', now);
    state = clearCompletedTasks(state);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].title).toBe('Open thing');
  });

  it('duplicates a task with a fresh id and unchecked steps', () => {
    let state = addTask(createEmptyState(), {
      title: 'Pack',
      priority: 'high',
      dueDate: '2026-09-27',
      dueTime: '08:00',
      category: 'home',
      note: 'bags',
      goalId: null,
      subtasks: [{ id: 's1', title: 'Shoes', completed: true }],
    }, 't1', now);
    state = duplicateTask(state, 't1', now, 't2');
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks[1]).toMatchObject({ id: 't2', title: 'Pack', dueDate: '2026-09-27', note: 'bags' });
    expect(state.tasks[1].subtasks[0]).toMatchObject({ title: 'Shoes', completed: false });
    expect(state.tasks[1].subtasks[0].id).not.toBe('s1');
  });

  it('sums insight totals including the day streak', () => {
    let state = addTask(createEmptyState(), {
      title: 'Draft',
      priority: 'medium',
      dueDate: '2026-09-27',
      dueTime: null,
      category: 'work',
      note: '',
      goalId: null,
    }, 't1', now);
    state = toggleTask(state, 't1', now);
    const totals = insightTotals(state, today);
    expect(totals.tasksCompleted).toBe(1);
    expect(totals.tasksOpen).toBe(0);
    expect(totals.dayStreak).toBe(1);
  });
});

describe('protected weekly times', () => {
  const now = '2026-09-27T10:00:00.000Z';
  const classInput = { title: 'Class', weekday: 2, startTime: '08:00', endTime: '09:30', category: 'learning', note: '' };

  it('repeats on the matching weekday and does not distort completion scores', () => {
    let state = addFixedCommitment(createEmptyState(), classInput, 'class-tuesday', now);
    expect(fixedEventsForDate(state, '2026-09-29')).toHaveLength(1);
    expect(eventsForDate(state, '2026-09-29')[0]).toMatchObject({ title: 'Class', startTime: '08:00', fixedCommitmentId: 'class-tuesday' });
    expect(eventsForDate(state, '2026-09-30')).toHaveLength(0);
    expect(dayScore(state, '2026-09-29').total).toBe(0);

    state = addEvent(state, { title: 'Study', date: '2026-09-29', startTime: '10:00', endTime: '11:00', category: 'learning', note: '', important: false }, 'study', now);
    expect(dayScore(state, '2026-09-29')).toMatchObject({ eventsTotal: 1, total: 1 });
  });

  it('rejects an invalid recurring interval', () => {
    const state = createEmptyState();
    expect(addFixedCommitment(state, { ...classInput, endTime: '08:00' }, 'bad', now)).toBe(state);
    expect(addFixedCommitment(state, { ...classInput, weekday: 8 }, 'bad-day', now)).toBe(state);
  });
});

describe('habit library and daily essentials', () => {
  const now = '2026-09-27T10:00:00.000Z';
  const today = '2026-09-27';

  it('ships essentials as opt-in daily suggestions, never must-dos', () => {
    expect(ESSENTIAL_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of ESSENTIAL_PRESETS) {
      expect(preset.frequency.type).toBe('daily');
      expect(preset.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('adds habits in bulk unflagged, and keeps an explicit essential flag', () => {
    let state = addHabits(createEmptyState(), ESSENTIAL_PRESETS.map(presetToInput), now, today);
    expect(state.habits).toHaveLength(ESSENTIAL_PRESETS.length);
    expect(state.habits.every((habit) => !habit.essential)).toBe(true);
    state = addHabit(
      state,
      { name: 'Journal one line', icon: 'pencil', accent: 'pink', frequency: { type: 'daily' }, essential: true },
      'h-extra',
      now,
      today,
    );
    expect(state.habits[state.habits.length - 1].essential).toBe(true);
    const restored = sanitizeState(JSON.parse(JSON.stringify(state)) as unknown);
    expect(restored?.habits.filter((habit) => habit.essential)).toHaveLength(1);
  });

  it('lists only explicitly essential habits due on a day', () => {
    let state = addHabits(createEmptyState(), ESSENTIAL_PRESETS.map(presetToInput), now, today);
    expect(essentialHabits(state, today)).toHaveLength(0);
    state = addHabit(
      state,
      { name: 'Water the plants', icon: 'water', accent: 'blue', frequency: { type: 'daily' }, essential: true },
      'h-must',
      now,
      today,
    );
    expect(essentialHabits(state, today).map((habit) => habit.id)).toEqual(['h-must']);
  });
});

describe('storage', () => {
  it('drops corrupt rows and keeps valid ones', () => {
    const state = sanitizeState({
      tasks: [{ id: 'ok', title: 'Call', completed: false }, { title: 'missing id' }, 'nope'],
      events: [{ id: 'e', title: 'Lunch', date: '2026-09-27', startTime: '13:00' }],
      habits: [],
    });
    expect(state?.tasks).toHaveLength(1);
    expect(state?.tasks[0].title).toBe('Call');
    expect(state?.events).toHaveLength(1);
    expect(state?.fixedCommitments).toEqual([]);
  });

  it('round-trips through storage and rejects unreadable backups', () => {
    const storage = memoryStorage();
    let state = addNote(createEmptyState(), {
      title: 'Idea',
      body: 'A quieter morning.',
      kind: 'idea',
      date: '2026-09-27',
    }, 'n1', '2026-09-27T10:00:00.000Z');
    state = addFixedCommitment(state, {
      title: 'Class', weekday: 2, startTime: '08:00', endTime: '09:00', category: 'learning', note: '',
    }, 'class-tuesday', '2026-09-27T10:00:00.000Z');
    expect(saveTo(storage, state)).toBeNull();
    expect(loadFrom(storage).state.notes[0].title).toBe('Idea');
    expect(loadFrom(storage).state.fixedCommitments[0].title).toBe('Class');
    expect(parseBackup(serialize(state)).ok).toBe(true);
    expect(parseBackup('{')).toEqual({ ok: false, error: 'That file could not be read.' });
    expect(parseBackup('[]')).toEqual({ ok: false, error: 'That file is not a planner backup.' });
  });

  it('does not overwrite storage when saved data is unreadable', () => {
    const storage = memoryStorage({ 'personal-planner.v1': 'not-json' });
    const loaded = loadFrom(storage);
    expect(loaded.persist).toBe(false);
    expect(loaded.error).toBeTruthy();
    expect(storage.getItem('personal-planner.v1')).toBe('not-json');
  });

  it('reports a full browser storage', () => {
    const storage = {
      setItem: () => {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      },
    };
    expect(saveTo(storage, createEmptyState())).toMatch(/full/i);
  });
});

describe('futures', () => {
  const now = '2026-09-27T10:00:00.000Z';

  it('expands repeating events onto matching days', () => {
    expect(occursOn('2026-09-22', 'weekly', '2026-09-29')).toBe(true);
    expect(occursOn('2026-09-22', 'weekly', '2026-09-28')).toBe(false);
    const state = addEvent(createEmptyState(), {
      title: 'Class',
      date: '2026-09-22',
      startTime: '08:00',
      endTime: '09:00',
      category: 'learning',
      note: '',
      important: false,
      repeat: 'weekly',
    }, 'e1', now);
    const next = eventsForDate(state, '2026-09-29').find((event) => event.seriesEventId === 'e1');
    expect(next?.title).toBe('Class');
    expect(next?.startTime).toBe('08:00');
  });

  it('keeps waiting tasks off the overdue list', () => {
    let state = addTask(createEmptyState(), {
      title: 'Wait',
      priority: 'high',
      dueDate: '2026-09-20',
      dueTime: null,
      category: 'personal',
      note: '',
      goalId: null,
      waiting: 'the lab',
    }, 't1', now);
    expect(overdueTasks(state, '2026-09-27')).toHaveLength(0);
    state = addTask(state, {
      title: 'Late',
      priority: 'low',
      dueDate: '2026-09-20',
      dueTime: null,
      category: 'personal',
      note: '',
      goalId: null,
    }, 't2', now);
    expect(overdueTasks(state, '2026-09-27').map((task) => task.id)).toEqual(['t2']);
  });

  it('copies a week and carries leftovers', () => {
    let state = addEvent(createEmptyState(), {
      title: 'Standup',
      date: '2026-09-22',
      startTime: '09:00',
      endTime: '09:15',
      category: 'work',
      note: '',
      important: false,
    }, 'e1', now);
    state = addTask(state, {
      title: 'Ship',
      priority: 'high',
      dueDate: '2026-09-22',
      dueTime: null,
      category: 'work',
      note: '',
      goalId: null,
      estimatedMinutes: 90,
    }, 't1', now);
    const copied = copyWeek(state, '2026-09-22', now);
    expect(copied.tasks.find((task) => task.title === 'Ship')?.estimatedMinutes).toBe(90);
    expect(copied.events.some((event) => event.date === '2026-09-29' && event.title === 'Standup')).toBe(true);
    expect(copied.tasks.some((task) => task.dueDate === '2026-09-29' && task.title === 'Ship')).toBe(true);
    expect(weekLeftovers(state, '2026-09-27').map((task) => task.id)).toEqual(['t1']);
    const carried = carryWeekLeftovers(state, '2026-09-27', now);
    expect(carried.tasks[0].dueDate).toBe('2026-09-29');
  });

  it('places a milestone on the agenda', () => {
    const state = addGoal(createEmptyState(), {
      title: 'Ship',
      description: '',
      horizon: 'short',
      deadline: null,
      milestone: 'Draft',
      milestoneDue: '2026-10-01',
    }, 'g1', 'm1', now);
    expect(state.goals[0].milestones[0].dueDate).toBe('2026-10-01');
    const days = agendaWindow(state, '2026-09-27', 7);
    expect(days.find((day) => day.date === '2026-10-01')?.deadlines[0].title).toContain('Draft');
  });
});
