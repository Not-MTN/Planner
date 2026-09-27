import { describe, expect, it } from 'vitest';
import {
  addEvent,
  addHabit,
  addNote,
  addTask,
  completeTasks,
  deleteTasks,
  moveTasks,
  setHabitValue,
  skipHabit,
  toggleHabit,
  toggleTask,
  updateTasks,
} from './mutate';
import {
  dayScore,
  extractLinks,
  habitDot,
  habitStreaks,
  isDone,
  isSkipped,
  journalForDate,
  noteBacklinks,
  planVsFocus,
  yearPixels,
} from './logic';
import { parseQuickAdd, formatEstimate } from './quickAdd';
import { addTemplate, loadTemplates, removeTemplate, saveTemplates, seedTemplates } from './templates';
import { parseTaskCSV, parseCsvRows } from './importers';
import { mergeFeedEvents } from './feeds';
import { applySharedToState, sharedItems, syncSharedOnce, tombstoneKey, EMPTY_SHARED, SHARED_CATEGORY } from './shared';
import { autoSchedule } from './scheduler';
import { parseBackup, sanitizeState, serialize } from './storage';
import { createEmptyState, type HabitInput, type PlannerState, type TaskInput } from './types';

const task: TaskInput = { title: 'Write report', priority: 'medium', dueDate: null, dueTime: null, category: 'work', note: '', goalId: null };
const habit: HabitInput = { name: 'Drink water', icon: 'water', accent: 'sage', frequency: { type: 'daily' } };

function withTask(state: PlannerState, input: Partial<TaskInput> = {}, id = 't1'): PlannerState {
  return addTask(state, { ...task, ...input }, id, '2026-09-01T09:00:00.000Z');
}

describe('bulk task actions', () => {
  it('completes, moves, updates and deletes many tasks in one step', () => {
    let state = withTask(createEmptyState(), {}, 'a');
    state = withTask(state, { title: 'B' }, 'b');
    state = withTask(state, { title: 'C' }, 'c');

    state = completeTasks(state, ['a', 'b'], true, 'now', '2026-09-28');
    expect(state.tasks.filter((item) => item.completed)).toHaveLength(2);
    state = completeTasks(state, ['a'], false, 'later', '2026-09-28');
    expect(state.tasks.find((item) => item.id === 'a')?.completed).toBe(false);

    state = updateTasks(state, ['a', 'c'], { priority: 'high', category: 'home' }, 'now2');
    expect(state.tasks.filter((item) => item.priority === 'high')).toHaveLength(2);
    expect(state.tasks.filter((item) => item.category === 'home')).toHaveLength(2);

    state = moveTasks(state, ['a', 'c'], '2026-09-30', 'now3');
    expect(state.tasks.find((item) => item.id === 'a')?.dueDate).toBe('2026-09-30');
    expect(state.tasks.find((item) => item.id === 'c')?.dueDate).toBe('2026-09-30');

    state = deleteTasks(state, ['a', 'b']);
    expect(state.tasks.map((item) => item.id)).toEqual(['c']);
  });

  it('bulk completion honours repeat rules like a single toggle', () => {
    let state = withTask(createEmptyState(), { repeat: 'daily', dueDate: '2026-09-28' }, 'r1');
    state = completeTasks(state, ['r1'], true, 'now', '2026-09-28');
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks.filter((item) => item.repeat === 'daily' && !item.completed)).toHaveLength(1);
  });
});

