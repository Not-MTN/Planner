/**
 * Standalone encryption envelope for external projects.
 *
 * Deliberately imports nothing from the app: a home server, a dashboard or a
 * bot can copy this one file and speak the planner's wire format. The layout
 * is the same one `src/auth/crypto.ts` uses — `base64(iv || ciphertext)` with
 * AES-256-GCM and a 12-byte IV — so blobs are interchangeable byte for byte.
 * `plannerClient.test.ts` proves both directions against the app's own module.
 *
 * Runs anywhere WebCrypto exists: Node 20+, Bun, Deno, and modern browsers.
 */

function cryptoApi(): Crypto {
  const api = (globalThis as { crypto?: Crypto }).crypto;
  if (!api?.subtle) {
    throw new Error('WebCrypto is unavailable. Use Node 20+, Bun, Deno, or a modern browser.');
  }
  return api;
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Import the base64 256-bit key shown in Settings → Developer API. */
export async function importVaultKey(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64Key);
  if (raw.length !== 32) {
    throw new Error(`The vault key must decode to 32 bytes; got ${raw.length}.`);
  }
  return cryptoApi().subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt UTF-8 text into the planner's `base64(iv || ciphertext)` envelope. */
export async function encryptEnvelope(plaintext: string, key: CryptoKey): Promise<string> {
  const crypto = cryptoApi();
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const data = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(new ArrayBuffer(iv.length + cipher.length));
  out.set(iv);
  out.set(cipher, iv.length);
  return bytesToBase64(out);
}

/** Decrypt a `base64(iv || ciphertext)` envelope back to UTF-8 text. */
export async function decryptEnvelope(ciphertext: string, key: CryptoKey): Promise<string> {
  const bytes = base64ToBytes(ciphertext);
  if (bytes.length < 13) throw new Error('The ciphertext is too short to hold an IV and a tag.');
  const iv = bytes.subarray(0, 12);
  const data = bytes.subarray(12);
  const plain = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plain);
}
