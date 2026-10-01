// @vitest-environment node
/**
 * Two devices can edit the same thing while apart. Merging has to pick one, so
 * the test that matters is not "does it merge" but "is the version it dropped
 * still there afterwards" — and can it be put back.
 */
import { describe, expect, it } from 'vitest';
import { findMergeConflicts, restoreConflict, type MergeConflict } from './sync';
import { addNote, addTask, updateNote, updateTask } from './mutate';
import { createEmptyState, type PlannerState } from './types';

const task = (title: string) => ({
  title,
  priority: 'medium' as const,
  dueDate: null,
  dueTime: null,
  category: 'personal',
  note: '',
  goalId: null,
});

const MADE = '2026-09-24T09:00:00.000Z';
const EARLIER_EDIT = '2026-09-25T10:00:00.000Z';
const LATER_EDIT = '2026-09-25T11:00:00.000Z';

/** Two copies of the same planner, both edited after the last time they met. */
function diverged(): { local: PlannerState; remote: PlannerState; since: string } {
  let local = addTask(createEmptyState(), task('Essay'), 'essay', MADE);
  local = addNote(local, { title: 'Reading list', body: 'One book', kind: 'idea', date: null }, 'note', MADE);
  let remote = local;
  local = updateTask(local, 'essay', { title: 'History essay' }, EARLIER_EDIT);
  remote = updateTask(remote, 'essay', { title: 'History essay plan' }, LATER_EDIT);
  return { local, remote, since: MADE };
}

describe('two devices, one item', () => {
  it('notices when both sides edited since they last agreed', () => {
    const { local, remote, since } = diverged();
    const conflicts = findMergeConflicts(local, remote, since);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'task', title: 'History essay' });
  });

  it('keeps the version that the merge throws away', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    // The newer edit wins the merge, so the older one is what has to be kept.
    expect(conflict.title).toBe(local.tasks[0]!.title);
    expect(conflict.item).toEqual(local.tasks[0]);
    expect(conflict.lostAt).toBe(EARLIER_EDIT);
  });

  it('says nothing when only one side changed', () => {
    const { local, since } = diverged();
    expect(findMergeConflicts(local, diverged().local, since)).toHaveLength(0);
  });

  it('says nothing without a moment to compare against', () => {
    // Two copies always differ somehow. Without "since when", every difference
    // would look like a disagreement, which is noise and not help.
    const { local, remote } = diverged();
    expect(findMergeConflicts(local, remote, null)).toHaveLength(0);
  });

  it('says nothing when both sides ended up the same', () => {
    let local = addTask(createEmptyState(), task('Essay'), 'essay', MADE);
    local = updateTask(local, 'essay', { title: 'Same' }, EARLIER_EDIT);
    let remote = addTask(createEmptyState(), task('Essay'), 'essay', MADE);
    remote = updateTask(remote, 'essay', { title: 'Same' }, LATER_EDIT);
    expect(findMergeConflicts(local, remote, MADE)).toHaveLength(0);
  });

  it('finds the same thing in a note', () => {
    let local = addNote(createEmptyState(), { title: 'Reading list', body: 'One book', kind: 'idea', date: null }, 'note', MADE);
    let remote = local;
    local = updateNote(local, 'note', { body: 'Two books' }, EARLIER_EDIT);
    remote = updateNote(remote, 'note', { body: 'Three books' }, LATER_EDIT);
    const conflicts = findMergeConflicts(local, remote, MADE);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'note', title: 'Reading list' });
  });
});

describe('putting the other version back', () => {
  it('replaces what is there and stamps it now, so it wins the next round', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    const restored = restoreConflict(remote, conflict, '2026-09-26T09:00:00.000Z');
    expect(restored.tasks).toHaveLength(1);
    expect(restored.tasks[0]!.title).toBe('History essay');
    expect(restored.tasks[0]!.updatedAt).toBe('2026-09-26T09:00:00.000Z');
  });

  it('puts back an item the other device had deleted', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    const withoutIt: PlannerState = { ...remote, tasks: [] };
    expect(restoreConflict(withoutIt, conflict).tasks).toHaveLength(1);
  });

  it('leaves everything else alone', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    const restored = restoreConflict(remote, conflict, '2026-09-26T09:00:00.000Z');
    expect(restored.notes).toEqual(remote.notes);
  });
});