describe('time estimates', () => {
  it('stores and sanitizes estimates', () => {
    let state = withTask(createEmptyState(), { estimatedMinutes: 45 });
    expect(state.tasks[0].estimatedMinutes).toBe(45);
    const roundTrip = sanitizeState(JSON.parse(serialize(state)));
    expect(roundTrip?.tasks[0].estimatedMinutes).toBe(45);
    state = updateTasks(state, ['t1'], { estimatedMinutes: 99999 });
    expect(state.tasks[0].estimatedMinutes).toBeNull();
  });

  it('quick add parses ~45m, ~1h30m, ~2h', () => {
    expect(parseQuickAdd('Write report ~45m', null)?.estimatedMinutes).toBe(45);
    expect(parseQuickAdd('Plan workshop ~1h30m', null)?.estimatedMinutes).toBe(90);
    expect(parseQuickAdd('Deep work ~2h', null)?.estimatedMinutes).toBe(120);
    expect(parseQuickAdd('Call mom', null)?.estimatedMinutes).toBeNull();
    const parse = parseQuickAdd('Paint fence ~25m tomorrow', null);
    expect(parse?.title).toBe('Paint fence');
    expect(parse?.chips.some((chip) => chip.includes('25'))).toBe(true);
  });

  it('formatEstimate renders hours', () => {
    expect(formatEstimate(45)).toBe('45 min');
    expect(formatEstimate(60)).toBe('1 h');
    expect(formatEstimate(90)).toBe('1 h 30 min');
  });

  it('autoSchedule fits tasks by their own estimates', () => {
    let state = withTask(createEmptyState(), { title: 'Long one', estimatedMinutes: 120, dueDate: '2026-09-28' }, 'long');
    state = withTask(state, { title: 'Short one', estimatedMinutes: 15, dueDate: '2026-09-28' }, 'short');
    const plan = autoSchedule(state, '2026-09-28', { from: 9 * 60 });
    const longPlan = plan.find((item) => item.id === 'long');
    const shortPlan = plan.find((item) => item.id === 'short');
    expect(longPlan && shortPlan).toBeTruthy();
    // The 15-minute task starts after the 120-minute block plus buffer.
    const end = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    expect(end(shortPlan!.time)).toBeGreaterThanOrEqual(end(longPlan!.time) + 120);
  });

  it('planVsFocus compares planned estimates with logged focus', () => {
    let state = withTask(createEmptyState(), { dueDate: '2026-09-28', estimatedMinutes: 60 });
    state = { ...state, focusLog: [{ id: 'f1', taskId: 't1', title: 'Write report', minutes: 30, date: '2026-09-28', endedAt: '2026-09-28T10:00:00.000Z' }] };
    const rows = planVsFocus(state, '2026-09-28', 1);
    expect(rows).toEqual([{ date: '2026-09-28', planned: 60, focused: 30 }]);
  });
});

describe('habit units and rest days', () => {
  function waterState(): PlannerState {
    return addHabit(createEmptyState(), { ...habit, unit: { label: 'glasses', target: 8 } }, 'h1', '2026-09-01T09:00:00.000Z', '2026-09-01');
  }

  it('toggle fills the target; setHabitValue tracks partial amounts', () => {
    let state = waterState();
    state = toggleHabit(state, 'h1', '2026-09-28');
    expect(state.completions[0]).toEqual({ habitId: 'h1', date: '2026-09-28', value: 8 });
    expect(isDone(state, 'h1', '2026-09-28')).toBe(true);

    state = setHabitValue(state, 'h1', '2026-09-29', 3);
    expect(isDone(state, 'h1', '2026-09-29')).toBe(false);
    state = setHabitValue(state, 'h1', '2026-09-29', 8);
    expect(isDone(state, 'h1', '2026-09-29')).toBe(true);
    state = setHabitValue(state, 'h1', '2026-09-29', 0);
    expect(isDone(state, 'h1', '2026-09-29')).toBe(false);

    const saved = sanitizeState(JSON.parse(serialize(state)));
    expect(saved?.completions.find((item) => item.date === '2026-09-28')?.value).toBe(8);
  });

  it('a binary habit toggle stays value-less', () => {
    const state = toggleHabit(addHabit(createEmptyState(), habit, 'h2'), 'h2', '2026-09-28');
    expect(state.completions[0]).toEqual({ habitId: 'h2', date: '2026-09-28' });
  });

  it('rest days are neutral for streaks, dots and the day score', () => {
    let state = addHabit(createEmptyState(), habit, 'h1', '2026-09-01T09:00:00.000Z', '2026-09-01');
    for (const date of ['2026-09-25', '2026-09-26', '2026-09-27']) state = toggleHabit(state, 'h1', date);
    state = skipHabit(state, 'h1', '2026-09-28');
    expect(isSkipped(state, 'h1', '2026-09-28')).toBe(true);
    expect(habitDot(state, state.habits[0], '2026-09-28', '2026-09-28')).toBe('skipped');
    // Streak intact through the skipped day, still counted for 9-25..27.
    expect(habitStreaks(state, state.habits[0], '2026-09-28').current).toBe(3);
    // The skipped habit is not part of the day's totals.
    expect(dayScore(state, '2026-09-28').habitsTotal).toBe(0);
    // Toggling off again restores a normal open dot and the day total.
    state = skipHabit(state, 'h1', '2026-09-28');
    expect(isSkipped(state, 'h1', '2026-09-28')).toBe(false);
    expect(dayScore(state, '2026-09-28').habitsTotal).toBe(1);
  });
});

