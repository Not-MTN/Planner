/**
 * Test-only simulated authenticator. Produces registration and assertion
 * responses that satisfy the real `verifyRegistration`/`verifyAssertion`
 * checks — real P-256 keys, real signatures over `authData || SHA-256(clientData)`,
 * real CBOR attestation. Nothing in application code imports this file; it
 * exists so the server round-trip and jsdom journey tests can exercise the
 * ceremony without a browser or a security key.
 */
import { createHash } from 'node:crypto';
import { cborEncode, toBase64Url } from './webauthn';

export const SIM_ORIGIN = 'https://planner.test';
export const SIM_RP_ID = 'planner.test';

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface SimCredential {
  id: string;
  rawId: Uint8Array;
  privateKey: CryptoKey;
  /** 65-byte uncompressed point. */
  publicKeyRaw: Uint8Array;
}

export async function simCreateCredential(): Promise<SimCredential> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const rawId = crypto.getRandomValues(new Uint8Array(32));
  return { id: toBase64Url(rawId), rawId, privateKey: pair.privateKey, publicKeyRaw };
}

function clientDataJSON(type: string, challenge: string, origin: string = SIM_ORIGIN): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function rpIdHash(): Uint8Array {
  return new Uint8Array(createHash('sha256').update(SIM_RP_ID).digest());
}

function authenticatorData(flags: number, counter: number, credential?: SimCredential): Uint8Array {
  const hash = rpIdHash();
  const size = 37 + (credential ? 2 + credential.rawId.length : 0);
  const withKey = credential ? cborEncode(coseKey(credential.publicKeyRaw)) : new Uint8Array(0);
  const out = new Uint8Array(size + (credential ? withKey.length : 0));
  out.set(hash, 0);
  out[32] = flags;
  new DataView(out.buffer).setUint32(33, counter);
  if (credential) {
    new DataView(out.buffer).setUint16(37, credential.rawId.length);
    out.set(credential.rawId, 39);
    out.set(withKey, 39 + credential.rawId.length);
  }
  return out;
}

function coseKey(publicKeyRaw: Uint8Array): Map<number, number | Uint8Array> {
  return new Map<number, number | Uint8Array>([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, publicKeyRaw.slice(1, 33)],
    [-3, publicKeyRaw.slice(33, 65)],
  ]);
}

/** A browser's `credentials.create()` result, verbatim fields the server reads. */
export async function simRegistrationResponse(
  credential: SimCredential,
  challenge: string,
  origin: string = SIM_ORIGIN,
): Promise<{ id: string; rawId: Uint8Array; clientDataJSON: Uint8Array; attestationObject: Uint8Array }> {
  const authData = authenticatorData(FLAG_UP | FLAG_UV | FLAG_AT, 0, credential);
  const attestationObject = cborEncode(
    new Map<unknown, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map<unknown, unknown>()],
      ['authData', authData],
    ]),
  );
  return {
    id: credential.id,
    rawId: credential.rawId,
    clientDataJSON: clientDataJSON('webauthn.create', challenge, origin),
    attestationObject,
  };
}

/** A browser's `credentials.get()` result, verbatim fields the server reads. */
export async function simAssertionResponse(
  credential: SimCredential,
  challenge: string,
  counter: number,
): Promise<{ clientDataJSON: Uint8Array; authenticatorData: Uint8Array; signature: Uint8Array }> {
  const clientData = clientDataJSON('webauthn.get', challenge);
  const authData = authenticatorData(FLAG_UP | FLAG_UV, counter);
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(clientData)));
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData, 0);
  signed.set(clientHash, authData.length);
  // WebCrypto's ECDSA output is raw r||s (64 bytes) — the format the server accepts.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, credential.privateKey, signed));
  return { clientDataJSON: clientData, authenticatorData: authData, signature };
}
