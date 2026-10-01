import { t } from './i18n';
export const ACCENTS = ['sage', 'blue', 'pink', 'lav', 'peach'] as const;
export type Accent = (typeof ACCENTS)[number];

export const ACCENT_CHOICES = [
  { id: 'sage', get label() { return t('Sage'); } },
  { id: 'blue', get label() { return t('Ocean'); } },
  { id: 'pink', get label() { return t('Rose'); } },
  { id: 'lav', get label() { return t('Lilac'); } },
  { id: 'peach', get label() { return t('Amber'); } },
] as const;

export const CATEGORIES = [
  { id: 'personal', get label() { return t('Personal'); }, accent: 'peach' },
  { id: 'work', get label() { return t('Work'); }, accent: 'blue' },
  { id: 'health', get label() { return t('Health'); }, accent: 'sage' },
  { id: 'learning', get label() { return t('Learning'); }, accent: 'lav' },
  { id: 'home', get label() { return t('Home'); }, accent: 'pink' },
  { id: 'social', get label() { return t('Social'); }, accent: 'blue' },
] as const;
export const PRIORITIES = [
  { id: 'low', get label() { return t('Low'); } },
  { id: 'medium', get label() { return t('Medium'); } },
  { id: 'high', get label() { return t('High'); } },
] as const;

export type Priority = (typeof PRIORITIES)[number]['id'];

export const HABIT_ICONS = [
  { id: 'water', get label() { return t('Water'); } },
  { id: 'book', get label() { return t('Reading'); } },
  { id: 'study', get label() { return t('Study'); } },
  { id: 'moon', get label() { return t('Sleep'); } },
  { id: 'sun', get label() { return t('Morning'); } },
  { id: 'walk', get label() { return t('Walk'); } },
  { id: 'heart', get label() { return t('Care'); } },
  { id: 'leaf', get label() { return t('Outdoors'); } },
  { id: 'coffee', get label() { return t('Coffee'); } },
  { id: 'pencil', get label() { return t('Writing'); } },
  { id: 'home', get label() { return t('Home'); } },
  { id: 'stretch', get label() { return t('Movement'); } },
  { id: 'spark', get label() { return t('Focus'); } },
] as const;

export type HabitIconId = (typeof HABIT_ICONS)[number]['id'];

export const NOTE_KINDS = [
  { id: 'quick', get label() { return t('Quick note'); }, accent: 'peach' },
  { id: 'idea', get label() { return t('Idea'); }, accent: 'lav' },
  { id: 'reminder', get label() { return t('Reminder'); }, accent: 'blue' },
  { id: 'journal', get label() { return t('Journal'); }, accent: 'sage' },
] as const;

export type NoteKind = (typeof NOTE_KINDS)[number]['id'];

export const ITEM_TYPES = ['task', 'event', 'habit', 'goal', 'note'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const MOTIVATION = [
  'A quiet plan makes a kinder day.',
  'Leave room for rest. It belongs on the page.',
  'Small, finished things beat a crowded list.',
  'Protect one hour for what matters most.',
  'Progress is a direction, not a score.',
  'You do not have to fill every hour.',
  'Begin with the thing that would make today feel complete.',
  'Steady is enough.',
  'Put the important thing where you will see it.',
  'Let the day have edges.',
  'Clarity is a form of kindness.',
  'Do less, on purpose.',
  'Your attention is the real plan.',
  'Make space before you make promises.',
] as const;

export function categoryById(id: string) {
  return CATEGORIES.find((item) => item.id === id) ?? CATEGORIES[0];
}

export function noteKindById(id: string) {
  return NOTE_KINDS.find((item) => item.id === id) ?? NOTE_KINDS[0];
}