describe('note links & journal', () => {
  it('extracts [[links]] and finds backlinks', () => {
    let state = createEmptyState();
    state = addNote(state, { title: 'Trip plan', body: 'See [[Packing list]] and [[Budget|the budget]]', kind: 'quick', date: null }, 'n1');
    state = addNote(state, { title: 'Packing list', body: '- tent', kind: 'quick', date: null }, 'n2');
    const trip = state.notes.find((note) => note.id === 'n1')!;
    const packing = state.notes.find((note) => note.id === 'n2')!;
    expect(extractLinks(trip.body)).toEqual(['Packing list', 'Budget']);
    const links = noteBacklinks(state.notes, packing);
    expect(links.map((note) => note.id)).toEqual(['n1']);
  });

  it('journalForDate finds the dated journal note', () => {
    let state = createEmptyState();
    state = addNote(state, { title: 'Mon', body: '', kind: 'journal', date: '2026-09-28' }, 'j1');
    expect(journalForDate(state.notes, '2026-09-28')?.id).toBe('j1');
    expect(journalForDate(state.notes, '2026-09-29')).toBeUndefined();
  });
});

describe('templates', () => {
  it('seeds, adds and removes templates', () => {
    const seeded = seedTemplates('now');
    expect(seeded.length).toBeGreaterThanOrEqual(4);
    const added = addTemplate(seeded, {
      title: 'Invoice client',
      type: 'task',
      body: 'Attach time log',
      subtasks: ['Draft', 'Send'],
      priority: 'high',
      category: 'work',
      kind: 'quick',
    }, 'tpl-x', 'now2');
    expect(added[0].id).toBe('tpl-x');
    expect(added[0].subtasks).toEqual(['Draft', 'Send']);
    expect(removeTemplate(added, 'tpl-x')).toHaveLength(seeded.length);
  });

  it.runIf(typeof localStorage !== 'undefined')('persists to localStorage and reloads clean', () => {
    localStorage.clear();
    const seeded = loadTemplates();
    expect(seeded.length).toBeGreaterThanOrEqual(4); // seeded on first use
    expect(loadTemplates().length).toBe(seeded.length); // stable across loads
    saveTemplates([]);
    expect(loadTemplates()).toEqual([]); // explicitly emptied
  });
});

