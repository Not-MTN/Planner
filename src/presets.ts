import type { Accent, HabitIconId } from './constants';
import type { HabitFrequency, HabitInput } from './types';
import { t } from './i18n';

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
  { id: 'water', get name() { return t('Drink water'); }, icon: 'water', accent: 'blue', frequency: { type: 'daily' }, essential: true, get blurb() { return t('Eight glasses, more or less.'); } },
  { id: 'move', get name() { return t('Move for 30 minutes'); }, icon: 'stretch', accent: 'sage', frequency: { type: 'daily' }, essential: true, get blurb() { return t('A walk counts. So does dancing.'); } },
  { id: 'outside', get name() { return t('Get outside'); }, icon: 'sun', accent: 'peach', frequency: { type: 'daily' }, essential: true, get blurb() { return t('Ten minutes of daylight.'); } },
  { id: 'sleep', get name() { return t('Sleep by 11'); }, icon: 'moon', accent: 'lav', frequency: { type: 'daily' }, essential: true, get blurb() { return t('Tomorrow starts tonight.'); } },
  { id: 'tidy', get name() { return t('Tidy for 10 minutes'); }, icon: 'home', accent: 'pink', frequency: { type: 'daily' }, essential: true, get blurb() { return t('A little, every day.'); } },
  { id: 'vitamins', get name() { return t('Take vitamins'); }, icon: 'heart', accent: 'sage', frequency: { type: 'daily' }, essential: true, get blurb() { return t('The small daily dose.'); } },
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
    get label() { return t('Daily essentials'); },
    get blurb() { return t('Must-dos for every day.'); },
    presets: ESSENTIAL_PRESETS,
  },
  {
    id: 'body',
    get label() { return t('Body'); },
    get blurb() { return t('Small kindnesses to yourself.'); },
    presets: [
      { id: 'stretch', get name() { return t('Stretch for 10 minutes'); }, icon: 'stretch', accent: 'sage', frequency: { type: 'daily' } },
      { id: 'steps', get name() { return t('Walk 8,000 steps'); }, icon: 'walk', accent: 'blue', frequency: { type: 'daily' } },
      { id: 'cook', get name() { return t('Cook a meal at home'); }, icon: 'coffee', accent: 'peach', frequency: { type: 'daily' } },
    ],
  },
  {
    id: 'mind',
    get label() { return t('Mind'); },
    get blurb() { return t('Feed the quiet part.'); },
    presets: [
      { id: 'read', get name() { return t('Read 20 minutes'); }, icon: 'book', accent: 'sage', frequency: { type: 'daily' } },
      { id: 'meditate', get name() { return t('Meditate 10 minutes'); }, icon: 'spark', accent: 'lav', frequency: { type: 'daily' } },
      { id: 'journal', get name() { return t('Journal one line'); }, icon: 'pencil', accent: 'pink', frequency: { type: 'daily' } },
      { id: 'learn', get name() { return t('Learn something new'); }, icon: 'study', accent: 'blue', frequency: { type: 'daily' } },
    ],
  },
  {
    id: 'home',
    get label() { return t('Home'); },
    get blurb() { return t('Keep the nest gentle.'); },
    presets: [
      { id: 'bed', get name() { return t('Make the bed'); }, icon: 'sun', accent: 'peach', frequency: { type: 'daily' } },
      { id: 'dishes', get name() { return t('Wash the dishes'); }, icon: 'water', accent: 'blue', frequency: { type: 'daily' } },
      { id: 'plants', get name() { return t('Water the plants'); }, icon: 'leaf', accent: 'sage', frequency: { type: 'daily' } },
      { id: 'laundry', get name() { return t('Laundry day'); }, icon: 'home', accent: 'pink', frequency: { type: 'weekly', times: 1 } },
    ],
  },
  {
    id: 'connection',
    get label() { return t('Connection'); },
    get blurb() { return t('The people part.'); },
    presets: [
      { id: 'message', get name() { return t('Message someone you love'); }, icon: 'heart', accent: 'pink', frequency: { type: 'daily' } },
      { id: 'friend', get name() { return t('Coffee with a friend'); }, icon: 'coffee', accent: 'peach', frequency: { type: 'weekly', times: 1 } },
      { id: 'gratitude', get name() { return t('Note three good things'); }, icon: 'spark', accent: 'lav', frequency: { type: 'daily' } },
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
