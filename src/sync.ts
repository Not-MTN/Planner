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
import { AI_DECLINED_LIMIT, AI_PLAN_LIMIT, GOAL_ANSWERS_KEPT, PRAISE_KEPT } from './types';
import type { FixedCommitment, Goal, GoalAnswer, GuardianPlan, Habit, Note, Panels, PlannerEvent, PlannerState, Task } from './types';

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
 * Panels merge additively: turning a panel on anywhere turns it on everywhere,
 * and turning it off is only honoured when no device still has it on. (Both
 * panels are optional extras on top of the personal planner.)
 */
export function mergePanels(local: Panels, remote: Panels): Panels {
  const byId = <T extends { id: string }>(a: T[], b: T[]): T[] => byIdKey(a, b, (item) => item.id);
  const byIdKey = <T>(a: T[], b: T[], key: (item: T) => string): T[] => {
    const map = new Map<string, T>();
    for (const item of b) map.set(key(item), item);
    for (const item of a) map.set(key(item), item);
    return [...map.values()];
  };
  // Plans merge by id: the newer shape wins, but a tick on either device stays
  // ticked — progress should never be lost to a sync.
  const mergePlans = (a: GuardianPlan[], b: GuardianPlan[]): GuardianPlan[] => {
    const map = new Map<string, GuardianPlan>();
    for (const plan of [...b, ...a]) {
      const other = map.get(plan.id);
      if (!other) {
        map.set(plan.id, plan);
        continue;
      }
      const newer = (plan.updatedAt ?? '') >= (other.updatedAt ?? '') ? plan : other;
      const older = newer === plan ? other : plan;
      const done = new Set(older.items.filter((item) => item.done).map((item) => item.id));
      map.set(plan.id, {
        ...newer,
        items: newer.items.map((item) => (done.has(item.id) ? { ...item, done: true } : item)),
      });
    }
    return [...map.values()];
  };
  return {
    student: {
      enabled: local.student.enabled || remote.student.enabled,
      field: local.student.field ?? remote.student.field,
      grade: local.student.grade ?? remote.student.grade,
      guardians: byIdKey(local.student.guardians ?? [], remote.student.guardians ?? [], (item) => item.linkId).slice(0, 20),
      subjects: byId(local.student.subjects, remote.student.subjects).slice(0, 40),
      explanations: byId(local.student.explanations, remote.student.explanations)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200),
      inbox: {
        notices: byId(local.student.inbox?.notices ?? [], remote.student.inbox?.notices ?? [])
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 20),
        plans: mergePlans(local.student.inbox?.plans ?? [], remote.student.inbox?.plans ?? [])
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 10),
        goals: byId(local.student.inbox?.goals ?? [], remote.student.inbox?.goals ?? [])
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 10),
      },
      // Two devices should not disagree about which kind words were kept.
      goalAnswers: byIdKey(
        local.student.goalAnswers ?? [],
        remote.student.goalAnswers ?? [],
        (item: GoalAnswer) => item.suggestionId,
      ).slice(0, GOAL_ANSWERS_KEPT),
      praise: byId(local.student.praise ?? [], remote.student.praise ?? [])
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, PRAISE_KEPT),
    },
    guardian: {
      enabled: local.guardian.enabled || remote.guardian.enabled,
      kind: local.guardian.kind ?? remote.guardian.kind,
      field: local.guardian.field ?? remote.guardian.field,
      links: byId(local.guardian.links, remote.guardian.links)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, 20),
      notices: byId(local.guardian.notices ?? [], remote.guardian.notices ?? [])
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20),
    },
  };
}

/** The kinds of thing two devices can disagree about. */
export type ConflictKind = 'task' | 'event' | 'commitment' | 'note' | 'goal' | 'habit';

/**
 * One thing that two devices both changed.
 *
 * Merging has to pick a winner — there is no way to combine two edited versions
 * of the same sentence. But picking a winner is not the same as being right, so
 * the version that lost is kept whole and shown. Losing an edit silently is how
 * people stop trusting sync; being shown "your phone had this, your laptop had
 * that, which did you mean?" is how they start again.
 */
export interface MergeConflict {
  kind: ConflictKind;
  /** What it is called, which is the only way a person can tell two versions apart. */
  title: string;
  /** When the version that lost was edited. */
  lostAt: string;
  /** The version that lost, kept exactly as it was so putting it back is exact. */
  item: Task | PlannerEvent | FixedCommitment | Note | Goal | Habit;
}

/** How many disagreements are worth showing. Past this, keep the most recent. */
export const CONFLICT_LIMIT = 20;

/** An item as it was written, without the moment it was written. */
function shapeOf(item: Stamped): string {
  return JSON.stringify(item, (key, value) => (key === 'updatedAt' ? undefined : value));
}

function editedSince(item: Stamped, since: string | null): boolean {
  if (!since) return false;
  return (item.updatedAt ?? '') > since;
}

/**
 * The things both devices changed since they last agreed.
 *
 * `since` is the moment of the last successful sync. Without it there is nothing
 * to compare against — two copies simply "differ" — and every item would look
 * contested, which would be noise rather than help.
 */