describe('Todoist / TickTick import', () => {
  it('parses CSV with quotes and commas', () => {
    expect(parseCsvRows('a,"b, c",d\n"x""y",z,')).toEqual([
      ['a', 'b, c', 'd'],
      ['x"y', 'z', ''],
    ]);
  });

  it('imports Todoist rows with priority and date', () => {
    const csv = [
      'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE',
      'task,"Buy, wrap gift",wrap nicely,4,1,me,,2026-10-01,en,Europe/Helsinki',
      'task,Call bank,,2,1,me,,,,',
    ].join('\n');
    const result = parseTaskCSV(csv);
    expect(result.format).toBe('todoist');
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toMatchObject({ title: 'Buy, wrap gift', priority: 'high', dueDate: '2026-10-01' });
    expect(result.tasks[1].priority).toBe('low');
  });

  it('imports TickTick rows and leaves completed ones behind', () => {
    const csv = [
      '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Completed Time"',
      '"Inbox","Home","Fix tap","TEXT","","",0,"","2026-09-30","","",5,0,""',
      '"Inbox","Home","Old thing","TEXT","","",0,"","2026-09-01","","",3,2,"2026-09-02T10:00:00+0300"',
    ].join('\n');
    const result = parseTaskCSV(csv);
    expect(result.format).toBe('ticktick');
    expect(result.tasks).toHaveLength(1);
    expect(result.done).toBe(1);
    expect(result.tasks[0]).toMatchObject({ title: 'Fix tap', priority: 'high', dueDate: '2026-09-30' });
  });

  it('falls back to a generic shape for unknown CSVs', () => {
    const result = parseTaskCSV('Task,Due\nMilk,28.09.2026');
    expect(result.format).toBe('generic');
    expect(result.tasks[0]).toMatchObject({ title: 'Milk', dueDate: '2026-09-28' });
  });
});

describe('calendar feeds', () => {
  it('merge preserves local edits and replaces only feed events', () => {
    let state = createEmptyState();
    state = addEvent(state, { title: 'Own event', date: '2026-09-28', startTime: '09:00', endTime: null, category: 'work', note: '', important: false }, 'own');
    const feed = [{ uid: 'u1', input: { title: 'Team standup', date: '2026-09-29', startTime: '10:00', endTime: '10:30', category: 'personal', note: '', important: false, source: { url: 'https://x/feed.ics', uid: 'u1' } } }];
    let nextId = 0;
    state = mergeFeedEvents(state, 'https://x/feed.ics', feed, 'now1', () => `f${nextId++}`);
    expect(state.events).toHaveLength(2);

    // User annotates the imported event; a refresh moves the time but keeps the notes.
    const imported = state.events.find((event) => event.source)?.id ?? '';
    state = updateTaskFrom(state, imported);
    state = mergeFeedEvents(state, 'https://x/feed.ics', [{ uid: 'u1', input: { ...feed[0].input, startTime: '11:00' } }], 'now2', () => `f${nextId++}`);
    const refreshed = state.events.find((event) => event.source);
    expect(refreshed?.startTime).toBe('11:00');
    expect(refreshed?.note).toBe('Pinned by me');
    expect(state.events).toHaveLength(2);

    // Item removed upstream disappears locally without touching the user's own events.
    state = mergeFeedEvents(state, 'https://x/feed.ics', [], 'now3', () => `f${nextId++}`);
    expect(state.events.map((event) => event.title)).toEqual(['Own event']);
  });
});

function updateTaskFrom(state: PlannerState, eventId: string): PlannerState {
  return {
    ...state,
    events: state.events.map((event) => (event.id === eventId ? { ...event, note: 'Pinned by me' } : event)),
  };
}

