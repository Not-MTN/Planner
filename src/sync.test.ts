import { describe, expect, it } from 'vitest';
import { handleSync, handleSyncStatus, type SyncRow, type SyncStore } from './server/sync';
import { decryptState, EMPTY_SYNC, encryptState, generateCode, mergeStates, normalizeCode, syncId, syncOnce, type SyncSettings } from './sync';
import { addTask, deleteTask, toggleTask } from './mutate';
import { createEmptyState, type PlannerState } from './types';

function memoryStore(): SyncStore & { rows: Map<string, SyncRow> } {
  const rows = new Map<string, SyncRow>();
  return {
    rows,
    async get(id) {
      return rows.get(id) ?? null;
    },
    async put(id, base, ciphertext) {
      const current = rows.get(id);
      if ((base === 0 && current) || (base > 0 && current?.version !== base)) return null;
      const row = { version: (current?.version ?? 0) + 1, ciphertext, updated_at: new Date() };
      rows.set(id, row);
      return row;
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

/** A fetch that talks straight to the handler. */
function fakeFetch(store: SyncStore): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => handleSync(new Request(new URL(String(input), 'http://local'), init), store)) as typeof fetch;
}

const task = (title: string) => ({ title, priority: 'medium' as const, dueDate: null, dueTime: null, category: 'personal', note: '', goalId: null });
const CODE = 'ABCD-EFGH-JKMN-PQRS-TUVW';

describe('sync codes & crypto', () => {
  it('generates and normalises codes', () => {
    const code = generateCode();
    expect(code).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    expect(normalizeCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
    expect(normalizeCode('too-short')).toBeNull();
    expect(normalizeCode('OOOO-OOOO-OOOO-OOOO-OOOO')).toBeNull();
  });

  it('encrypts so the server never sees content, and needs the right code', async () => {
    const state = addTask(createEmptyState(), task('Secret dentist visit'), 't');
    const cipher = await encryptState(state, CODE);
    expect(cipher).not.toContain('dentist');
    expect(atob(cipher)).not.toContain('dentist');
    expect((await decryptState(cipher, CODE)).tasks[0].title).toBe('Secret dentist visit');
    await expect(decryptState(cipher, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')).rejects.toThrow();
    expect(await syncId(CODE)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('sync API handler', () => {
  it('reports configuration and requires a database', async () => {
    expect(await handleSyncStatus(new Request('http://x/api/sync/status'), undefined).json()).toEqual({ configured: false });
    const response = await handleSync(new Request('http://x/api/sync', { headers: { 'x-sync-id': 'a'.repeat(64) } }), null);
    expect(response.status).toBe(503);
    const evil = await handleSync(new Request('http://x/api/sync', { headers: { 'x-sync-id': 'a'.repeat(64), origin: 'https://evil.example' } }), memoryStore());
    expect(evil.status).toBe(403);
  });

  it('validates ids and bodies, and enforces versions', async () => {
    const store = memoryStore();
    const id = 'b'.repeat(64);
    expect((await handleSync(new Request('http://x/api/sync', { headers: { 'x-sync-id': 'nope' } }), store)).status).toBe(400);
    expect((await handleSync(new Request('http://x/api/sync', { headers: { 'x-sync-id': id } }), store)).status).toBe(404);
    const put = (base: number, ciphertext = 'QUJD') =>
      handleSync(new Request('http://x/api/sync', { method: 'PUT', headers: { 'x-sync-id': id }, body: JSON.stringify({ baseVersion: base, ciphertext }) }), store);
    expect((await put(0, '<script>')).status).toBe(400);
    expect((await (await put(0)).json()).version).toBe(1);
    const stale = await put(0);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { current: { version: number } }).current.version).toBe(1);
    expect((await put(1)).status).toBe(200);
    expect((await handleSync(new Request('http://x/api/sync', { method: 'DELETE', headers: { 'x-sync-id': id } }), store)).status).toBe(200);
    expect(store.rows.size).toBe(0);
  });
});

describe('two devices', () => {
  it('uploads, downloads, merges concurrent edits, and carries deletions', async () => {
    const store = memoryStore();
    const f = fakeFetch(store);
    let a: PlannerState = addTask(createEmptyState(), task('From laptop'), 'a1', '2026-09-27T08:00:00.000Z');
    let aSync: SyncSettings = { ...EMPTY_SYNC, code: CODE, dirty: true };
    let out = await syncOnce(a, aSync, f);
    aSync = out.settings;
    expect(aSync).toMatchObject({ version: 1, dirty: false });

    // Phone links with its own task → merged.
    let b: PlannerState = addTask(createEmptyState(), task('From phone'), 'b1', '2026-09-27T09:00:00.000Z');
    let bSync: SyncSettings = { ...EMPTY_SYNC, code: CODE, dirty: true };
    out = await syncOnce(b, bSync, f);
    b = out.state ?? b;
    bSync = out.settings;
    expect(b.tasks.map((item) => item.title).sort()).toEqual(['From laptop', 'From phone']);
    expect(bSync.version).toBe(2);

    // Laptop (clean) pulls the merged copy.
    out = await syncOnce(a, aSync, f);
    a = out.state ?? a;
    aSync = out.settings;
    expect(a.tasks).toHaveLength(2);

    // Laptop deletes, phone completes something else concurrently.
    a = deleteTask(a, 'b1');
    aSync = { ...aSync, dirty: true };
    out = await syncOnce(a, aSync, f);
    aSync = out.settings;
    b = toggleTask(b, 'a1', '2026-09-27T10:00:00.000Z');
    bSync = { ...bSync, dirty: true };
    out = await syncOnce(b, bSync, f); // conflict → merge → push
    b = out.state ?? b;
    bSync = out.settings;
    expect(b.tasks.find((item) => item.id === 'a1')?.completed).toBe(true);
    expect(bSync.dirty).toBe(false);

    // A clean device simply adopts the server copy.
    out = await syncOnce(a, aSync, f);
    expect(out.state?.tasks.find((item) => item.id === 'a1')?.completed).toBe(true);
  });

  it('merge prefers the most recently edited copy of an item', () => {
    const base = addTask(createEmptyState(), task('Old title'), 'x', '2026-01-01T00:00:00.000Z');
    const newer = { ...base, tasks: [{ ...base.tasks[0], title: 'New title', updatedAt: '2026-02-01T00:00:00.000Z' }] };
    expect(mergeStates(base, newer).tasks[0].title).toBe('New title');
    expect(mergeStates(newer, base).tasks[0].title).toBe('New title');
  });
});
