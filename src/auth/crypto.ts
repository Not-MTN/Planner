/**
 * Browser-side key handling for accounts.
 *
 *   password ──Argon2id(salt)──┬──> authToken (32B) → sent to the server
 *                              └──> KEK (32B)       → never leaves the browser
 *
 *   DEK (random 32B) encrypts the planner, and is stored twice on the server —
 *   once wrapped by the KEK, once wrapped by a key derived from the recovery
 *   key. The server can hand both back but can open neither.
 *
 * Argon2id runs from @noble/hashes (pure JavaScript) rather than WebAssembly so
 * the strict `script-src 'self'` content security policy stays intact.
 */
import { argon2idAsync } from '@noble/hashes/argon2';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { PlannerState } from '../types';

/** ~1 second and 32 MiB on a modern laptop; memory is the expensive part for an attacker. */
export const KDF_PARAMS = { m: 32768, t: 2, p: 1, dkLen: 64 } as const;

const RECOVERY_INFO = 'planner-recovery-v1';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export class VaultError extends Error {}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Bytes backed by a plain ArrayBuffer, which the WebCrypto types require. */
function randomBuffer(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Copies bytes into a plain ArrayBuffer, as the WebCrypto types require. */
function copyToBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

export function newSalt(): string {
  return toBase64(randomBuffer(16));
}

function importAes(raw: Uint8Array<ArrayBuffer>, extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

/**
 * Splits the Argon2id output: the first half authenticates, the second half
 * decrypts. The same bytes never serve both purposes.
 */
export async function deriveFromPassword(password: string, salt: string): Promise<{ authToken: string; kek: CryptoKey }> {
  const saltBytes = fromBase64(salt);
  if (saltBytes.length < 16) throw new VaultError('The KDF salt is too short.');
  const out = await argon2idAsync(new TextEncoder().encode(password.normalize('NFKC')), saltBytes, KDF_PARAMS);
  const authToken = toBase64(out.subarray(0, 32));
  const kek = await importAes(copyToBuffer(out.subarray(32)), false);
  out.fill(0);
  return { authToken, kek };
}

export async function keyFromRecovery(recoveryKey: string, salt: string): Promise<CryptoKey> {
  const material = hkdf(
    sha256,
    new TextEncoder().encode(normalizeRecoveryKey(recoveryKey) ?? recoveryKey.trim().toUpperCase()),
    fromBase64(salt),
    new TextEncoder().encode(RECOVERY_INFO),
    32,
  );
  return importAes(copyToBuffer(material), false);
}

export function formatRecoveryKey(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const chars = Array.from(random(new Uint8Array(20)), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `plnr-${chars.match(/.{4}/g)!.join('-')}`;
}

/** Accepts the key with or without spaces, dashes, and in either case. */
export function normalizeRecoveryKey(input: string): string | null {
  const clean = input.trim().toUpperCase().replace(/^PLNR[-\s]*/, '').replace(/[\s-]/g, '');
  if (clean.length !== 20 || [...clean].some((char) => !ALPHABET.includes(char))) return null;
  return `plnr-${clean.match(/.{4}/g)!.join('-')}`;
}

/** Returns the usable (non-extractable) DEK plus its two wrapped copies. */
export async function createVaultKeys(password: string, recoveryKey: string) {
  const salt = newSalt();
  const { authToken, kek } = await deriveFromPassword(password, salt);
  const recoveryKek = await keyFromRecovery(recoveryKey, salt);

  const raw = randomBuffer(32);
  const wrappingKey = await importAes(raw, true);
  const wrappedDek = await wrapKey(wrappingKey, kek);
  const wrappedRecovery = await wrapKey(wrappingKey, recoveryKek);
  const dek = await importAes(raw, false);
  // Kept only so the caller can re-wrap the key for a trusted device; the live
  // copy below is cleared, and this one should be too as soon as it is used.
  const dekRaw = copyToBuffer(raw);
  raw.fill(0);

  return { salt, authToken, dek, dekRaw, wrappedDek, wrappedRecovery };
}

export async function wrapKey(key: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, raw));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return toBase64(out);
}

/** Returns the raw key bytes. Only used to re-wrap the key for a device. */
export async function unwrapKeyRaw(wrapped: string, wrappingKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = fromBase64(wrapped);
  if (bytes.length < 13) throw new VaultError('That wrapped key is not valid.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, wrappingKey, bytes.subarray(12));
  return copyToBuffer(new Uint8Array(plain));
}

export async function importDek(raw: Uint8Array<ArrayBuffer>, extractable = false): Promise<CryptoKey> {
  const key = await importAes(raw, extractable);
  raw.fill(0);
  return key;
}

export async function unwrapKey(wrapped: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  return importDek(await unwrapKeyRaw(wrapped, wrappingKey), false);
}

export async function encryptState(state: PlannerState, dek: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(state));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, data));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return toBase64(out);
}

export async function decryptState(ciphertext: string, dek: CryptoKey): Promise<PlannerState> {
  const bytes = fromBase64(ciphertext);
  if (bytes.length < 13) throw new VaultError('That vault is not valid.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, dek, bytes.subarray(12));
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
  if (!parsed || typeof parsed !== 'object') throw new VaultError('That vault is not valid.');
  return parsed as PlannerState;
}
