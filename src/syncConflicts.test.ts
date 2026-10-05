// @vitest-environment jsdom
/**
 * Two devices can edit the same thing while apart. Merging has to pick one, so
 * the test that matters is not "does it merge" but "is the version it dropped
 * still there afterwards" — and can it be put back.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  describeConflict,
  findMergeConflicts,
  keyOfConflict,
  loadConflicts,
  mergeConflictLists,
  restoreConflict,
  saveConflicts,
  type MergeConflict,
} from './sync';
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

// ── Where a conflict goes after it is found ────────────────────────────────
//
// A sync runs on its own, often while the user is looking at something else, so
// a disagreement that lives only in memory is one the user never sees. These
// hold the storage half: it survives a reload, it is bounded, and nonsense in
// storage cannot become a crash or a phantom row.
beforeEach(() => window.localStorage.clear());

describe('conflicts that wait for a decision', () => {
  it('keeps one row per disagreement when a sync runs twice', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    expect(mergeConflictLists([conflict], [conflict])).toHaveLength(1);
    expect(keyOfConflict(conflict)).toBe(`task:essay:${EARLIER_EDIT}`);
  });

  it('adds new disagreements without dropping the older ones', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    const second: MergeConflict = { ...conflict, item: { ...conflict.item, id: 'other' }, lostAt: LATER_EDIT };
    const merged = mergeConflictLists([conflict], [second]);
    expect(merged.map((item) => item.item.id)).toEqual(['other', 'essay']);
  });

  it('survives a reload, and forgets everything when the last one is answered', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    saveConflicts([conflict]);
    const reloaded = loadConflicts();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({ kind: 'task', title: 'History essay', lostAt: EARLIER_EDIT });
    // The version that lost is kept whole, so putting it back is exact.
    expect(reloaded[0].item).toEqual(conflict.item);

    saveConflicts([]);
    expect(loadConflicts()).toEqual([]);
    expect(window.localStorage.getItem('planner-sync-conflicts')).toBeNull();
  });

  it('ignores anything in storage that is not a conflict', () => {
    window.localStorage.setItem(
      'planner-sync-conflicts',
      JSON.stringify([
        null,
        { kind: 'task', lostAt: EARLIER_EDIT, item: {} },             // no id
        { kind: 'unknown', lostAt: EARLIER_EDIT, item: { id: 'x' } }, // not a kind we have
        { kind: 'note', lostAt: '', item: { id: 'y' } },              // no moment to compare
        { kind: 'note', lostAt: EARLIER_EDIT, item: 'not an object' },
      ]),
    );
    expect(loadConflicts()).toEqual([]);
  });

  it('crucially keeps a row whose title was not a string', () => {
    // A conflict without a usable title is still a lost edit: dropping every
    // other field because one is malformed is how an edit disappears.
    window.localStorage.setItem(
      'planner-sync-conflicts',
      JSON.stringify([{ kind: 'note', lostAt: EARLIER_EDIT, title: 42, item: { id: 'y', body: 'Two books' } }]),
    );
    const [conflict] = loadConflicts();
    expect(conflict.title).toBe('');
    expect(conflict.item).toMatchObject({ id: 'y', body: 'Two books' });
  });

  it('does not fall over on storage that is not JSON at all', () => {
    window.localStorage.setItem('planner-sync-conflicts', '{not json');
    expect(loadConflicts()).toEqual([]);
  });
});

// ── What actually differs ──────────────────────────────────────────────────
describe('why the two versions are different', () => {
  it('names the field, both values, and nothing that matches', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    // `remote` is the version the merge kept (it was edited later), which is
    // the state `describeConflict` is given in the app: the planner holds the
    // winner, and the conflict holds the version that lost.
    const changes = describeConflict(remote, conflict);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'title', mine: 'History essay plan', theirs: 'History essay' });
  });

  it('reads a due date, a priority and a note body as separate differences', () => {
    let local = addTask(createEmptyState(), task('Essay'), 'essay', MADE);
    local = updateTask(local, 'essay', { dueDate: '2026-05-12', priority: 'high', note: 'Bring the draft' }, EARLIER_EDIT);
    let remote = addTask(createEmptyState(), task('Essay'), 'essay', MADE);
    remote = updateTask(remote, 'essay', { dueDate: '2026-05-13', priority: 'low', note: 'Bring the notes' }, LATER_EDIT);
    const [conflict] = findMergeConflicts(local, remote, MADE) as [MergeConflict];
    const changes = describeConflict(remote, conflict);
    expect(changes.map((change) => change.field)).toEqual(expect.arrayContaining(['due', 'priority', 'body']));
    // The merge kept `remote` (edited later), so the pair reads (kept, lost).
    expect(changes.find((change) => change.field === 'due')).toMatchObject({ mine: '2026-05-13', theirs: '2026-05-12' });
  });

  it('says what the lost version had when the item is gone from the planner', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    const withoutIt = { ...local, tasks: [] };
    const changes = describeConflict(withoutIt, conflict);
    expect(changes.map((change) => change.field)).toContain('title');
    expect(changes.find((change) => change.field === 'title')?.theirs).toBe('History essay');
  });

  it('stays quiet about fields neither version filled in', () => {
    const { local, remote, since } = diverged();
    const [conflict] = findMergeConflicts(local, remote, since) as [MergeConflict];
    // A task with no date, priority or category set must not produce rows of
    // empty strings — that reads as a broken screen.
    const changes = describeConflict(remote, conflict).filter((change) => !change.mine && !change.theirs);
    expect(changes).toEqual([]);
  });
});
