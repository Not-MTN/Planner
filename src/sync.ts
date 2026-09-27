/**
 * Browser side of end-to-end encrypted sync.
 *
 * - A sync code (e.g. "K7QM-2XJD-9RTF-HB4W-PN6C") is the only secret. Enter it on
 *   another device to link it.
 * - id  = SHA-256("planner-sync-id:" + code)  → the database row key
 * - key = PBKDF2(code) → AES-GCM-256          → encrypts the whole planner
 * The server stores { id, version, ciphertext } and can't read anything.
 */
import { sanitizeState, serialize } from './storage';
import type { PlannerState } from './types';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const SETTINGS_KEY = 'planner-sync';
const SALT = new TextEncoder().encode('planner-sync-v1');
const ITERATIONS = 150_000;

export interface SyncSettings {
  code: string | null;
  /** Server version this device last matched. */
  version: number;
  /** True when local changes haven't been uploaded yet. */
  dirty: boolean;
  lastSyncedAt: string | null;
}

export const EMPTY_SYNC: SyncSettings = { code: null, version: 0, dirty: false, lastSyncedAt: null };

export function loadSyncSettings(): SyncSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<SyncSettings> | null;
    if (!raw || typeof raw !== 'object') return EMPTY_SYNC;
    return {
      code: typeof raw.code === 'string' && normalizeCode(raw.code) ? normalizeCode(raw.code) : null,
      version: typeof raw.version === 'number' && raw.version >= 0 ? Math.floor(raw.version) : 0,
      dirty: raw.dirty === true,
      lastSyncedAt: typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : null,
    };
  } catch {
    return EMPTY_SYNC;
  }
}

export function saveSyncSettings(settings: SyncSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function generateCode(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(20));
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

/** Uppercases, strips spaces/dashes, validates, and re-groups. Returns null if invalid. */
export function normalizeCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '');
  if (clean.length !== 20 || [...clean].some((char) => !ALPHABET.includes(char))) return null;
  return clean.match(/.{4}/g)!.join('-');
}

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

export async function syncId(code: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`planner-sync-id:${code}`)));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveKey(code: string): Promise<CryptoKey> {
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

export async function encryptState(state: PlannerState, code: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(serialize(state));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(code), data));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return toBase64(out);
}

export async function decryptState(ciphertext: string, code: string): Promise<PlannerState> {
  const bytes = fromBase64(ciphertext);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, await deriveKey(code), bytes.subarray(12));
  const state = sanitizeState(JSON.parse(new TextDecoder().decode(plain)) as unknown);
  if (!state) throw new Error('Synced data was unreadable.');
  return state;
}

type Stamped = { id: string; updatedAt?: string };

function mergeById<T extends Stamped>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of remote) map.set(item.id, item);
  for (const item of local) {
    const other = map.get(item.id);
    if (!other || (item.updatedAt ?? '') >= (other.updatedAt ?? '')) map.set(item.id, item);
  }
  return [...map.values()];
}

/**
 * Combines two diverged copies. Items are matched by id and the most recently
 * edited version wins. (Used only when both devices changed since the last sync;
 * otherwise the newer copy is taken as-is so deletions carry over.)
 */
export function mergeStates(local: PlannerState, remote: PlannerState): PlannerState {
  const completionKey = (item: { habitId: string; date: string }) => `${item.habitId}|${item.date}`;
  const completions = new Map<string, { habitId: string; date: string }>();
  for (const item of [...remote.completions, ...local.completions]) completions.set(completionKey(item), item);
  const focus = new Map(remote.focusLog.map((item) => [item.id, item]));
  for (const item of local.focusLog) focus.set(item.id, item);
  const habits = mergeById(local.habits, remote.habits);
  const habitIds = new Set(habits.map((habit) => habit.id));
  return {
    tasks: mergeById(local.tasks, remote.tasks),
    events: mergeById(local.events, remote.events),
    fixedCommitments: mergeById(local.fixedCommitments, remote.fixedCommitments),
    aiMemory: mergeById(local.aiMemory, remote.aiMemory),
    habits,
    completions: [...completions.values()].filter((item) => habitIds.has(item.habitId)),
    goals: mergeById(local.goals, remote.goals),
    notes: mergeById(local.notes, remote.notes),
    intentions: { ...remote.intentions, ...local.intentions },
    focusLog: [...focus.values()].sort((a, b) => a.endedAt.localeCompare(b.endedAt)).slice(-2000),
  };
}

