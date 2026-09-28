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
