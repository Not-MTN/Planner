import type { Accent, HabitIconId } from './constants';
import type { HabitFrequency, HabitInput } from './types';

export interface HabitPreset {
  id: string;
  name: string;
  icon: HabitIconId;
  accent: Accent;
  frequency: HabitFrequency;
  essential?: boolean;
  blurb?: string;
}

/**
 * The must-do-every-day jobs. Pinned to the top of Today as
 * “Daily essentials” so they are impossible to miss.
 */
export const ESSENTIAL_PRESETS: HabitPreset[] = [
  { id: 'water', name: 'Drink water', icon: 'water', accent: 'blue', frequency: { type: 'daily' }, essential: true, blurb: 'Eight glasses, more or less.' },
  { id: 'move', name: 'Move for 30 minutes', icon: 'stretch', accent: 'sage', frequency: { type: 'daily' }, essential: true, blurb: 'A walk counts. So does dancing.' },
  { id: 'outside', name: 'Get outside', icon: 'sun', accent: 'peach', frequency: { type: 'daily' }, essential: true, blurb: 'Ten minutes of daylight.' },
  { id: 'sleep', name: 'Sleep by 11', icon: 'moon', accent: 'lav', frequency: { type: 'daily' }, essential: true, blurb: 'Tomorrow starts tonight.' },
  { id: 'tidy', name: 'Tidy for 10 minutes', icon: 'home', accent: 'pink', frequency: { type: 'daily' }, essential: true, blurb: 'A little, every day.' },
  { id: 'vitamins', name: 'Take vitamins', icon: 'heart', accent: 'sage', frequency: { type: 'daily' }, essential: true, blurb: 'The small daily dose.' },
];

export interface HabitGroup {
  id: string;
  label: string;
  blurb: string;
  presets: HabitPreset[];
}

/** The built-in library, shown in the Habits view. */
export const HABIT_GROUPS: HabitGroup[] = [
  {
    id: 'essentials',
    label: 'Daily essentials',
    blurb: 'Must-dos for every day.',
    presets: ESSENTIAL_PRESETS,
  },
  {
    id: 'body',
    label: 'Body',
    blurb: 'Small kindnesses to yourself.',
    presets: [
      { id: 'stretch', name: 'Stretch for 10 minutes', icon: 'stretch', accent: 'sage', frequency: { type: 'daily' } },
      { id: 'steps', name: 'Walk 8,000 steps', icon: 'walk', accent: 'blue', frequency: { type: 'daily' } },
      { id: 'cook', name: 'Cook a meal at home', icon: 'coffee', accent: 'peach', frequency: { type: 'daily' } },
    ],
  },
  {
    id: 'mind',
    label: 'Mind',
    blurb: 'Feed the quiet part.',
    presets: [
      { id: 'read', name: 'Read 20 minutes', icon: 'book', accent: 'sage', frequency: { type: 'daily' } },
      { id: 'meditate', name: 'Meditate 10 minutes', icon: 'spark', accent: 'lav', frequency: { type: 'daily' } },
      { id: 'journal', name: 'Journal one line', icon: 'pencil', accent: 'pink', frequency: { type: 'daily' } },
      { id: 'learn', name: 'Learn something new', icon: 'study', accent: 'blue', frequency: { type: 'daily' } },
    ],
  },
  {
    id: 'home',
    label: 'Home',
    blurb: 'Keep the nest gentle.',
    presets: [
      { id: 'bed', name: 'Make the bed', icon: 'sun', accent: 'peach', frequency: { type: 'daily' } },
      { id: 'dishes', name: 'Wash the dishes', icon: 'water', accent: 'blue', frequency: { type: 'daily' } },
      { id: 'plants', name: 'Water the plants', icon: 'leaf', accent: 'sage', frequency: { type: 'daily' } },
      { id: 'laundry', name: 'Laundry day', icon: 'home', accent: 'pink', frequency: { type: 'weekly', times: 1 } },
    ],
  },
  {
    id: 'connection',
    label: 'Connection',
    blurb: 'The people part.',
    presets: [
      { id: 'message', name: 'Message someone you love', icon: 'heart', accent: 'pink', frequency: { type: 'daily' } },
      { id: 'friend', name: 'Coffee with a friend', icon: 'coffee', accent: 'peach', frequency: { type: 'weekly', times: 1 } },
      { id: 'gratitude', name: 'Note three good things', icon: 'spark', accent: 'lav', frequency: { type: 'daily' } },
    ],
  },
];

export function presetToInput(preset: HabitPreset): HabitInput {
  return {
    name: preset.name,
    icon: preset.icon,
    accent: preset.accent,
    frequency: preset.frequency,
    essential: Boolean(preset.essential),
  };
}
