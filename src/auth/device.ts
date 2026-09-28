/**
 * Trusted-device cache for the vault key.
 *
 * "Remember this device" is what makes the planner open offline: once the key
 * has been unlocked with a password, it is wrapped for this browser and stored
 * in IndexedDB so the next visit needs no network and no typing.
 *
 * How it is protected:
 * - The wrapping key is a non-extractable AES-GCM CryptoKey held in IndexedDB.
 *   Its bytes are never visible to JavaScript, so a copy of the database does
 *   not hand over the key material.
 * - The cached copy is scoped to one account id and removed on sign-out.
 * - It is a browser-local convenience, not a vault: anyone who can run code in
 *   this origin on this device can unlock the planner. That is the same trust
 *   you already place in the browser profile, which is why it is opt-in and why
 *   signing out clears it.
 */

const DB_NAME = 'planner-auth';
const STORE = 'device';
const KEY_HANDLE = 'device-key';
const WRAP_PREFIX = 'wrapped:';

/** Copies bytes into a plain ArrayBuffer, which the WebCrypto types require. */
function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

export function deviceCacheSupported(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && Boolean(crypto.subtle);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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

/** Get or create the device's non-extractable wrapping key. */
async function deviceKey(): Promise<CryptoKey> {
  try {
    const existing = await run('readonly', (store) => store.get(KEY_HANDLE) as IDBRequest<unknown>);
    if (existing instanceof CryptoKey) return existing;
  } catch {
    /* fall through and create one */
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  try {
    await run('readwrite', (store) => store.put(key, KEY_HANDLE) as unknown as IDBRequest<unknown>);
  } catch {
    /* caching is best-effort; the key still works for this session */
  }
  return key;
}

/** Stores the vault key for this account so the next visit opens without a password. */
export async function rememberOnDevice(userId: string, rawKey: Uint8Array<ArrayBuffer>): Promise<boolean> {
  if (!deviceCacheSupported()) return false;
  try {
    const key = await deviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, rawKey));
    const out = new Uint8Array(iv.length + cipher.length);
    out.set(iv);
    out.set(cipher, iv.length);
    await run('readwrite', (store) => store.put(out, WRAP_PREFIX + userId) as unknown as IDBRequest<unknown>);
    return true;
  } catch {
    return false;
  }
}

/** Returns the cached vault key, or null when this device was not trusted. */
export async function recallFromDevice(userId: string): Promise<CryptoKey | null> {
  if (!deviceCacheSupported()) return null;
  try {
    const stored = await run('readonly', (store) => store.get(WRAP_PREFIX + userId) as IDBRequest<unknown>);
    if (!(stored instanceof Uint8Array) || stored.length < 13) return null;
    const key = await deviceKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBuffer(stored.subarray(0, 12)) }, key, toBuffer(stored.subarray(12)));
    return crypto.subtle.importKey('raw', plain, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

/** Clears one account's cache, or everything when no id is given. */
export async function forgetDevice(userId?: string): Promise<void> {
  if (!deviceCacheSupported()) return;
  try {
    if (userId) {
      await run('readwrite', (store) => store.delete(WRAP_PREFIX + userId) as unknown as IDBRequest<unknown>);
      return;
    }
    await run('readwrite', (store) => store.clear() as unknown as IDBRequest<unknown>);
  } catch {
    /* nothing cached, or storage unavailable */
  }
}