export interface RemoteCopy {
  version: number;
  ciphertext: string;
  updatedAt: string;
}

export class SyncError extends Error {
  constructor(message: string, readonly code: 'not_configured' | 'conflict' | 'network' | 'other', readonly current?: RemoteCopy | null) {
    super(message);
  }
}

async function readError(response: Response): Promise<SyncError> {
  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string }; current?: RemoteCopy | null };
    const code = body.error?.code === 'not_configured' ? 'not_configured' : response.status === 409 ? 'conflict' : 'other';
    return new SyncError(body.error?.message ?? `Sync failed (${response.status}).`, code, body.current);
  } catch {
    return new SyncError(`Sync failed (${response.status}).`, 'other');
  }
}

export async function syncConfigured(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl('/api/sync/status', { cache: 'no-store' });
    if (!response.ok) return false;
    return ((await response.json()) as { configured?: boolean }).configured === true;
  } catch {
    return false;
  }
}

export async function pullRemote(code: string, fetchImpl: typeof fetch = fetch): Promise<RemoteCopy | null> {
  let response: Response;
  try {
    response = await fetchImpl('/api/sync', { headers: { 'X-Sync-Id': await syncId(code) }, cache: 'no-store' });
  } catch {
    throw new SyncError('You appear to be offline.', 'network');
  }
  if (response.status === 404) return null;
  if (!response.ok) throw await readError(response);
  return (await response.json()) as RemoteCopy;
}

export async function pushRemote(code: string, baseVersion: number, ciphertext: string, fetchImpl: typeof fetch = fetch): Promise<RemoteCopy> {
  let response: Response;
  try {
    response = await fetchImpl('/api/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Id': await syncId(code) },
      body: JSON.stringify({ baseVersion, ciphertext }),
    });
  } catch {
    throw new SyncError('You appear to be offline.', 'network');
  }
  if (!response.ok) throw await readError(response);
  return (await response.json()) as RemoteCopy;
}

export async function deleteRemote(code: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl('/api/sync', { method: 'DELETE', headers: { 'X-Sync-Id': await syncId(code) } });
  if (!response.ok) throw await readError(response);
}

export interface SyncOutcome {
  /** New local state, if it changed. */
  state: PlannerState | null;
  settings: SyncSettings;
}

/**
 * One full sync round: pull, reconcile, push if needed. Pure apart from network,
 * so it's easy to test with a fake fetch.
 */
export async function syncOnce(local: PlannerState, settings: SyncSettings, fetchImpl: typeof fetch = fetch, now = () => new Date().toISOString()): Promise<SyncOutcome> {
  const code = settings.code;
  if (!code) return { state: null, settings };
  let remote = await pullRemote(code, fetchImpl);
  let working = local;
  let changed = false;
  let version = settings.version;
  const dirty = settings.dirty;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (remote && remote.version !== version) {
      const remoteState = await decryptState(remote.ciphertext, code);
      // Merge only when this device has unsent edits; otherwise take the server copy so deletions carry over.
      working = dirty ? mergeStates(working, remoteState) : remoteState;
      changed = true;
      version = remote.version;
    }
    if (!dirty && remote) {
      return { state: changed ? working : null, settings: { ...settings, version, dirty: false, lastSyncedAt: now() } };
    }
    try {
      const saved = await pushRemote(code, remote ? version : 0, await encryptState(working, code), fetchImpl);
      return { state: changed ? working : null, settings: { ...settings, version: saved.version, dirty: false, lastSyncedAt: now() } };
    } catch (error) {
      if (error instanceof SyncError && error.code === 'conflict') {
        remote = error.current ?? (await pullRemote(code, fetchImpl));
        continue;
      }
      throw error;
    }
  }
  throw new SyncError('Sync kept colliding with another device. Try again.', 'conflict');
}
