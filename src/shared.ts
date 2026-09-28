/**
 * Shared space — one extra, deliberately small sync room.
 *
 * Items whose category is "shared" (tasks, events, notes) sync to a second
 * encrypted copy on the same /api/sync storage, keyed by a different id and
 * encrypted with a key derived from its own code. Share that room code with a
 * partner and anything placed in the Shared category shows up on both sides.
 *
 * - id  = SHA-256("planner-shared-id:" + code)  → a different row than device sync
 * - key = PBKDF2(code, "planner-shared-v1")     → again, server stores ciphertext only
 * The rest of the planner never leaves the device unless device sync is on too.
 *
 * Deletions are carried by tombstones (id → when), because merges grow-only.
 */
import { sanitizeState } from './storage';
import { createEmptyState, type Note, type PlannerEvent, type PlannerState, type Task } from './types';
import { SyncError, normalizeCode } from './sync';

/** Same 20-character format as device sync, kept as its own export for clarity. */
export function normalizeSharedCode(input: string): string | null {
  return normalizeCode(input);
}

const SETTINGS_KEY = 'planner-shared';
const TOMBSTONES_KEY = 'planner-shared-tombstones';
const SALT = new TextEncoder().encode('planner-shared-v1');
const ITERATIONS = 150_000;

export const SHARED_CATEGORY = 'shared';

export interface SharedSettings {
  code: string | null;
  version: number;
  dirty: boolean;
  lastSyncedAt: string | null;
}

export const EMPTY_SHARED: SharedSettings = { code: null, version: 0, dirty: false, lastSyncedAt: null };

export function loadSharedSettings(): SharedSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<SharedSettings> | null;
    if (!raw || typeof raw !== 'object') return EMPTY_SHARED;
    return {
      code: typeof raw.code === 'string' && raw.code.length === 24 ? raw.code : null,
      version: typeof raw.version === 'number' && raw.version >= 0 ? Math.floor(raw.version) : 0,
      dirty: raw.dirty === true,
      lastSyncedAt: typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : null,
    };
  } catch {
    return EMPTY_SHARED;
  }
}

export function saveSharedSettings(settings: SharedSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export type Tombstones = Record<string, string>;

export function loadTombstones(): Tombstones {
  try {
    const raw = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Tombstones = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (/^(task|event|note):[^:]{1,100}$/.test(key) && typeof value === 'string') out[key] = value.slice(0, 40);
    }
    return out;
  } catch {
    return {};
  }
}

export function saveTombstones(tombstones: Tombstones): void {
  try {
    // Keep the map bounded: oldest entries fade after 2000.
    const entries = Object.entries(tombstones).sort(([, a], [, b]) => b.localeCompare(a)).slice(0, 2000);
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* ignore */
  }
}

export function tombstoneKey(type: 'task' | 'event' | 'note', id: string): string {
  return `${type}:${id}`;
}

// ── Crypto (mirrors sync.ts with its own salt & id prefix) ───────────────

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sharedId(code: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`planner-shared-id:${code}`)));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveSharedKey(code: string): Promise<CryptoKey> {
  let key = keyCache.get(code);
  if (!key) {
    key = crypto.subtle
      .importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'])
      .then((material) =>
        crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      );
    keyCache.set(code, key);
  }
  return key;
}

export interface SharedPayload {
  version: 1;
  exportedAt: string;
  tasks: Task[];
  events: PlannerEvent[];
  notes: Note[];
  tombstones: Tombstones;
}

/** Notes travel when they carry the #shared tag (notes have no category field). */
export function isSharedNote(note: Note): boolean {
  return /#shared\b/i.test(`${note.title} ${note.body}`);
}

export function sharedItems(state: PlannerState): { tasks: Task[]; events: PlannerEvent[]; notes: Note[] } {
  return {
    tasks: state.tasks.filter((task) => task.category === SHARED_CATEGORY),
    events: state.events.filter((event) => event.category === SHARED_CATEGORY),
    notes: state.notes.filter(isSharedNote),
  };
}

async function encryptPayload(payload: SharedPayload, code: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveSharedKey(code), data));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return toBase64(out);
}

async function decryptPayload(ciphertext: string, code: string): Promise<SharedPayload> {
  const bytes = fromBase64(ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12) },
    await deriveSharedKey(code),
    bytes.subarray(12),
  );
  const raw = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
  // Sanitize through the main pipeline: craft a full state, keep what we need.
  const state = sanitizeState({ tasks: raw.tasks, events: raw.events, notes: raw.notes });
  const tombstones: Tombstones = {};
  if (raw.tombstones && typeof raw.tombstones === 'object' && !Array.isArray(raw.tombstones)) {
    for (const [key, value] of Object.entries(raw.tombstones as Record<string, unknown>)) {
      if (/^(task|event|note):[^:]{1,100}$/.test(key) && typeof value === 'string') tombstones[key] = value.slice(0, 40);
    }
  }
  return {
    version: 1,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date(0).toISOString(),
    tasks: state?.tasks ?? [],
    events: state?.events ?? [],
    notes: state?.notes ?? [],
    tombstones,
  };
}

// ── Merge ────────────────────────────────────────────────────────────────

