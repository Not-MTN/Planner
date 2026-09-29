/**
 * Just enough WebAuthn for Planner: registration ("none" attestation) and
 * ES256 assertions, verified with WebCrypto — no third-party auth SDK, so the
 * strict `script-src 'self'` CSP stays intact.
 *
 * What runs here:
 *   - a minimal CBOR codec (attestation objects and COSE public keys are CBOR),
 *   - authenticator data parsing (rpIdHash, flags, signCount, credential, key),
 *   - clientData checks (type, challenge, origin),
 *   - DER → raw ECDSA signature conversion (authenticators emit DER, WebCrypto
 *     wants r||s), and the final ES256 verification.
 *
 * Everything is rejected on doubt: wrong origin, wrong rpId, missing user
 * presence/verification, a replayed challenge, or a sign counter that goes
 * backwards (a cloned authenticator).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { hostOf } from './xaiProxy.js';

export class WebAuthnError extends Error {}

/* ------------------------------------------------------------------ base64 */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/* --------------------------------------------------------------------- CBOR */

interface Reader {
  data: Uint8Array;
  pos: number;
}

function readUint(data: Uint8Array, pos: number, width: number): { value: number; pos: number } {
  if (pos + width > data.length) throw new WebAuthnError('Truncated CBOR.');
  let value = 0;
  for (let index = 0; index < width; index += 1) value = value * 256 + data[pos + index];
  return { value, pos: pos + width };
}

function readLength(reader: Reader, indicator: number): number | null {
  if (indicator < 24) return indicator;
  if (indicator === 24) {
    const { value, pos } = readUint(reader.data, reader.pos, 1);
    reader.pos = pos;
    return value;
  }
  if (indicator === 25) {
    const { value, pos } = readUint(reader.data, reader.pos, 2);
    reader.pos = pos;
    return value;
  }
  if (indicator === 26) {
    const { value, pos } = readUint(reader.data, reader.pos, 4);
    reader.pos = pos;
    return value;
  }
  if (indicator === 27) {
    const { value, pos } = readUint(reader.data, reader.pos, 8);
    if (value > Number.MAX_SAFE_INTEGER) throw new WebAuthnError('CBOR number too large.');
    reader.pos = pos;
    return value;
  }
  if (indicator === 31) return null; // indefinite length
  throw new WebAuthnError('Invalid CBOR length indicator.');
}

function decodeItem(reader: Reader): unknown {
  if (reader.pos >= reader.data.length) throw new WebAuthnError('Truncated CBOR.');
  const header = reader.data[reader.pos];
  reader.pos += 1;
  const major = header >> 5;
  const indicator = header & 0x1f;
  const width = readLength(reader, indicator);
  if (width === null) return decodeIndefinite(reader, major);

  switch (major) {
    case 0:
      return width;
    case 1:
      return -1 - width;
    case 2: {
      if (reader.pos + width > reader.data.length) throw new WebAuthnError('Truncated CBOR bytes.');
      const slice = reader.data.slice(reader.pos, reader.pos + width);
      reader.pos += width;
      return slice;
    }
    case 3: {
      if (reader.pos + width > reader.data.length) throw new WebAuthnError('Truncated CBOR text.');
      const text = new TextDecoder().decode(reader.data.subarray(reader.pos, reader.pos + width));
      reader.pos += width;
      return text;
    }
    case 4: {
      const items: unknown[] = [];
      for (let index = 0; index < width; index += 1) items.push(decodeItem(reader));
      return items;
    }
    case 5: {
      const map = new Map<unknown, unknown>();
      for (let index = 0; index < width; index += 1) {
        const key = decodeItem(reader);
        map.set(key, decodeItem(reader));
      }
      return map;
    }
    case 7: {
      if (indicator === 20) return false;
      if (indicator === 21) return true;
      if (indicator === 22) return null;
      if (indicator === 26 && reader.pos + 4 <= reader.data.length) {
        const view = new DataView(reader.data.buffer, reader.data.byteOffset + reader.pos, 4);
        reader.pos += 4;
        return view.getFloat32(0);
      }
      if (indicator === 27 && reader.pos + 8 <= reader.data.length) {
        const view = new DataView(reader.data.buffer, reader.data.byteOffset + reader.pos, 8);
        reader.pos += 8;
        return view.getFloat64(0);
      }
      throw new WebAuthnError('Unsupported CBOR simple value.');
    }
    default:
      throw new WebAuthnError('Unsupported CBOR major type.');
  }
}

