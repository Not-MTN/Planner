/**
 * Contract shared by the browser and the server for accounts, sessions and
 * vaults. Nothing in here may import browser-only or server-only modules.
 *
 * The server never receives a password. The browser stretches the password with
 * Argon2id and sends only the resulting 32-byte `authToken`, which is already
 * as hard to brute-force as the password itself.
 */

export const SESSION_COOKIE = 'planner_session';
export const SESSION_TTL_DAYS = 30;
export const MAX_VAULT_BYTES = 3_000_000;
export const MAX_AUTH_BODY_BYTES = 64 * 1024;
/**
 * Bodies that carry an encrypted vault (sign-up, PUT /api/auth/vault) hold the
 * whole planner as base64, so the ordinary 64 KB cap would reject any account
 * with real local data. Sized to the vault's own ceiling plus JSON overhead.
 */
export const MAX_VAULT_BODY_BYTES = MAX_VAULT_BYTES * 2 + 32 * 1024;

export type AccountRole = 'personal' | 'student' | 'guardian';
export const ACCOUNT_ROLES: readonly AccountRole[] = ['personal', 'student', 'guardian'] as const;

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  role: AccountRole;
  createdAt: string;
}

export interface SignupRequest {
  username: string;
  email?: string;
  displayName: string;
  role: AccountRole;
  /** base64 — 16 random bytes, the browser's Argon2id salt. */
  kdfSalt: string;
  /** base64 — 32 bytes of Argon2id output. Replaces the password on the wire. */
  authToken: string;
  /** base64 — iv || ciphertext of the DEK under the password KEK. */
  wrappedDek: string;
  /** base64 — iv || ciphertext of the DEK under the recovery key. */
  wrappedRecovery: string;
  /** base64 — the already-encrypted planner. The server cannot read it. */
  ciphertext: string;
}

export interface LoginRequest {
  username: string;
  authToken: string;
}

export interface LoginResponse {
  user: PublicUser;
  kdfSalt: string;
  wrappedDek: string;
  vault: { version: number; ciphertext: string };
}

/**
 * The password was right, but a second step is still owed.
 *
 * No session exists yet. The caller holds a short-lived challenge in a cookie
 * and must answer with a code from the account's authenticator app.
 */
export interface SecondFactorResponse {
  secondFactor: 'totp';
}

/** What happened, in the account's own history. */
export type AuthEventKind =
  | 'created'
  | 'password'
  | 'password_totp'
  | 'passkey'
  | 'passkey_totp'
  | 'recovery'
  | 'password_changed'
  | 'signed_out'
  | 'totp_on'
  | 'totp_off';

export interface AuthEvent {
  id: string;
  kind: AuthEventKind;
  /** A short description captured at the time, e.g. "Chrome on Mac". */
  deviceLabel: string;
  at: string;
  /**
   * A salted hash of the network the request came from — never the address.
   * Enough to tell "the same place" from "somewhere new", and no more.
   */
  network: string | null;
  /** True the first time this account was seen from that network. */
  newNetwork: boolean;
}

export interface AuthEventsResponse {
  events: AuthEvent[];
}

/** An authenticator app being set up, or already set up. */
export interface TotpSetupResponse {
  /** Base32 secret, grouped in fours for reading aloud or typing. */
  secret: string;
  /** The same secret, grouped, for display. */
  formatted: string;
  /** `otpauth://` URI, for apps that import by link. */
  uri: string;
  /** True once a code from this secret has been accepted. */
  confirmed: boolean;
}

/** Challenge for a WebAuthn ceremony; allowCredentials narrows the chooser
 *  when the account is known, and is empty for a discoverable-credential flow. */
export interface PasskeyOptionsResponse {
  challenge: string;
  allowCredentials: string[];
}

/** A passkey signs the session in; wrappedDek is null when the authenticator
 *  cannot derive the vault key (the password unlocks in that case). */
export interface PasskeyLoginResponse {
  user: PublicUser;
  vault: { version: number; ciphertext: string };
  wrappedDek: string | null;
}

export interface SessionResponse {
  user: PublicUser | null;
}

export interface VaultResponse {
  version: number;
  ciphertext: string;
  updatedAt: string;
}

export interface VaultPutRequest {
  baseVersion: number;
  ciphertext: string;
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function isBase64(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength && BASE64_PATTERN.test(value);
}

export function cleanUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return USERNAME_PATTERN.test(trimmed) ? trimmed : null;
}

export function cleanEmail(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length <= 200 && EMAIL_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length >= 1 && trimmed.length <= 60 ? trimmed : null;
}

export function cleanRole(value: unknown): AccountRole | null {
  return ACCOUNT_ROLES.includes(value as AccountRole) ? (value as AccountRole) : null;
}

/* ------------------------------------------------------------------- links */

/** Weekly results are small: counts, minutes and one line of words. */
export const MAX_SHARE_BYTES = 16 * 1024;
export const MAX_LINKS_PER_SIDE = 20;

export type LinkStatus = 'pending' | 'linked' | 'revoked';

/** What a guardian sees: their request to a student. */
export interface OutgoingLink {
  id: string;
  studentUsername: string;
  status: LinkStatus;
  /** Week of the results waiting to be read, if any. */
  weekOf: string | null;
  updatedAt: string | null;
  /**
   * When a pending invitation stops working. Null once it is accepted. Shown
   * to the guardian so a code they sent last month and forgot about reads as
   * dead rather than as an unanswered request.
   */
  expiresAt: string | null;
}

/** What a student sees: a guardian asking to follow them. */
export interface IncomingLink {
  id: string;
  guardianUsername: string;
  guardianDisplayName: string;
  status: LinkStatus;
}

export interface LinksResponse {
  outgoing: OutgoingLink[];
  incoming: IncomingLink[];
}

export interface CreateLinkRequest {
  /** The student's username. */
  username: string;
  /** base64 sha256 of the pairing code — the server cannot derive the key from it. */
  codeHash: string;
  /** base64 — the results key, wrapped by a key derived from the code. */
  wrappedShare: string;
}

export interface AcceptLinkRequest {
  /** The code the guardian handed over, typed in full. */
  code: string;
}

export interface AcceptLinkResponse {
  linkId: string;
  guardianUsername: string;
  guardianDisplayName: string;
  /** base64 — the results key, still wrapped by the code key. */
  wrappedShare: string;
}

export interface SharePutRequest {
  linkId: string;
  /** base64 — this week's results, encrypted with the link's key. */
  ciphertext: string;
  /** Monday of the week these results describe. */
  weekOf: string;
}

export interface ShareResponse {
  linkId: string;
  ciphertext: string | null;
  weekOf: string | null;
  updatedAt: string | null;
}

export function cleanCodeHash(value: unknown): string | null {
  return isBase64(value, 40, 64) ? (value as string) : null;
}

export function cleanWrappedShare(value: unknown): string | null {
  return isBase64(value, 44, 512) ? (value as string) : null;
}

export function cleanLinkId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-f0-9-]{8,64}$/.test(trimmed) ? trimmed : null;
}

export function cleanWeekOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function cleanShareCiphertext(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.length <= MAX_SHARE_BYTES * 2 && BASE64_PATTERN.test(value) ? value : null;
}

/* ------------------------------------------------------------------ notices */

export interface NotePutRequest {
  linkId: string;
  /** base64 — the note, encrypted with the link's key. Empty clears it. */
  ciphertext: string | null;
  weekOf: string;
}

export interface NoteResponse {
  linkId: string;
  ciphertext: string | null;
  weekOf: string | null;
}
