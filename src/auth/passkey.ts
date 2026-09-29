/**
 * Browser side of passkeys: enrolment with a PRF-wrapped vault key, and
 * passwordless sign-in that unwraps it. Pure WebAuthn — no SDK, so the strict
 * `script-src 'self'` content security policy stays intact.
 *
 * Level 2 per SPEC: on PRF-capable browsers (Chrome, Edge, and platform
 * authenticators that expose the extension) the passkey itself derives the key
 * that opens the vault — a touch, no password. The PRF salt is a public,
 * fixed string; the secret is the credential's own PRF key material, which
 * never leaves the authenticator. Browsers without PRF never get a passkey
 * registered: a passkey that could only open a session (not the vault) would
 * be strictly worse than the password it replaces.
 */
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { PasskeyLoginResponse, PasskeyOptionsResponse, PublicUser } from '../shared/authContract';
import { importDek, toBase64, unwrapKeyRaw, wrapRawKey } from './crypto';
import { rememberOnDevice } from './device';
import { adoptSession, getActiveSession, request } from './session';

const RP_NAME = 'Planner';
/** Public by design — PRF output is unique per credential, so one salt is safe. */
const PRF_SALT = new TextEncoder().encode('planner-passkey-prf-v1');
const KEK_INFO = new TextEncoder().encode('planner-passkey-kek-v1');

export type PasskeyFailure = 'unsupported' | 'cancelled' | 'no_prf' | 'no_session' | 'rejected';

export class PasskeyError extends Error {
  readonly code: PasskeyFailure;
  constructor(code: PasskeyFailure) {
    super(code);
    this.code = code;
  }
}

interface PrfExtensionOutput {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

/** Modern browser, secure context, WebAuthn present. */
export function passkeysSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext === false) return false;
  return typeof PublicKeyCredential !== 'undefined' && Boolean(navigator.credentials?.create);
}

function isCancel(caught: unknown): boolean {
  return caught instanceof DOMException && (caught.name === 'NotAllowedError' || caught.name === 'AbortError');
}

function bytesFromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalised + '='.repeat((4 - (normalised.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

/** The vault key from the passkey's PRF output — same HKDF shape every time. */
async function kekFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const material = hkdf(sha256, new Uint8Array(prfOutput), new Uint8Array(), KEK_INFO, 32);
  return crypto.subtle.importKey('raw', new Uint8Array(material), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Opportunistically evaluate the PRF during create; fall back to one more touch. */
async function evaluatePrf(credential: PublicKeyCredential): Promise<ArrayBuffer | null> {
  const extension = (credential.getClientExtensionResults() as PrfExtensionOutput).prf;
  if (extension?.results?.first) return extension.results.first;
  if (!extension?.enabled) return null;
  try {
    const probe = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        allowCredentials: [{ id: credential.rawId, type: 'public-key' }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: PRF_SALT } } } as unknown as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    return ((probe?.getClientExtensionResults() as PrfExtensionOutput | undefined)?.prf?.results?.first) ?? null;
  } catch (caught) {
    if (isCancel(caught)) throw new PasskeyError('cancelled');
    return null;
  }
}

async function prfCapable(): Promise<boolean> {
  // Ask the browser before creating anything: a credential we cannot use would
  // be an orphan the platform offers to save with no way to delete it again.
  const getCaps = (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<{ extensions?: string[] }> })
    .getClientCapabilities;
  if (!getCaps) return true; // older browser — the post-create check still catches it
  try {
    const capabilities = await getCaps.call(PublicKeyCredential);
    return (capabilities.extensions ?? []).includes('prf');
  } catch {
    return true;
  }
}

export interface RegisteredPasskey {
  credentialId: string;
  label: string;
  prf: boolean;
}

/**
 * Enrol a passkey for the signed-in account, wrapping the vault key with the
 * credential's PRF so this passkey can open the planner on any browser.
 */
export async function registerPasskey(label?: string): Promise<RegisteredPasskey> {
  if (!passkeysSupported()) throw new PasskeyError('unsupported');
  const session = getActiveSession();
  if (!session || !session.dekRaw) throw new PasskeyError('no_session');
  if (!(await prfCapable())) throw new PasskeyError('no_prf');

  const { challenge } = await request<{ challenge: string }>('/api/auth/passkey/register/options', {
    method: 'POST',
    body: '{}',
  });

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: bytesFromBase64Url(challenge),
        rp: { name: RP_NAME, id: window.location.hostname },
        user: {
          id: utf8(session.user.id),
          name: session.user.username,
          displayName: session.user.displayName || session.user.username,
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        timeout: 60_000,
        attestation: 'none',
        extensions: { prf: { eval: { first: PRF_SALT } } } as unknown as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (caught) {
    if (isCancel(caught)) throw new PasskeyError('cancelled');
    throw caught;
  }
  if (!credential) throw new PasskeyError('cancelled');

  const prfOutput = await evaluatePrf(credential);
  if (!prfOutput) throw new PasskeyError('no_prf');

  const kek = await kekFromPrf(prfOutput);
  const wrappedDek = await wrapRawKey(session.dekRaw, kek);
  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = typeof response.getTransports === 'function' ? response.getTransports() : [];

  const result = await request<{ passkey: RegisteredPasskey }>('/api/auth/passkey/register/verify', {
    method: 'POST',
    body: JSON.stringify({
      id: credential.id,
      clientDataJSON: toBase64(new Uint8Array(response.clientDataJSON)),
      attestationObject: toBase64(new Uint8Array(response.attestationObject)),
      label: label ?? 'My passkey',
      transports: transports.join(','),
      prfWrappedDek: wrappedDek,
    }),
  });
  return result.passkey;
}

export interface PasskeySignInResult {
  user: PublicUser;
  /** True when the passkey also opened the vault — straight to the planner. */
  unlocked: boolean;
}

/**
 * Sign in with a passkey. With PRF the vault opens on the spot; without it the
 * session is established and the gate asks for the password once.
 */
export async function passkeySignIn(username?: string): Promise<PasskeySignInResult> {
  if (!passkeysSupported()) throw new PasskeyError('unsupported');

  const options = await request<PasskeyOptionsResponse>('/api/auth/passkey/login/options', {
    method: 'POST',
    body: JSON.stringify({ username: username?.trim() || null }),
  });

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: bytesFromBase64Url(options.challenge),
        rpId: window.location.hostname,
        allowCredentials: options.allowCredentials.map((id) => ({ id: bytesFromBase64Url(id), type: 'public-key' as const })),
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: PRF_SALT } } } as unknown as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (caught) {
    if (isCancel(caught)) throw new PasskeyError('cancelled');
    throw caught;
  }
  if (!credential) throw new PasskeyError('cancelled');

  const prfOutput = (credential.getClientExtensionResults() as PrfExtensionOutput).prf?.results?.first ?? null;
  const response = credential.response as AuthenticatorAssertionResponse;
  const result = await request<PasskeyLoginResponse>('/api/auth/passkey/login/verify', {
    method: 'POST',
    body: JSON.stringify({
      id: credential.id,
      clientDataJSON: toBase64(new Uint8Array(response.clientDataJSON)),
      authenticatorData: toBase64(new Uint8Array(response.authenticatorData)),
      signature: toBase64(new Uint8Array(response.signature)),
      userHandle: response.userHandle ? new TextDecoder().decode(new Uint8Array(response.userHandle)) : null,
    }),
  });

  // PRF + wrapped key → the vault opens with no password anywhere.
  if (prfOutput && result.wrappedDek) {
    try {
      const kek = await kekFromPrf(prfOutput);
      const raw = await unwrapKeyRaw(result.wrappedDek, kek);
      const dekRaw = new Uint8Array(raw);
      const dek = await importDek(raw, false);
      adoptSession(result.user, dek, result.vault, dekRaw);
      await rememberOnDevice(result.user.id, dekRaw);
      return { user: result.user, unlocked: true };
    } catch {
      // A key that does not open this vault: fall through to the password gate.
    }
  }
  // Session cookie only — the account gate will ask for the password (or find
  // this device already trusted).
  return { user: result.user, unlocked: false };
}

/** Forget one of your passkeys. */
export async function removePasskey(credentialId: string): Promise<void> {
  await request<{ ok: true }>('/api/auth/passkey/delete', {
    method: 'DELETE',
    body: JSON.stringify({ credentialId }),
  });
}

export interface ListedPasskey {
  credentialId: string;
  label: string;
  prf: boolean;
  transports: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The signed-in account's passkeys, for Settings → Security. */
export async function listPasskeys(): Promise<ListedPasskey[]> {
  const result = await request<{ passkeys: ListedPasskey[] }>('/api/auth/passkey/list', { method: 'GET' });
  return result.passkeys;
}