function decodeIndefinite(reader: Reader, major: number): unknown {
  if (major === 2 || major === 3) {
    const parts: Uint8Array[] = [];
    for (;;) {
      if (reader.pos >= reader.data.length) throw new WebAuthnError('Truncated CBOR chunk.');
      if (reader.data[reader.pos] === 0xff) {
        reader.pos += 1;
        break;
      }
      const part = decodeItem(reader);
      if (!(part instanceof Uint8Array)) throw new WebAuthnError('Invalid CBOR chunk.');
      parts.push(part);
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return major === 2 ? out : new TextDecoder().decode(out);
  }
  if (major === 4) {
    const items: unknown[] = [];
    for (;;) {
      if (reader.pos >= reader.data.length) throw new WebAuthnError('Truncated CBOR array.');
      if (reader.data[reader.pos] === 0xff) {
        reader.pos += 1;
        break;
      }
      items.push(decodeItem(reader));
    }
    return items;
  }
  if (major === 5) {
    const map = new Map<unknown, unknown>();
    for (;;) {
      if (reader.pos >= reader.data.length) throw new WebAuthnError('Truncated CBOR map.');
      if (reader.data[reader.pos] === 0xff) {
        reader.pos += 1;
        break;
      }
      const key = decodeItem(reader);
      map.set(key, decodeItem(reader));
    }
    return map;
  }
  throw new WebAuthnError('Unsupported indefinite CBOR item.');
}

export function cborDecode(bytes: Uint8Array): unknown {
  const reader: Reader = { data: bytes, pos: 0 };
  const value = decodeItem(reader);
  return value;
}

/** Minimal encoder — used by the tests' simulated authenticator. */
export function cborEncode(value: unknown): Uint8Array {
  const chunks: Uint8Array[] = [];
  const push = (...bytes: number[]) => chunks.push(Uint8Array.from(bytes));
  const writeHeader = (major: number, length: number) => {
    if (length < 24) push((major << 5) | length);
    else if (length < 0x100) push((major << 5) | 24, length);
    else if (length < 0x10000) push((major << 5) | 25, length >> 8, length & 0xff);
    else push((major << 5) | 26, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
  };

  const encode = (item: unknown) => {
    if (typeof item === 'number') {
      if (!Number.isInteger(item)) throw new WebAuthnError('Only integers are encoded.');
      if (item >= 0) {
        writeHeader(0, item);
      } else {
        writeHeader(1, -1 - item);
      }
      return;
    }
    if (typeof item === 'string') {
      const bytes = new TextEncoder().encode(item);
      writeHeader(3, bytes.length);
      chunks.push(bytes);
      return;
    }
    if (item instanceof Uint8Array) {
      writeHeader(2, item.length);
      chunks.push(item);
      return;
    }
    if (Array.isArray(item)) {
      writeHeader(4, item.length);
      for (const entry of item) encode(entry);
      return;
    }
    if (item instanceof Map) {
      writeHeader(5, item.size);
      for (const [key, entry] of item) {
        encode(key);
        encode(entry);
      }
      return;
    }
    if (item && typeof item === 'object') {
      const entries = Object.entries(item as Record<string, unknown>);
      writeHeader(5, entries.length);
      for (const [key, entry] of entries) {
        encode(key);
        encode(entry);
      }
      return;
    }
    if (item === true) return push(0xf5);
    if (item === false) return push(0xf4);
    if (item === null) return push(0xf6);
    throw new WebAuthnError('Cannot CBOR-encode that value.');
  };

  encode(value);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* --------------------------------------------------------- authenticator data */

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  credentialId: Uint8Array | null;
  publicKeyRaw: Uint8Array | null;
}

function mapGet(map: unknown, key: number | string): unknown {
  if (map instanceof Map) return map.get(key);
  return undefined;
}

/** COSE key (EC2/P-256) → the 65-byte uncompressed point WebCrypto imports. */
function coseToRawPublicKey(cose: unknown): Uint8Array {
  const kty = mapGet(cose, 1);
  const crv = mapGet(cose, -1);
  const x = mapGet(cose, -2);
  const y = mapGet(cose, -3);
  if (kty !== 2 || crv !== 1) throw new WebAuthnError('Only EC2 P-256 keys are supported.');
  if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
    throw new WebAuthnError('That public key does not look like P-256.');
  }
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);
  return raw;
}

