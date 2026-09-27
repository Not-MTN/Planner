import { addDays, isWeekend, todayISO } from './dates';
import {
  addEvent,
  addGoal,
  addHabit,
  addNote,
  addTask,
  setIntention,
  toggleHabit,
  toggleTask,
} from './mutate';
import { createEmptyState, type PlannerState } from './types';

const DAY = 86400000;

export function buildSampleState(now = new Date()): PlannerState {
  const today = todayISO(now);
  const started = addDays(today, -21);
  const stamp = (daysAgo: number, hour = 9) => {
    const date = new Date(now.getTime() - daysAgo * DAY);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  let state = createEmptyState();

  state = addHabit(state, { name: 'Read 20 minutes', icon: 'book', accent: 'sage', frequency: { type: 'daily' } }, 'sample-read', stamp(21), started);
  state = addHabit(state, { name: 'Morning walk', icon: 'walk', accent: 'peach', frequency: { type: 'weekdays' }, essential: true }, 'sample-walk', stamp(21), started);
  state = addHabit(state, { name: 'Drink water', icon: 'water', accent: 'blue', frequency: { type: 'daily' }, essential: true }, 'sample-water', stamp(21), started);

  for (let offset = 3; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    state = toggleHabit(state, 'sample-read', date);
    state = toggleHabit(state, 'sample-water', date);
    if (!isWeekend(date) && offset > 0) state = toggleHabit(state, 'sample-walk', date);
  }

  state = addEvent(
    state,
    {
      title: 'Morning coffee',
      date: today,
      startTime: '08:00',
      endTime: '08:30',
      category: 'personal',
      note: '',
      important: false,
    },
    'sample-event-coffee',
    stamp(0, 7),
  );
  state = addEvent(
    state,
    {
      title: 'Deep work block',
      date: today,
      startTime: '09:30',
      endTime: '11:30',
      category: 'work',
      note: 'Phone in the drawer.',
      important: true,
    },
    'sample-event-deep',
    stamp(0, 7),
  );
  state = addEvent(
    state,
    {
      title: 'Lunch outside',
      date: today,
      startTime: '13:00',
      endTime: '14:00',
      category: 'personal',
      note: '',
      important: false,
    },
    'sample-event-lunch',
    stamp(0, 7),
  );

  state = addTask(
    state,
    {
      title: 'Finish the report',
      priority: 'high',
      dueDate: today,
      dueTime: '16:00',
      category: 'work',
      note: '',
      goalId: null,
    },
    'sample-task-report',
    stamp(0, 8),
  );
  state = addTask(
    state,
    {
      title: 'Reply to messages',
      priority: 'low',
      dueDate: today,
      dueTime: null,
      category: 'social',
      note: '',
      goalId: null,
    },
    'sample-task-messages',
    stamp(0, 8),
  );
  state = addTask(
    state,
    {
      title: 'Stretch for ten minutes',
      priority: 'medium',
      dueDate: today,
      dueTime: null,
      category: 'health',
      note: '',
      goalId: null,
    },
    'sample-task-stretch',
    stamp(0, 8),
  );
  state = toggleTask(state, 'sample-task-stretch', stamp(0, 10));
  state = addTask(
    state,
    {
      title: 'Book the dentist',
      priority: 'medium',
      dueDate: addDays(today, 1),
      dueTime: null,
      category: 'health',
      note: '',
      goalId: null,
    },
    'sample-task-dentist',
    stamp(0, 8),
  );
  state = addTask(
    state,
    {
      title: 'Brainstorm gift ideas',
      priority: 'low',
      dueDate: null,
      dueTime: null,
      category: 'personal',
      note: '',
      goalId: 'sample-goal-books',
    },
    'sample-task-gift',
    stamp(0, 8),
  );

  state = addGoal(
    state,
    {
      title: 'Read four books this season',
      description: 'Twenty minutes a day is enough. Keep the stack by the couch.',
      horizon: 'short',
      deadline: addDays(today, 45),
      milestone: 'Finish chapter one',
    },
    'sample-goal-books',
    'sample-milestone-1',
    stamp(5),
  );

  state = addNote(
    state,
    {
      title: 'Welcome to Planner',
      body: 'This is a sample day, so you can see how things fit together.\n\nEverything stays in this browser. Clear it any time from Settings → Start fresh, or keep what you like and make it yours.',
      kind: 'quick',
      date: today,
    },
    'sample-note-welcome',
    stamp(0, 8),
  );

  state = setIntention(state, today, 'Keep the morning slow.');
  return state;
}
