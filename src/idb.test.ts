import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { idbClear, idbRead, idbWrite, savedAt } from './idb';
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

  it('compares save times', () => {
    expect(savedAt(null)).toBe('');
    expect(savedAt(serialize(createEmptyState(), '2026-01-01T00:00:00.000Z')) > savedAt('{}')).toBe(true);
  });
});