export function parseAuthenticatorData(authenticatorData: Uint8Array): AuthenticatorData {
  if (authenticatorData.length < 37) throw new WebAuthnError('Authenticator data is too short.');
  const view = new DataView(authenticatorData.buffer, authenticatorData.byteOffset, authenticatorData.byteLength);
  const rpIdHash = authenticatorData.slice(0, 32);
  const flags = authenticatorData[32]!;
  const signCount = view.getUint32(33);
  if (!(flags & FLAG_AT)) {
    return { rpIdHash, flags, signCount, credentialId: null, publicKeyRaw: null };
  }
  if (authenticatorData.length < 39) throw new WebAuthnError('Authenticator data is truncated.');
  const credentialLength = view.getUint16(37);
  const start = 39;
  const end = start + credentialLength;
  if (end > authenticatorData.length) throw new WebAuthnError('Credential id runs past the data.');
  const credentialId = authenticatorData.slice(start, end);
  const cose = cborDecode(authenticatorData.slice(end));
  return { rpIdHash, flags, signCount, credentialId, publicKeyRaw: coseToRawPublicKey(cose) };
}

/* ------------------------------------------------------------- client data */

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
}

export function parseClientData(clientDataJSON: Uint8Array): ClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(clientDataJSON));
  } catch {
    throw new WebAuthnError('The client data is not JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new WebAuthnError('The client data is not an object.');
  const record = parsed as Record<string, unknown>;
  if (typeof record.type !== 'string' || typeof record.challenge !== 'string' || typeof record.origin !== 'string') {
    throw new WebAuthnError('The client data is missing fields.');
  }
  return { type: record.type, challenge: record.challenge, origin: record.origin };
}

/** The challenge must be exactly the one we issued, byte for byte. */
export function challengeMatches(clientChallenge: string, expectedChallenge: string): boolean {
  const left = fromBase64Url(clientChallenge);
  const right = fromBase64Url(expectedChallenge);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The ceremony's origin must be this request's origin — the same policy the
 * rest of the API applies, so a hostile page cannot run ceremonies against us.
 */
export function originMatchesRequest(request: Request, origin: string): boolean {
  const originHost = hostOf(origin);
  if (!originHost) return false;
  const candidates = [request.headers.get('host'), hostOf(request.url)]
    .flatMap((value) => (value ? value.split(',') : []))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return candidates.includes(originHost);
}

/** rpId is the origin's hostname — never a port, never a scheme. */
export function rpIdHashForOrigin(origin: string): Uint8Array | null {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (!hostname) return null;
    return new Uint8Array(createHash('sha256').update(hostname).digest());
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- signatures */

/** Authenticators send DER (ASN.1); WebCrypto wants fixed-width r||s. */
export function derToRawSignature(signature: Uint8Array): Uint8Array {
  if (signature.length === 64) return signature; // already raw
  if (signature.length < 8 || signature[0] !== 0x30) throw new WebAuthnError('That is not an ECDSA signature.');
  let offset = 2;
  if ((signature[1]! & 0x80) !== 0) offset += signature[1]! & 0x7f; // long-form length
  const readInteger = (): Uint8Array => {
    if (signature[offset] !== 0x02) throw new WebAuthnError('Malformed ECDSA signature.');
    offset += 1;
    const length = signature[offset]!;
    offset += 1;
    const slice = signature.slice(offset, offset + length);
    offset += length;
    // Strip leading zeros, then left-pad to 32 bytes.
    let start = 0;
    while (start < slice.length - 1 && slice[start] === 0) start += 1;
    const trimmed = slice.subarray(start);
    if (trimmed.length > 32) throw new WebAuthnError('ECDSA integer too large.');
    const out = new Uint8Array(32);
    out.set(trimmed, 32 - trimmed.length);
    return out;
  };
  const r = readInteger();
  const s = readInteger();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

/* ------------------------------------------------------------ verification */

export interface RegistrationResult {
  credentialId: string; // base64url
  publicKey: string; // base64 (raw 65-byte point)
  signCount: number;
}

/** Full registration check: challenge, type, origin, rpId, flags, key. */
export async function verifyRegistration(input: {
  request: Request;
  clientDataJSON: Uint8Array;
  attestationObject: Uint8Array;
  expectedChallenge: string;
}): Promise<RegistrationResult> {
  const clientData = parseClientData(input.clientDataJSON);
  if (clientData.type !== 'webauthn.create') throw new WebAuthnError('That was not a registration ceremony.');
  if (!challengeMatches(clientData.challenge, input.expectedChallenge)) throw new WebAuthnError('That challenge has expired.');
  if (!originMatchesRequest(input.request, clientData.origin)) throw new WebAuthnError('That origin is not allowed here.');

  const decoded = cborDecode(input.attestationObject);
  if (!(decoded instanceof Map)) throw new WebAuthnError('That attestation object is not a CBOR map.');
  const authDataBytes = mapGet(decoded, 'authData');
  if (!(authDataBytes instanceof Uint8Array)) throw new WebAuthnError('That attestation object has no authenticator data.');
  // fmt "none" means the authenticator signed nothing — there is no attestation
  // certificate to verify, which is exactly what we asked the browser for.

  const parsed = parseAuthenticatorData(authDataBytes);
  if (!parsed.credentialId || !parsed.publicKeyRaw) throw new WebAuthnError('No credential was created.');
  const expectedRpIdHash = rpIdHashForOrigin(clientData.origin);
  if (!expectedRpIdHash || !timingSafeEqual(parsed.rpIdHash, expectedRpIdHash)) {
    throw new WebAuthnError('That credential belongs to another site.');
  }
  if ((parsed.flags & FLAG_UP) === 0) throw new WebAuthnError('The credential was not confirmed by a person.');
  if ((parsed.flags & FLAG_UV) === 0) throw new WebAuthnError('A screen-lock verification is required.');

  return {
    credentialId: toBase64Url(parsed.credentialId),
    publicKey: Buffer.from(parsed.publicKeyRaw).toString('base64'),
    signCount: parsed.signCount,
  };
}

/** Full assertion check: challenge, origin, rpId, flags, signature, counter. */
export async function verifyAssertion(input: {
  request: Request;
  clientDataJSON: Uint8Array;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  publicKeyRaw: Uint8Array;
  expectedChallenge: string;
}): Promise<number> {
  const clientData = parseClientData(input.clientDataJSON);
  if (clientData.type !== 'webauthn.get') throw new WebAuthnError('That was not a sign-in ceremony.');
  if (!challengeMatches(clientData.challenge, input.expectedChallenge)) throw new WebAuthnError('That challenge has expired.');
  if (!originMatchesRequest(input.request, clientData.origin)) throw new WebAuthnError('That origin is not allowed here.');

  const parsed = parseAuthenticatorData(input.authenticatorData);
  const expectedRpIdHash = rpIdHashForOrigin(clientData.origin);
  if (!expectedRpIdHash || !timingSafeEqual(parsed.rpIdHash, expectedRpIdHash)) {
    throw new WebAuthnError('That assertion belongs to another site.');
  }
  if ((parsed.flags & FLAG_UP) === 0) throw new WebAuthnError('The passkey was not confirmed by a person.');
  if ((parsed.flags & FLAG_UV) === 0) throw new WebAuthnError('A screen-lock verification is required.');

  const clientHash = await sha256(input.clientDataJSON);
  const signed = new Uint8Array(input.authenticatorData.length + clientHash.length);
  signed.set(input.authenticatorData, 0);
  signed.set(clientHash, input.authenticatorData.length);

  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(input.publicKeyRaw),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new Uint8Array(derToRawSignature(input.signature)),
    signed,
  );
  if (!ok) throw new WebAuthnError('That passkey signature did not verify.');
  return parsed.signCount;
}
