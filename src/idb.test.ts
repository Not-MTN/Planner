import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { idbClear, idbKeysWithPrefix, idbRead, idbReadBlob, idbWrite, idbWriteBlob, savedAt } from './idb';
import { sweepAttachmentBlobs } from './files';
import { serialize } from './storage';
import { createEmptyState } from './types';

describe('IndexedDB mirror', () => {
  it('writes, reads the latest value in order, and clears', async () => {
    const first = serialize(createEmptyState(), '2026-09-27T10:00:00.000Z');
    const second = serialize(createEmptyState(), '2026-09-27T11:00:00.000Z');
    void idbWrite(first);
    expect(await idbWrite(second)).toBe(true);
    const stored = await idbRead();
    expect(savedAt(stored)).toBe('2026-09-27T11:00:00.000Z');
    await idbClear();
    expect(await idbRead()).toBeNull();
  });

  it('sweeps orphaned attachment blobs and keeps referenced ones', async () => {
    const state = createEmptyState();
    state.notes.push({
      id: 'n1', title: 'song', body: '', kind: 'quick', date: null, pinned: false,
      createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z',
      attachments: [{ id: 'kept', name: 'a.mp3', mime: 'audio/mpeg', size: 3, addedAt: '2026-09-28T10:00:00.000Z' }],
    });
    await idbWriteBlob('file:kept', new Blob(['a']));
    await idbWriteBlob('file:orphan-1', new Blob(['b']));
    await idbWriteBlob('file:orphan-2', new Blob(['c']));
    await idbWrite('{"state":1}'); // make sure plain state keys survive the prefix filter
    expect((await idbKeysWithPrefix('file:')).sort()).toEqual(['file:kept', 'file:orphan-1', 'file:orphan-2']);
    const swept = await sweepAttachmentBlobs(state);
    expect(swept).toBe(2);
    expect(await idbKeysWithPrefix('file:')).toEqual(['file:kept']);
    expect(await idbReadBlob('file:kept')).not.toBeNull();
  });

  it('compares save times', () => {
    expect(savedAt(null)).toBe('');
    expect(savedAt(serialize(createEmptyState(), '2026-01-01T00:00:00.000Z')) > savedAt('{}')).toBe(true);
  });
});
