export const ACCENTS = ['sage', 'blue', 'pink', 'lav', 'peach'] as const;
export type Accent = (typeof ACCENTS)[number];

export const ACCENT_CHOICES = [
  { id: 'sage', label: 'Sage' },
  { id: 'blue', label: 'Ocean' },
  { id: 'pink', label: 'Rose' },
  { id: 'lav', label: 'Lilac' },
  { id: 'peach', label: 'Amber' },
] as const;

export const CATEGORIES = [
  { id: 'personal', label: 'Personal', accent: 'peach' },
  { id: 'work', label: 'Work', accent: 'blue' },
  { id: 'health', label: 'Health', accent: 'sage' },
  { id: 'learning', label: 'Learning', accent: 'lav' },
  { id: 'home', label: 'Home', accent: 'pink' },
  { id: 'social', label: 'Social', accent: 'blue' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export const PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
] as const;

export type Priority = (typeof PRIORITIES)[number]['id'];

export const HABIT_ICONS = [
  { id: 'water', label: 'Water' },
  { id: 'book', label: 'Reading' },
  { id: 'study', label: 'Study' },
  { id: 'moon', label: 'Sleep' },
  { id: 'sun', label: 'Morning' },
  { id: 'walk', label: 'Walk' },
  { id: 'heart', label: 'Care' },
  { id: 'leaf', label: 'Outdoors' },
  { id: 'coffee', label: 'Coffee' },
  { id: 'pencil', label: 'Writing' },
  { id: 'home', label: 'Home' },
  { id: 'stretch', label: 'Movement' },
  { id: 'spark', label: 'Focus' },
] as const;

export type HabitIconId = (typeof HABIT_ICONS)[number]['id'];

export const NOTE_KINDS = [
  { id: 'quick', label: 'Quick note', accent: 'peach' },
  { id: 'idea', label: 'Idea', accent: 'lav' },
  { id: 'reminder', label: 'Reminder', accent: 'blue' },
  { id: 'journal', label: 'Journal', accent: 'sage' },
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

export function habitIconById(id: string) {
  return HABIT_ICONS.find((item) => item.id === id) ?? HABIT_ICONS[0];
}