export function findMergeConflicts(local: PlannerState, remote: PlannerState, since: string | null): MergeConflict[] {
  if (!since) return [];
  const found: MergeConflict[] = [];

  const compare = (
    kind: ConflictKind,
    mine: Stamped[],
    theirs: Stamped[],
    nameOf: (item: Record<string, unknown>) => string,
  ): void => {
    const other = new Map(theirs.map((item) => [item.id, item]));
    for (const localItem of mine) {
      const remoteItem = other.get(localItem.id);
      if (!remoteItem) continue;
      if (!editedSince(localItem, since) || !editedSince(remoteItem, since)) continue;
      // The edit times always differ; that is not a disagreement. Only the
      // contents are compared, so two identical edits stay quiet.
      if (shapeOf(localItem) === shapeOf(remoteItem)) continue;
      // Keep the one the merge throws away, which is the older of the two.
      const loser = (localItem.updatedAt ?? '') >= (remoteItem.updatedAt ?? '') ? remoteItem : localItem;
      found.push({
        kind,
        title: nameOf(loser as unknown as Record<string, unknown>),
        lostAt: loser.updatedAt ?? '',
        item: loser as MergeConflict['item'],
      });
    }
  };

  const named = (item: Record<string, unknown>): string =>
    typeof item.title === 'string' ? item.title : typeof item.name === 'string' ? item.name : '';

  compare('task', local.tasks, remote.tasks, named);
  compare('event', local.events, remote.events, named);
  compare('commitment', local.fixedCommitments, remote.fixedCommitments, named);
  compare('note', local.notes, remote.notes, named);
  compare('goal', local.goals, remote.goals, named);
  compare('habit', local.habits, remote.habits, named);

  return found.sort((a, b) => b.lostAt.localeCompare(a.lostAt)).slice(0, CONFLICT_LIMIT);
}

/** Put a version back that lost a merge. It is stamped now, so it wins the next round. */
export function restoreConflict(state: PlannerState, conflict: MergeConflict, now = new Date().toISOString()): PlannerState {
  const put = <T extends Stamped>(items: T[], item: T): T[] => {
    const next = items.some((existing) => existing.id === item.id)
      ? items.map((existing) => (existing.id === item.id ? item : existing))
      : [...items, item];
    return next;
  };
  const stamp = { ...(conflict.item as Stamped), updatedAt: now } as Task &
    PlannerEvent &
    FixedCommitment &
    Note &
    Goal &
    Habit;
  switch (conflict.kind) {
    case 'task':
      return { ...state, tasks: put(state.tasks, stamp) };
    case 'event':
      return { ...state, events: put(state.events, stamp) };
    case 'commitment':
      return { ...state, fixedCommitments: put(state.fixedCommitments, stamp) };
    case 'note':
      return { ...state, notes: put(state.notes, stamp) };
    case 'goal':
      return { ...state, goals: put(state.goals, stamp) };
    case 'habit':
      return { ...state, habits: put(state.habits, stamp) };
  }
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
  // Day moods: one entry per date, the newest check-in wins.
  const moods = new Map(remote.moods.map((item) => [item.date, item]));
  for (const item of local.moods) {
    const existing = moods.get(item.date);
    if (!existing || existing.updatedAt <= item.updatedAt) moods.set(item.date, item);
  }
  const habits = mergeById(local.habits, remote.habits);
  const habitIds = new Set(habits.map((habit) => habit.id));
  return {
    panels: mergePanels(local.panels, remote.panels),
    tasks: mergeById(local.tasks, remote.tasks),
    events: mergeById(local.events, remote.events),
    fixedCommitments: mergeById(local.fixedCommitments, remote.fixedCommitments),
    aiMemory: mergeById(local.aiMemory, remote.aiMemory),
    // Declined on one device means declined on all of them: the point is that
    // it stops being suggested, and a stale copy would bring it straight back.
    aiDeclined: mergeById(local.aiDeclined, remote.aiDeclined)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(-AI_DECLINED_LIMIT),
    aiPlans: mergeById(local.aiPlans, remote.aiPlans)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, AI_PLAN_LIMIT),
    habits,
    completions: [...completions.values()].filter((item) => habitIds.has(item.habitId)),
    goals: mergeById(local.goals, remote.goals),
    notes: mergeById(local.notes, remote.notes),
    moods: [...moods.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-2000),
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
  /** Things both devices had changed, whose losing versions are worth showing. */
  conflicts: MergeConflict[];
}

/**
 * One full sync round: pull, reconcile, push if needed. Pure apart from network,
 * so it's easy to test with a fake fetch.
 */
export async function syncOnce(local: PlannerState, settings: SyncSettings, fetchImpl: typeof fetch = fetch, now = () => new Date().toISOString()): Promise<SyncOutcome> {
  const code = settings.code;
  if (!code) return { state: null, settings, conflicts: [] };
  let remote = await pullRemote(code, fetchImpl);
  let working = local;
  let changed = false;
  const conflicts: MergeConflict[] = [];
  let version = settings.version;
  const dirty = settings.dirty;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (remote && remote.version !== version) {
      const remoteState = await decryptState(remote.ciphertext, code);
      // Merge only when this device has unsent edits; otherwise take the server copy so deletions carry over.
      // Both copies edited is the only case where something can be lost, so it
      // is the only case where the losing versions are collected.
      if (dirty) conflicts.push(...findMergeConflicts(working, remoteState, settings.lastSyncedAt));
      working = dirty ? mergeStates(working, remoteState) : remoteState;
      changed = true;
      version = remote.version;
    }
    if (!dirty && remote) {
      return { state: changed ? working : null, settings: { ...settings, version, dirty: false, lastSyncedAt: now() }, conflicts };
    }
    try {
      const saved = await pushRemote(code, remote ? version : 0, await encryptState(working, code), fetchImpl);
      return { state: changed ? working : null, settings: { ...settings, version: saved.version, dirty: false, lastSyncedAt: now() }, conflicts };
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
