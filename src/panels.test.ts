import { describe, expect, it } from 'vitest';
import { createEmptyState } from './types';
import { sanitizePanels, sanitizeState } from './storage';
import { mergePanels, mergeStates } from './sync';
import { daysUntil, splitExplanations, subjectMinutes, weekOf, weekResults, withExplanation, withSubject, withoutSubject } from './panels';
import type { ChangeNote, Panels, PlannerState, StudentSubject } from './types';

function note(week: string, id: string): ChangeNote {
  return { id, createdAt: `2026-03-0${id}T10:00:00.000Z`, weekOf: week, summary: `change ${id}`, reason: 'because' };
}

function subject(id: string, name: string): StudentSubject {
  return { id, name, accent: 'blue', examDate: null, targetMinutes: null };
}

function stateWith(panels: Panels, extra: Partial<PlannerState> = {}): PlannerState {
  return { ...createEmptyState(), panels, ...extra };
}

describe('panel storage', () => {
  it('starts with both panels off and an empty planner', () => {
    const panels = sanitizePanels(undefined);
    expect(panels.student.enabled).toBe(false);
    expect(panels.guardian.enabled).toBe(false);
    expect(panels.guardian.kind).toBeNull();
  });

  it('keeps panel data through a save and load round trip', () => {
    const panels = withSubject(createEmptyState().panels, subject('s1', 'Physics'));
    const round = sanitizeState(JSON.parse(JSON.stringify(stateWith(panels))));
    expect(round?.panels.student.subjects[0]?.name).toBe('Physics');
  });

  it('never enables the guardian panel without a kind', () => {
    const panels = sanitizePanels({ guardian: { enabled: true, kind: 'mystery', links: [] } });
    expect(panels.guardian.enabled).toBe(false);
    expect(panels.guardian.kind).toBeNull();
  });

  it('drops junk subjects and notes but keeps the rest', () => {
    const panels = sanitizePanels({
      student: {
        enabled: true,
        subjects: [subject('s1', ' maths '), { id: 's2' }, null, { id: 's3', name: '' }],
        explanations: [note('2026-03-02', '1'), { id: 'x', summary: 'no week' }],
      },
    });
    expect(panels.student.subjects.map((item) => item.name)).toEqual(['maths']);
    expect(panels.student.explanations).toHaveLength(1);
  });

  it('caps subjects, notes and links so a vault never outgrows its budget', () => {
    const many = Array.from({ length: 60 }, (_, index) => subject(`s${index}`, `S${index}`));
    const notes = Array.from({ length: 260 }, (_, index) => note('2026-03-02', `${index}`));
    const links = Array.from({ length: 40 }, (_, index) => ({
      id: `l${index}`,
      username: `u${index}`,
      displayName: `U${index}`,
      status: 'linked' as const,
      results: null,
    }));
    const panels = sanitizePanels({ student: { enabled: true, subjects: many, explanations: notes }, guardian: { enabled: true, kind: 'parent', links } });
    expect(panels.student.subjects.length).toBe(40);
    expect(panels.student.explanations.length).toBe(200);
    expect(panels.guardian.links.length).toBe(20);
  });
});

describe('panel merge', () => {
  it('treats an added panel as added even when the other device never saw it', () => {
    const local = stateWith(withSubject(createEmptyState().panels, subject('s1', 'Biology')));
    local.panels.student.enabled = true;
    const remote = stateWith(createEmptyState().panels);
    const merged = mergeStates(local, remote);
    expect(merged.panels.student.enabled).toBe(true);
    expect(merged.panels.student.subjects.map((item) => item.name)).toEqual(['Biology']);
  });

  it('keeps the kind chosen on either device', () => {
    const base = createEmptyState().panels;
    const local = stateWith({ ...base, guardian: { ...base.guardian, enabled: true, kind: 'parent', links: [] } });
    const remote = stateWith({ ...base, guardian: { ...base.guardian, enabled: false, kind: null, links: [] } });
    expect(mergePanels(local.panels, remote.panels).guardian.kind).toBe('parent');
    expect(mergePanels(remote.panels, local.panels).guardian.kind).toBe('parent');
  });

  it('does not duplicate subjects when both devices hold the same one', () => {
    const base = createEmptyState().panels;
    const a = stateWith(withSubject(base, subject('s1', 'History')));
    const b = stateWith(withSubject(base, subject('s1', 'History')));
    expect(mergePanels(a.panels, b.panels).student.subjects).toHaveLength(1);
  });
});

describe('weekly results', () => {
  it('counts only what belongs to this week', () => {
    const week = weekOf('2026-03-04');
    const inside = week;
    const outside = '2020-01-01';
    const state = stateWith(createEmptyState().panels, {
      tasks: [
        { ...createEmptyState().tasks, id: 't1', title: 'in', dueDate: inside, completed: true } as never,
        { ...createEmptyState().tasks, id: 't2', title: 'out', dueDate: outside, completed: true } as never,
      ],
      events: [
        { ...createEmptyState().events, id: 'e1', title: 'in', date: inside, completed: false } as never,
      ],
      focusLog: [{ id: 'f1', taskId: 't1', title: 'in', minutes: 50, date: inside, endedAt: `${inside}T10:00:00.000Z` }],
    });
    const results = weekResults(state, week);
    expect(results.planned).toBe(2);
    expect(results.done).toBe(1);
    expect(results.focusMinutes).toBe(50);
  });

  it('counts study minutes from focus sessions on that subject’s tasks', () => {
    const week = weekOf('2026-03-04');
    const state = stateWith(createEmptyState().panels, {
      tasks: [
        { id: 't1', title: 'chapter 4', category: 'Physics' },
        { id: 't2', title: 'other', category: 'Music' },
      ] as never,
      focusLog: [
        { id: 'f1', taskId: 't1', title: 'chapter 4', minutes: 45, date: week, endedAt: `${week}T10:00:00.000Z` },
        { id: 'f2', taskId: 't2', title: 'other', minutes: 30, date: week, endedAt: `${week}T11:00:00.000Z` },
      ] as never,
    });
    expect(subjectMinutes(state, subject('s1', 'physics'), week)).toBe(45);
  });

  it('keeps this week’s detail and reduces older weeks to counts', () => {
    const week = '2026-03-02';
    const panels = withExplanation(
      withExplanation(withExplanation(createEmptyState().panels, note(week, '1')), note(week, '2')),
      note('2026-02-23', '3'),
    );
    const { current, past } = splitExplanations(panels.student.explanations, week);
    expect(current).toHaveLength(2);
    expect(past).toEqual([{ week: '2026-02-23', count: 1 }]);
  });

  it('counts days to an exam, and says so when it has passed', () => {
    expect(daysUntil('2026-03-10', '2026-03-04')).toBe(6);
    expect(daysUntil('2026-03-01', '2026-03-04')).toBe(-3);
    expect(daysUntil(null, '2026-03-04')).toBeNull();
  });

  it('removing a subject leaves the planner itself alone', () => {
    const panels = withSubject(createEmptyState().panels, subject('s1', 'Chemistry'));
    const next = withoutSubject(panels, 's1');
    expect(next.student.subjects).toHaveLength(0);
    expect(next.student.enabled).toBe(panels.student.enabled);
  });
});