function mergeById<T extends { id: string; updatedAt?: string }>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of remote) map.set(item.id, item);
  for (const item of local) {
    const other = map.get(item.id);
    if (!other || (item.updatedAt ?? '') >= (other.updatedAt ?? '')) map.set(item.id, item);
  }
  return [...map.values()];
}

function dropTombstoned<T extends { id: string; updatedAt: string }>(items: T[], type: 'task' | 'event' | 'note', tombstones: Tombstones): T[] {
  return items.filter((item) => {
    const deleted = tombstones[tombstoneKey(type, item.id)];
    return deleted === undefined || deleted < item.updatedAt;
  });
}

/** Remote shared items merged into the local state (local non-shared untouched). */
export function applySharedToState(state: PlannerState, payload: SharedPayload, tombstones: Tombstones): PlannerState {
  const tasks = dropTombstoned(mergeById(sharedItems(state).tasks, payload.tasks), 'task', tombstones);
  const events = dropTombstoned(mergeById(sharedItems(state).events, payload.events), 'event', tombstones);
  const notes = dropTombstoned(mergeById(sharedItems(state).notes, payload.notes), 'note', tombstones);
  return {
    ...state,
    tasks: [...state.tasks.filter((task) => task.category !== SHARED_CATEGORY), ...tasks],
    events: [...state.events.filter((event) => event.category !== SHARED_CATEGORY), ...events],
    notes: [...state.notes.filter((note) => !isSharedNote(note)), ...notes],
  };
}

function mergeTombstones(local: Tombstones, remote: Tombstones): Tombstones {
  const out = { ...remote };
  for (const [key, value] of Object.entries(local)) {
    if (!out[key] || value > out[key]) out[key] = value;
  }
  return out;
}

// ── Network ──────────────────────────────────────────────────────────────

export interface SharedRemoteCopy {
  version: number;
  ciphertext: string;
  updatedAt: string;
}

async function readSharedError(response: Response): Promise<SyncError> {
  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string }; current?: SharedRemoteCopy | null };
    const code = response.status === 409 ? 'conflict' : body.error?.code === 'not_configured' ? 'not_configured' : 'other';
    return new SyncError(body.error?.message ?? `Sync failed (${response.status}).`, code, body.current ?? null);
  } catch {
    return new SyncError(`Sync failed (${response.status}).`, 'other');
  }
}

async function pullShared(code: string, fetchImpl: typeof fetch): Promise<SharedRemoteCopy | null> {
  let response: Response;
  try {
    response = await fetchImpl('/api/sync', { headers: { 'X-Sync-Id': await sharedId(code) }, cache: 'no-store' });
  } catch {
    throw new SyncError('You appear to be offline.', 'network');
  }
  if (response.status === 404) return null;
  if (!response.ok) throw await readSharedError(response);
  return (await response.json()) as SharedRemoteCopy;
}

async function pushShared(code: string, baseVersion: number, ciphertext: string, fetchImpl: typeof fetch): Promise<SharedRemoteCopy> {
  let response: Response;
  try {
    response = await fetchImpl('/api/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Id': await sharedId(code) },
      body: JSON.stringify({ baseVersion, ciphertext }),
    });
  } catch {
    throw new SyncError('You appear to be offline.', 'network');
  }
  if (!response.ok) throw await readSharedError(response);
  return (await response.json()) as SharedRemoteCopy;
}

export interface SharedOutcome {
  /** New local state when remote items changed it. */
  state: PlannerState | null;
  settings: SharedSettings;
  tombstones: Tombstones;
}

/** One shared-space sync round: pull, merge shared items, push when dirty. */
export async function syncSharedOnce(
  local: PlannerState,
  settings: SharedSettings,
  localTombstones: Tombstones,
  fetchImpl: typeof fetch = fetch,
  now = () => new Date().toISOString(),
): Promise<SharedOutcome> {
  const code = settings.code;
  if (!code) return { state: null, settings, tombstones: localTombstones };
  let remote = await pullShared(code, fetchImpl);
  let version = settings.version;
  let working = local;
  let tombstones = localTombstones;
  let changed = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (remote && remote.version !== version) {
      const payload = await decryptPayload(remote.ciphertext, code);
      tombstones = mergeTombstones(tombstones, payload.tombstones);
      working = applySharedToState(working, payload, tombstones);
      changed = true;
      version = remote.version;
    }
    if (!settings.dirty && remote && !changed) {
      return { state: null, settings: { ...settings, version, dirty: false, lastSyncedAt: now() }, tombstones };
    }
    const items = sharedItems(working);
    const payload: SharedPayload = { version: 1, exportedAt: now(), ...items, tombstones };
    try {
      const saved = await pushShared(code, remote ? version : 0, await encryptPayload(payload, code), fetchImpl);
      return { state: changed ? working : null, settings: { ...settings, version: saved.version, dirty: false, lastSyncedAt: now() }, tombstones };
    } catch (error) {
      if (error instanceof SyncError && error.code === 'conflict') {
        remote = error.current ?? (await pullShared(code, fetchImpl));
        continue;
      }
      throw error;
    }
  }
  throw new SyncError('Sync kept colliding with the other device. Try again.', 'conflict');
}

export { createEmptyState };