describe('shared space', () => {
  it('sharedItems picks out shared tasks, events and #shared notes', () => {
    let state = withTask(createEmptyState(), { category: SHARED_CATEGORY }, 's1');
    state = withTask(state, { category: 'work' }, 'w1');
    state = addNote(state, { title: 'Grocery list #shared', body: '', kind: 'quick', date: null }, 'note1');
    state = addEvent(state, { title: 'Dinner', date: '2026-09-28', startTime: '19:00', endTime: null, category: SHARED_CATEGORY, note: '', important: false }, 'ev1');
    const items = sharedItems(state);
    expect(items.tasks.map((item) => item.id)).toEqual(['s1']);
    expect(items.events.map((item) => item.id)).toEqual(['ev1']);
    expect(items.notes.map((item) => item.id)).toEqual(['note1']);
  });

  it('applyShared merges remote items and honours tombstones', () => {
    let local = withTask(createEmptyState(), { category: 'work' }, 'mine');
    const remoteTask = { ...JSON.parse(serialize(withTask(createEmptyState(), { category: SHARED_CATEGORY }, 'theirs'), 'now'))['tasks'][0] };
    const payload = { version: 1 as const, exportedAt: 'now', tasks: [remoteTask], events: [], notes: [], tombstones: {} };
    local = applySharedToState(local, payload, {});
    expect(local.tasks.map((item) => item.id).sort()).toEqual(['mine', 'theirs']);

    // Deleting it on one side makes the tombstone win on re-merge.
    const gone = applySharedToState(local, payload, { [tombstoneKey('task', 'theirs')]: '9999' });
    expect(gone.tasks.map((item) => item.id)).toEqual(['mine']);
  });

  it('syncSharedOnce round-trips through a fake server', async () => {
    const store = new Map<string, { version: number; ciphertext: string; updatedAt: string }>();
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const id = (init?.headers as Record<string, string>)['X-Sync-Id'];
      const method = init?.method ?? 'GET';
      const url = String(input);
      expect(url).toBe('/api/sync');
      if (method === 'GET') {
        const row = store.get(id);
        if (!row) return new Response('not found', { status: 404 });
        return new Response(JSON.stringify(row), { status: 200 });
      }
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { baseVersion: number; ciphertext: string };
        const existing = store.get(id);
        if (existing && existing.version !== body.baseVersion) {
          return new Response(JSON.stringify({ error: { code: 'conflict' }, current: existing }), { status: 409 });
        }
        const row = { version: (existing?.version ?? 0) + 1, ciphertext: body.ciphertext, updatedAt: new Date().toISOString() };
        store.set(id, row);
        return new Response(JSON.stringify(row), { status: 200 });
      }
      return new Response('nope', { status: 405 });
    }) as typeof fetch;

    // Device A pushes a shared task.
    let a = withTask(createEmptyState(), { category: SHARED_CATEGORY }, 'shared-1');
    const outA = await syncSharedOnce(a, { ...EMPTY_SHARED, code: 'K7QM-2XJD-9RTF-HB4W-PN6C', dirty: true }, {}, fakeFetch, () => '2026-09-28T09:00:00.000Z');
    expect(store.size).toBe(1);

    // Device B joins the room and receives it.
    const b = withTask(createEmptyState(), { category: 'work' }, 'b-own');
    const outB = await syncSharedOnce(b, { ...EMPTY_SHARED, code: 'K7QM-2XJD-9RTF-HB4W-PN5C' }, {}, fakeFetch, () => '2026-09-28T10:00:00.000Z');
    expect(outB.state).toBeNull(); // wrong code can't decrypt — that's the point
    const outB2 = await syncSharedOnce(b, { ...EMPTY_SHARED, code: 'K7QM-2XJD-9RTF-HB4W-PN6C' }, {}, fakeFetch, () => '2026-09-28T10:00:00.000Z');
    expect(outB2.state?.tasks.some((task) => task.id === 'shared-1')).toBe(true);
    expect(outB2.state?.tasks.some((task) => task.id === 'b-own')).toBe(true);
    a = outA.state ?? a;
  });
});

describe('year in pixels', () => {
  it('covers the whole year with ratios on days that have plans', () => {
    let state = withTask(createEmptyState(), { dueDate: '2026-03-10' }, 'pix');
    state = toggleTask(state, 'pix', '2026-03-10T09:00:00.000Z', '2026-03-10', 'unused');
    const pixels = yearPixels(state, 2026);
    expect(pixels).toHaveLength(365);
    const day = pixels.find((item) => item.date === '2026-03-10');
    expect(day?.score.ratio).toBe(1);
    expect(pixels.find((item) => item.date === '2026-01-01')?.score.ratio).toBeNull();
  });
});

describe('backup compatibility', () => {
  it('old backups without new fields still parse', () => {
    const legacy = JSON.stringify({
      version: 1,
      tasks: [{ id: 't', title: 'Old', completed: false, priority: 'high', dueDate: null, dueTime: null, category: 'work', note: '', goalId: null, sortOrder: 1, createdAt: 'x', updatedAt: 'y', repeat: null, subtasks: [] }],
    });
    const parsed = parseBackup(legacy);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state.tasks[0].estimatedMinutes).toBeNull();
  });
});
