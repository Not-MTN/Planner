/**
 * IndexedDB mirror of the planner. localStorage stays the fast, synchronous
 * primary copy; IndexedDB holds a second copy and takes over when localStorage
 * is full or wiped (e.g. Safari clearing it), since it allows far more data.
 */
const DB_NAME = 'planner';
const STORE = 'kv';
const KEY = 'state';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

/** Serialized planner JSON (the same format as backups). */
export async function idbRead(): Promise<string | null> {
  try {
    const value = await run('readonly', (store) => store.get(KEY) as IDBRequest<unknown>);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Writes are serialised so an older write can never land after a newer one. */
export function idbWrite(serialized: string): Promise<boolean> {
  const next = queue.then(
    () => run('readwrite', (store) => store.put(serialized, KEY)).then(() => true, () => false),
  );
  queue = next;
  return next;
}

export function idbClear(): Promise<boolean> {
  const next = queue.then(() => run('readwrite', (store) => store.delete(KEY)).then(() => true, () => false));
  queue = next;
  return next;
}

/** exportedAt of a serialized copy, for picking the newer of two. */
export function savedAt(serialized: string | null): string {
  if (!serialized) return '';
  const match = /"exportedAt":\s*"([^"]+)"/.exec(serialized.slice(0, 200));
  return match?.[1] ?? '';
}
