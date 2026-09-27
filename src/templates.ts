/**
 * Reusable task and note templates. Stored locally (like reminders and other
 * device preferences) — deliberate, personal content stays in the synced planner.
 */
import { NOTE_KINDS, PRIORITIES, type NoteKind, type Priority } from './constants';
import { t } from './i18n';

export interface PlannerTemplate {
  id: string;
  title: string;
  type: 'task' | 'note';
  /** Note body, or the task's note field. */
  body: string;
  /** Checklist steps (tasks only). */
  subtasks: string[];
  priority: Priority;
  category: string;
  kind: NoteKind;
  createdAt: string;
}

const KEY = 'planner-templates';
const MAX_TEMPLATES = 30;

function sanitizeTemplate(value: unknown): PlannerTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 80) : '';
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 140) : '';
  const type = raw.type === 'note' ? 'note' : raw.type === 'task' ? 'task' : null;
  if (!id || !title || !type) return null;
  const priority = PRIORITIES.some((item) => item.id === raw.priority) ? (raw.priority as Priority) : 'medium';
  const kind = NOTE_KINDS.some((item) => item.id === raw.kind) ? (raw.kind as NoteKind) : 'quick';
  const subtasks = Array.isArray(raw.subtasks)
    ? raw.subtasks.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 140)).filter(Boolean).slice(0, 30)
    : [];
  return {
    id,
    title,
    type,
    body: typeof raw.body === 'string' ? raw.body.slice(0, 20000) : '',
    subtasks,
    priority,
    category: typeof raw.category === 'string' ? raw.category.slice(0, 40) : 'personal',
    kind,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
  };
}

const SEED_FLAG = 'planner-templates-seeded';

/** A few gentle starters, created once so the picker is never empty by accident. */
export function seedTemplates(now = new Date().toISOString()): PlannerTemplate[] {
  return [
    {
      id: 'tpl-packing',
      title: t('Trip packing'),
      type: 'task',
      body: '',
      subtasks: [t('Tickets & documents'), t('Chargers'), t('Clothes'), t('Medication'), t('Water bottle')],
      priority: 'medium',
      category: 'personal',
      kind: 'quick',
      createdAt: now,
    },
    {
      id: 'tpl-meeting',
      title: t('Meeting notes'),
      type: 'note',
      body: `## ${t('Attendees')}\n- \n\n## ${t('Notes')}\n- \n\n## ${t('Actions')}\n- [ ] `,
      subtasks: [],
      priority: 'medium',
      category: 'work',
      kind: 'quick',
      createdAt: now,
    },
    {
      id: 'tpl-reset',
      title: t('Weekly reset'),
      type: 'task',
      body: '',
      subtasks: [t('Empty the inbox'), t('Review last week'), t('Pick three things that matter'), t('Tidy the desk')],
      priority: 'medium',
      category: 'personal',
      kind: 'quick',
      createdAt: now,
    },
    {
      id: 'tpl-journal',
      title: t('Morning journal'),
      type: 'note',
      body: `**${t('Today I feel')}** \n\n**${t('One thing I’m grateful for')}** \n\n**${t('What would make today good')}** \n`,
      subtasks: [],
      priority: 'medium',
      category: 'personal',
      kind: 'journal',
      createdAt: now,
    },
  ];
}

export function loadTemplates(): PlannerTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      if (localStorage.getItem(SEED_FLAG)) return [];
      const seeds = seedTemplates();
      localStorage.setItem(SEED_FLAG, '1');
      localStorage.setItem(KEY, JSON.stringify(seeds));
      return seeds;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .flatMap((item) => {
        const template = sanitizeTemplate(item);
        if (!template || seen.has(template.id)) return [];
        seen.add(template.id);
        return [template];
      })
      .slice(0, MAX_TEMPLATES);
  } catch {
    return [];
  }
}

export function saveTemplates(templates: PlannerTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(templates.slice(0, MAX_TEMPLATES)));
  } catch {
    /* ignore */
  }
}

export function addTemplate(
  list: PlannerTemplate[],
  input: Omit<PlannerTemplate, 'id' | 'createdAt'>,
  id = crypto.randomUUID(),
  now = new Date().toISOString(),
): PlannerTemplate[] {
  const template = sanitizeTemplate({ ...input, id, createdAt: now });
  if (!template) return list;
  return [template, ...list].slice(0, MAX_TEMPLATES);
}

export function removeTemplate(list: PlannerTemplate[], id: string): PlannerTemplate[] {
  return list.filter((template) => template.id !== id);
}
