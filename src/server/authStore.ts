/**
 * Server-side storage for accounts, credentials, vaults and sessions.
 *
 * Two implementations share one interface: a Neon-backed store for real
 * deployments, and an in-memory store used only when DATABASE_URL is missing
 * outside production — so `npm run dev` and preview builds work with no setup.
 * Production never falls back: without DATABASE_URL the API reports
 * `not_configured` and nothing is stored.
 */
import { scrypt as scryptCallback, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { AccountRole, AuthEvent, AuthEventKind } from '../shared/authContract.js';
import type { NeonQueryFunction } from '@neondatabase/serverless';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Kept for `db/auth.sql`; the store runs it statement by statement. */
export const AUTH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS planner_users (
  id             text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
  username       text NOT NULL,
  username_lower text NOT NULL UNIQUE,
  email_lower    text UNIQUE,
  display_name   text NOT NULL,
  role           text NOT NULL CHECK (role IN ('personal','student','guardian')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planner_credentials (
  user_id     text PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
  kdf_salt    text NOT NULL,
  auth_hash   text NOT NULL,
  hash_salt   text NOT NULL,
  recovery_hash      text,
  recovery_hash_salt text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE planner_credentials ADD COLUMN IF NOT EXISTS recovery_hash text;
ALTER TABLE planner_credentials ADD COLUMN IF NOT EXISTS recovery_hash_salt text;

-- An account can hold several recovery codes, and each one is a separate lock
-- on the vault: all the server ever keeps is one opaque verifier per code, so a
-- leaked row is useless on its own. The old single pair of columns is kept for
-- accounts that predate sets, and is honoured while this array is empty.
ALTER TABLE planner_credentials ADD COLUMN IF NOT EXISTS recovery_verifiers text;

-- Second step at sign-in. The secret has to sit here: verifying a code means
-- recomputing it, and only this server can do that. It is not the vault key,
-- and it opens nothing on its own.
ALTER TABLE planner_credentials ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE planner_credentials ADD COLUMN IF NOT EXISTS totp_confirmed_at timestamptz;
ALTER TABLE planner_credentials ADD COLUMN IF NOT EXISTS totp_last_step bigint;

CREATE TABLE IF NOT EXISTS planner_vaults (
  user_id          text PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
  version          integer NOT NULL CHECK (version > 0),
  ciphertext       text NOT NULL,
  wrapped_dek      text NOT NULL,
  wrapped_recovery text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planner_sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES planner_users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  label        text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS planner_sessions_user_idx ON planner_sessions (user_id);

-- A half-finished sign-in: password right, second step still owed. It is a
-- token hash and a deadline and nothing else, and it is spent the moment the
-- right code arrives.
CREATE TABLE IF NOT EXISTS planner_login_challenges (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES planner_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS planner_login_challenges_user_idx ON planner_login_challenges (user_id);

--- What this account has been up to, so its owner can read it back. No
--- address is kept: network is a hash of the address salted with the user
--- id, which is enough to group by place and not enough to find one.
CREATE TABLE IF NOT EXISTS planner_auth_events (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES planner_users(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  device_label text NOT NULL DEFAULT '',
  network      text,
  new_network  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planner_auth_events_user_idx ON planner_auth_events (user_id, created_at DESC);

-- A guardian's request to follow a student. code_hash is all the server ever
-- sees of the pairing code; wrapped_share is the results key sealed by a key
-- derived from that code, so the server cannot read the results either.
CREATE TABLE IF NOT EXISTS planner_links (
  id                     text PRIMARY KEY,
  guardian_id            text NOT NULL REFERENCES planner_users(id) ON DELETE CASCADE,
  student_id             text REFERENCES planner_users(id) ON DELETE CASCADE,
  student_username_lower text NOT NULL,
  code_hash              text NOT NULL,
  wrapped_share          text NOT NULL,
  share_ciphertext       text,
  share_week             text,
  share_updated_at       timestamptz,
  status                 text NOT NULL CHECK (status IN ('pending','linked','revoked')),
  note_to_student        text,
  note_to_guardian       text,
  note_week              text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guardian_id, student_username_lower)
);

CREATE INDEX IF NOT EXISTS planner_links_student_idx ON planner_links (student_username_lower);
CREATE INDEX IF NOT EXISTS planner_links_student_id_idx ON planner_links (student_id);

-- WebAuthn passkeys. The public key verifies assertions; prf_wrapped_dek is
-- the vault key sealed by a key the passkey's PRF derives, so a browser with
-- PRF support opens the planner with a touch and no password.
CREATE TABLE IF NOT EXISTS planner_passkeys (
  credential_id   text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES planner_users(id) ON DELETE CASCADE,
  public_key      text NOT NULL,
  label           text NOT NULL DEFAULT '',
  sign_count      integer NOT NULL DEFAULT 0,
  prf_wrapped_dek text,
  transports      text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS planner_passkeys_user_idx ON planner_passkeys (user_id);
`.trim();

export interface UserRow {
  id: string;
  username: string;
  username_lower: string;
  email_lower: string | null;
  display_name: string;
  role: AccountRole;
  created_at: string | Date;
}

export interface AccountRow {
  user: UserRow;
  /** The client's Argon2id salt — public, handed back before stretching. */
  kdfSalt: string;
  /** Our own salt for the second (server-side) hash. Never leaves the server. */
  hashSalt: string;
  authHash: string;
}

export interface VaultRow {
  version: number;
  ciphertext: string;
  wrappedDek: string;
  /**
   * One wrapped copy of the vault key per recovery code. Accounts created
   * before codes came in sets hold a single plain string.
   */
  wrappedRecovery: string | string[];
  updated_at: string | Date;
}

/** One-way verifier for a single recovery code. */
export interface RecoveryVerifier {
  hash: string;
  salt: string;
}

/** Parse the stored verifier array, falling back to the legacy single pair. */
export function parseRecoveryVerifiers(
  stored: string | null | undefined,
  legacyHash?: string | null,
  legacySalt?: string | null,
): RecoveryVerifier[] {
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const rows = parsed.filter(
          (entry): entry is RecoveryVerifier =>
            !!entry && typeof entry === 'object' && typeof (entry as RecoveryVerifier).hash === 'string' && typeof (entry as RecoveryVerifier).salt === 'string',
        );
        if (rows.length > 0) return rows;
      }
    } catch {
      // Not JSON, or not the shape we wrote: fall through to the legacy pair.
    }
  }
  if (legacyHash && legacySalt) return [{ hash: legacyHash, salt: legacySalt }];
  return [];
}

/** Read a wrapped-DEK list that may still be a single legacy copy. */
export function parseRecoveryWraps(stored: string | string[] | null | undefined): string[] {
  if (Array.isArray(stored)) return stored;
  if (typeof stored === 'string' && stored.length > 0) {
    if (stored.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === 'string');
      } catch {
        // Fall through: treat it as one opaque blob.
      }
    }
    return [stored];
  }
  return [];
}

/** The account's authenticator-app second step, if it has one. */
export interface TotpRecord {
  /** Base32 secret. Null until set-up starts, and cleared when it is removed. */
  secret: string | null;
  /** Set only once a code from the app has been accepted. */
  confirmedAt: string | null;
  /** The last accepted 30-second step, so one code cannot be used twice. */
  lastStep: number | null;
}

export interface NewAccount {
  username: string;
  email: string | null;
  displayName: string;
  role: AccountRole;
  kdfSalt: string;
  authToken: string;
  /** One verifier per recovery code, in the same order as the wrapped copies. */
  recoveryHashes: string[];
  wrappedDek: string;
  wrappedRecovery: string[];
  ciphertext: string;
}

export type CreateResult = { ok: true; user: UserRow } | { ok: false; reason: 'username_taken' | 'email_taken' };

export interface RecoveryUpdate {
  /** Verifiers for the replacement set of codes. */
  newRecoveryHashes: string[];
  kdfSalt: string;
  authToken: string;
  wrappedDek: string;
  /** One wrapped copy per new code, in the same order as the verifiers. */
  wrappedRecovery: string[];
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string | Date;
}

/**
 * A signed-in device, as the signed-in user may see it.
 *
 * The token hash never leaves the server, so a stolen list is useless: the
 * most it allows is ending a session, which its owner could do anyway.
 */
export interface SessionInfo {
  id: string;
  /** A short description captured at sign-in, e.g. "Chrome on Mac". */
  label: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export type { AuthEvent, AuthEventKind } from '../shared/authContract.js';

export interface NewAuthEvent {
  userId: string;
  kind: AuthEventKind;
  deviceLabel?: string | null;
  network?: string | null;
}

/** How much history one account keeps, and for how long. */
const AUTH_EVENT_LIMIT = 60;
const AUTH_EVENT_DAYS = 180;

const AUTH_EVENT_KINDS: ReadonlySet<string> = new Set([
  'created', 'password', 'password_totp', 'passkey', 'passkey_totp',
  'recovery', 'password_changed', 'signed_out', 'totp_on', 'totp_off',
]);

/**
 * The kinds the log will accept. Written into the column as text, so a bad
 * value from anywhere upstream cannot smuggle in a row the UI will choke on.
 */
export function cleanAuthEventKind(value: unknown): AuthEventKind | null {
  return typeof value === 'string' && AUTH_EVENT_KINDS.has(value) ? (value as AuthEventKind) : null;
}

export interface LinkRow {
  id: string;
  guardian_id: string;
  student_id: string | null;
  student_username_lower: string;
  code_hash: string;
  wrapped_share: string;
  share_ciphertext: string | null;
  note_to_student: string | null;
  note_to_guardian: string | null;
  note_week: string | null;
  share_week: string | null;
  share_updated_at: string | null;
  status: 'pending' | 'linked' | 'revoked';
  created_at: string;
  updated_at: string;
}

export interface NewLink {
  id: string;
  guardianId: string;
  studentUsernameLower: string;
  codeHash: string;
  wrappedShare: string;
}

/** A registered passkey. The wrapped DEK is the PRF-derived copy that lets a
 *  capable browser open the vault with a touch instead of a password. */
export interface PasskeyRow {
  credential_id: string;
  user_id: string;
  public_key: string;
  label: string;
  sign_count: number;
  prf_wrapped_dek: string | null;
  transports: string;
  created_at: string;
  last_used_at: string | null;
}

export interface NewPasskey {
  credentialId: string;
  userId: string;
  publicKey: string;
  label: string;
  signCount: number;
  prfWrappedDek: string | null;
  transports: string;
}

export interface AuthStore {
  createAccount(input: NewAccount): Promise<CreateResult>;
  findAccount(login: string): Promise<AccountRow | null>;
  /** Verify one of the account's recovery verifiers, rotate the password wraps, and revoke sessions. */
  recoverAccount(login: string, recoveryHash: string, update: RecoveryUpdate): Promise<boolean>;
  /**
   * Rotate the recovery codes of a signed-in, already-authenticated account.
   * The caller proved who it is with its password, so no verifier is checked.
   */
  updateRecovery?(userId: string, update: Omit<RecoveryUpdate, 'authToken'> & { authToken: string }): Promise<boolean>;
  findUserById(id: string): Promise<UserRow | null>;
  getVault(userId: string): Promise<VaultRow | null>;
  putVault(userId: string, baseVersion: number, ciphertext: string): Promise<VaultRow | null>;
  updateCredential(userId: string, kdfSalt: string, authToken: string): Promise<void>;
  createSession(userId: string, tokenHash: string, label: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string): Promise<{ session: SessionRow; user: UserRow } | null>;
  deleteSession(id: string): Promise<void>;
  /** The account's authenticator-app second step, or null when it has none. */
  getTotp(userId: string): Promise<TotpRecord | null>;
  /** Starts (or restarts) set-up. Not confirmed until a code is accepted. */
  setTotpSecret(userId: string, secret: string | null): Promise<void>;
  /**
   * Marks set-up finished. The secret is live from here on.
   *
   * No step is recorded: confirming and removing only happen inside an existing
   * session, where replaying a code gains nobody anything.
   */
  confirmTotp(userId: string): Promise<void>;
  /**
   * Records the step of a code accepted at sign-in, so the same 30-second code
   * cannot open the account twice.
   */
  recordTotpStep(userId: string, step: number): Promise<void>;
  /**
   * A password that checked out, waiting on a second step. The account is not
   * signed in yet: this only remembers that the first half passed.
   */
  createLoginChallenge(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findLoginChallenge(tokenHash: string): Promise<{ user: UserRow } | null>;
  deleteLoginChallenge(tokenHash: string): Promise<void>;
  /** Every live session for this account, most recently used first. */
  listSessions(userId: string): Promise<SessionInfo[]>;
  /** Ends one of this account's own sessions. Other accounts are untouched. */
  deleteSessionForUser(id: string, userId: string): Promise<boolean>;
  /** Ends every session but the given one, for "sign out everywhere else". */
  deleteOtherSessions(userId: string, keepId: string): Promise<number>;
  /**
   * Adds a line to the account's history, and drops what is no longer worth
   * keeping. Best-effort: a failed log line must never block a sign-in.
   */
  recordAuthEvent(event: NewAuthEvent): Promise<void>;
  /** Newest first. */
  listAuthEvents(userId: string, limit?: number): Promise<AuthEvent[]>;
  /** Permanently remove an account and all account-owned data. */
  deleteAccount?(userId: string): Promise<boolean>;
  /** Guardian: ask a student to be followed. Returns null when already asked. */
  createLink(input: NewLink): Promise<LinkRow | null>;
  /** Guardian's own requests. */
  listOutgoingLinks(guardianId: string): Promise<LinkRow[]>;
  /** Waiting invitations (matched by username) plus accepted links (matched by id). */
  listIncomingLinks(user: { id: string; usernameLower: string }): Promise<Array<LinkRow & { guardian_username: string; guardian_display_name: string }>>;
  /** Student: turns a pending request into a link, if the code matches. */
  acceptLink(codeHash: string, student: { id: string; usernameLower: string }): Promise<LinkRow | null>;
  /** Student writes this week's results; guardian reads them. */
  putShare(linkId: string, studentId: string, ciphertext: string, weekOf: string): Promise<LinkRow | null>;
  getShare(linkId: string, guardianId: string): Promise<LinkRow | null>;
  /** Either side can end a link; it disappears from both. */
  deleteLink(linkId: string, userId: string): Promise<boolean>;
  /**
   * A note for whoever is on the other side of the link: a guardian writes for
   * the student, the student writes for the guardian. Encrypted with the link's
   * key, so the server only relays ciphertext.
   */
  putNote(linkId: string, userId: string, to: 'student' | 'guardian', ciphertext: string | null, weekOf: string): Promise<LinkRow | null>;
  /** Reads the note addressed to the caller. */
  getNote(linkId: string, userId: string): Promise<{ ciphertext: string | null; weekOf: string | null } | null>;

  /* WebAuthn passkeys: one row per credential, keyed by its id. */
  createPasskey(input: NewPasskey): Promise<PasskeyRow | null>;
  listPasskeys(userId: string): Promise<PasskeyRow[]>;
  findPasskey(credentialId: string): Promise<PasskeyRow | null>;
  /** Records an assertion: the counter only ever moves forward. */
  touchPasskey(credentialId: string, signCount: number): Promise<void>;
  deletePasskey(userId: string, credentialId: string): Promise<boolean>;
}

/* ------------------------------------------------------------------ hashing */

/**
 * The client already stretched the password with Argon2id, so what arrives is
 * high-entropy: this second pass is defence in depth, in case the table leaks.
 */
export async function hashAuthToken(authToken: string, salt: string): Promise<string> {
  const derived = await scrypt(authToken, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return derived.toString('base64');
}

export interface StoredCredential {
  /** The salt the server used, stored next to the hash. */
  hashSalt: string;
  authHash: string;
}

/**
 * Hashes a credential together with the salt that will be stored beside it.
 * Always use this: computing the hash with one salt and storing another makes
 * every future sign-in fail.
 */
export async function hashCredential(authToken: string): Promise<StoredCredential> {
  const hashSalt = newSalt();
  return { hashSalt, authHash: await hashAuthToken(authToken, hashSalt) };
}

/** A separate server-side scrypt verifier prevents a database read from being a usable recovery proof. */
export async function hashRecoveryVerifier(recoveryHash: string): Promise<{ recoveryHash: string; recoveryHashSalt: string }> {
  const recoveryHashSalt = newSalt();
  return {
    recoveryHash: await hashAuthToken(recoveryHash, recoveryHashSalt),
    recoveryHashSalt,
  };
}

/** One verifier per recovery code, each with its own server-side salt. */
export async function hashRecoveryVerifiers(recoveryHashes: string[]): Promise<RecoveryVerifier[]> {
  return Promise.all(recoveryHashes.map(async (hash) => {
    const salt = newSalt();
    return { hash: await hashAuthToken(hash, salt), salt };
  }));
}

export function newSalt(): string {
  return randomBytes(16).toString('base64');
}

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return Buffer.from(token).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function spendRecoveryFailureWork(recoveryHash: string): Promise<void> {
  const dummy = await hashAuthToken(recoveryHash, 'planner-recovery-decoy-salt');
  safeEqual(dummy, dummy);
}

/* ------------------------------------------------------- database diagnostics */

/**
 * A DATABASE_URL that the Neon driver cannot even parse. Thrown lazily from
 * store methods (which every handler turns into a JSON 502), never from store
 * creation — an unparseable URL must not crash the whole serverless function,
 * which the platform reports as an opaque HTML 500 the client cannot classify.
 */
export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

/**
 * Cleans the paste artifacts a human leaves in an environment variable copied
 * out of a chat window, a markdown link, or the Neon console: surrounding
 * whitespace, one layer of wrapping quotes, and angle brackets.
 */
export function cleanDatabaseUrl(raw: string): string {
  let url = raw.trim();
  url = url.replace(/^["'`<]+/, '').replace(/["'`>]+$/, '').trim();
  url = url.replace(/^psql\s+/i, '').trim();
  url = url.replace(/^(?:DATABASE_URL|POSTGRES_URL|NEON_DATABASE_URL)\s*=\s*/i, '').trim();
  url = url.replace(/^["'`<]+/, '').replace(/["'`>]+$/, '');
  return url.trim();
}

/**
 * Keeps credentials out of logs: the Neon driver embeds the whole connection
 * string — password included — in its parse errors, and query errors can echo
 * fragments of it too.
 */
export function redactDatabaseError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text
    // Any scheme://user:pass@host string — the driver echoes the whole
    // connection string back on a parse failure, whatever its scheme.
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]*@[^\s"')\]]*/gi, '[redacted-connection]')
    .replace(/postgres(ql)?:\/\/\S+/gi, 'postgres://[redacted]')
    .replace(/Neon-Connection-String[^\n]*/gi, 'Neon-Connection-String: [redacted]');
}

/**
 * Wraps every store method so a database failure is logged (with the
 * connection string redacted) before the handler turns it into a 502. Vercel
 * keeps function logs, so this is what makes a production outage diagnosable.
 */
function withLoggedFailures(store: AuthStore): AuthStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (error) {
          if (!(error instanceof DatabaseConfigError)) {
            console.error(`[planner] database error in AuthStore.${String(property)}: ${redactDatabaseError(error)}`);
          } else {
            console.error(`[planner] ${redactDatabaseError(error)}`);
          }
          throw error;
        }
      };
    },
  });
}

/* ------------------------------------------------------------- memory store */

/** Used only outside production when no database is configured. */
export function createMemoryAuthStore(): AuthStore {
  const users = new Map<string, UserRow>();
  const credentials = new Map<string, {
    kdfSalt: string;
    hashSalt: string;
    authHash: string;
    recoveryHash: string | null;
    recoveryHashSalt: string | null;
    /** One verifier per recovery code; the legacy pair above is kept in sync. */
    recoveryVerifiers: RecoveryVerifier[];
    totpSecret: string | null;
    totpConfirmedAt: string | null;
    totpLastStep: number | null;
  }>();
  const vaults = new Map<string, VaultRow>();
  const sessions = new Map<string, SessionRow & { label: string; createdAt: string; lastSeenAt: string }>();
  const loginChallenges = new Map<string, { userId: string; expiresAt: string }>();
  const authEvents = new Map<
    string,
    Array<{ id: string; kind: AuthEventKind; deviceLabel: string; at: string; network: string | null; newNetwork: boolean }>
  >();
  const links: LinkRow[] = [];
  const passkeys: PasskeyRow[] = [];

  return {
    async createAccount(input) {
      const lower = input.username.toLowerCase();
      for (const user of users.values()) {
        if (user.username_lower === lower) return { ok: false, reason: 'username_taken' };
      }
      if (input.email) {
        for (const user of users.values()) {
          if (user.email_lower === input.email) return { ok: false, reason: 'email_taken' };
        }
      }
      const user: UserRow = {
        id: newId(),
        username: input.username,
        username_lower: lower,
        email_lower: input.email,
        display_name: input.displayName,
        role: input.role,
        created_at: new Date().toISOString(),
      };
      users.set(user.id, user);
      const credential = await hashCredential(input.authToken);
      const verifiers = await hashRecoveryVerifiers(input.recoveryHashes);
      const first = verifiers[0];
      credentials.set(user.id, {
        kdfSalt: input.kdfSalt,
        ...credential,
        recoveryHash: first?.hash ?? null,
        recoveryHashSalt: first?.salt ?? null,
        recoveryVerifiers: verifiers,
        totpSecret: null,
        totpConfirmedAt: null,
        totpLastStep: null,
      });
      vaults.set(user.id, {
        version: 1,
        ciphertext: input.ciphertext,
        wrappedDek: input.wrappedDek,
        wrappedRecovery: input.wrappedRecovery,
        updated_at: new Date().toISOString(),
      });
      return { ok: true, user };
    },
    async findAccount(login) {
      const needle = login.trim().toLowerCase();
      for (const user of users.values()) {
        if (user.username_lower === needle || user.email_lower === needle) {
          const credential = credentials.get(user.id);
          if (!credential) return null;
          return { user, kdfSalt: credential.kdfSalt, hashSalt: credential.hashSalt, authHash: credential.authHash };
        }
      }
      return null;
    },
    async recoverAccount(login, recoveryHash, update) {
      const needle = login.trim().toLowerCase();
      const user = [...users.values()].find((row) => row.username_lower === needle || row.email_lower === needle);
      if (!user) {
        await spendRecoveryFailureWork(recoveryHash);
        return false;
      }
      const current = credentials.get(user.id);
      const vault = vaults.get(user.id);
      const verifiers = current?.recoveryVerifiers ?? [];
      if (!current || verifiers.length === 0 || !vault) {
        await spendRecoveryFailureWork(recoveryHash);
        return false;
      }
      // Any code in the set works; the server never learns which one was used.
      const matches = await Promise.all(verifiers.map((v) => hashAuthToken(recoveryHash, v.salt)));
      if (!verifiers.some((v, index) => safeEqual(v.hash, matches[index]))) return false;

      const credential = await hashCredential(update.authToken);
      const nextVerifiers = await hashRecoveryVerifiers(update.newRecoveryHashes);
      const nextFirst = nextVerifiers[0];
      credentials.set(user.id, {
        kdfSalt: update.kdfSalt,
        ...credential,
        recoveryHash: nextFirst?.hash ?? null,
        recoveryHashSalt: nextFirst?.salt ?? null,
        recoveryVerifiers: nextVerifiers,
        // A password reset is the moment someone is most likely to have lost
        // their phone along with it, so the second step starts over too.
        totpSecret: null,
        totpConfirmedAt: null,
        totpLastStep: null,
      });
      vaults.set(user.id, {
        ...vault,
        wrappedDek: update.wrappedDek,
        wrappedRecovery: update.wrappedRecovery,
        updated_at: new Date().toISOString(),
      });
      for (const [tokenHash, session] of sessions) {
        if (session.user_id === user.id) sessions.delete(tokenHash);
      }
      return true;
    },
    async findUserById(id) {
      return users.get(id) ?? null;
    },

    async getVault(userId) {
      return vaults.get(userId) ?? null;
    },
    async putVault(userId, baseVersion, ciphertext) {
      const current = vaults.get(userId);
      if (!current) return null;
      if (baseVersion !== 0 && baseVersion !== current.version) return null;
      const next: VaultRow = { ...current, version: current.version + 1, ciphertext, updated_at: new Date().toISOString() };
      vaults.set(userId, next);
      return next;
    },
    async updateCredential(userId, kdfSalt, authToken) {
      const prior = credentials.get(userId);
      credentials.set(userId, {
        kdfSalt,
        recoveryHash: prior?.recoveryHash ?? null,
        recoveryHashSalt: prior?.recoveryHashSalt ?? null,
        recoveryVerifiers: prior?.recoveryVerifiers ?? [],
        totpSecret: prior?.totpSecret ?? null,
        totpConfirmedAt: prior?.totpConfirmedAt ?? null,
        totpLastStep: prior?.totpLastStep ?? null,
        ...(await hashCredential(authToken)),
      });
    },
    async updateRecovery(userId, update) {
      const current = credentials.get(userId);
      const vault = vaults.get(userId);
      if (!current || !vault) return false;
      const verifiers = await hashRecoveryVerifiers(update.newRecoveryHashes);
      const first = verifiers[0];
      credentials.set(userId, {
        ...current,
        recoveryHash: first?.hash ?? null,
        recoveryHashSalt: first?.salt ?? null,
        recoveryVerifiers: verifiers,
      });
      vaults.set(userId, {
        ...vault,
        wrappedDek: update.wrappedDek,
        wrappedRecovery: update.wrappedRecovery,
        updated_at: new Date().toISOString(),
      });
      return true;
    },
    async createSession(userId, tokenHash, label, expiresAt) {
      const stamp = new Date().toISOString();
      sessions.set(tokenHash, {
        id: newId(),
        user_id: userId,
        expires_at: expiresAt.toISOString(),
        label,
        createdAt: stamp,
        lastSeenAt: stamp,
      });
    },
    async findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session) return null;
      if (new Date(session.expires_at).getTime() <= Date.now()) {
        sessions.delete(tokenHash);
        return null;
      }
      // Seen just now. Throttled in SQL; harmless to do every time here.
      session.lastSeenAt = new Date().toISOString();
      const user = users.get(session.user_id);
      return user ? { session, user } : null;
    },
    async deleteSession(id) {
      for (const [hash, session] of sessions) {
        if (session.id === id) sessions.delete(hash);
      }
    },
    async getTotp(userId) {
      const credential = credentials.get(userId);
      if (!credential) return null;
      return {
        secret: credential.totpSecret,
        confirmedAt: credential.totpConfirmedAt,
        lastStep: credential.totpLastStep,
      };
    },
    async setTotpSecret(userId, secret) {
      const credential = credentials.get(userId);
      if (!credential) return;
      credential.totpSecret = secret;
      // A new secret is unproven, so it must not stand in for the old one
      // until a code from it has been accepted.
      credential.totpConfirmedAt = null;
      credential.totpLastStep = null;
    },
    async confirmTotp(userId) {
      const credential = credentials.get(userId);
      if (!credential) return;
      credential.totpConfirmedAt = new Date().toISOString();
    },
    async recordTotpStep(userId, step) {
      const credential = credentials.get(userId);
      if (!credential) return;
      credential.totpLastStep = step;
    },
    async createLoginChallenge(userId, tokenHash, expiresAt) {
      // One live challenge per account; stale ones are dead weight.
      for (const [hash, row] of loginChallenges) {
        if (row.userId === userId || new Date(row.expiresAt).getTime() <= Date.now()) loginChallenges.delete(hash);
      }
      loginChallenges.set(tokenHash, { userId, expiresAt: expiresAt.toISOString() });
    },
    async findLoginChallenge(tokenHash) {
      const row = loginChallenges.get(tokenHash);
      if (!row) return null;
      if (new Date(row.expiresAt).getTime() <= Date.now()) {
        loginChallenges.delete(tokenHash);
        return null;
      }
      const user = users.get(row.userId);
      return user ? { user } : null;
    },
    async deleteLoginChallenge(tokenHash) {
      loginChallenges.delete(tokenHash);
    },
    async listSessions(userId) {
      const now = Date.now();
      return [...sessions.values()]
        .filter((session) => session.user_id === userId && new Date(session.expires_at).getTime() > now)
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        .map((session) => ({
          id: session.id,
          label: session.label,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt,
          expiresAt: new Date(session.expires_at).toISOString(),
        }));
    },
    async deleteSessionForUser(id, userId) {
      for (const [hash, session] of sessions) {
        if (session.id === id && session.user_id === userId) {
          sessions.delete(hash);
          return true;
        }
      }
      return false;
    },
    async deleteOtherSessions(userId, keepId) {
      let removed = 0;
      for (const [hash, session] of sessions) {
        if (session.user_id === userId && session.id !== keepId) {
          sessions.delete(hash);
          removed += 1;
        }
      }
      return removed;
    },
    async recordAuthEvent(event) {
      const list = authEvents.get(event.userId) ?? [];
      const network = event.network ?? null;
      const newNetwork = network !== null && !list.some((row) => row.network === network);
      list.push({
        id: newId(),
        kind: event.kind,
        deviceLabel: event.deviceLabel ?? '',
        at: new Date().toISOString(),
        network,
        newNetwork,
      });
      const cutoff = Date.now() - AUTH_EVENT_DAYS * 86_400_000;
      const kept = list.filter((row) => new Date(row.at).getTime() >= cutoff).slice(-AUTH_EVENT_LIMIT);
      authEvents.set(event.userId, kept);
    },
    async listAuthEvents(userId, limit = AUTH_EVENT_LIMIT) {
      return (authEvents.get(userId) ?? [])
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, Math.max(1, Math.min(limit, AUTH_EVENT_LIMIT)));
    },
    async deleteAccount(userId) {
      if (!users.has(userId)) return false;
      users.delete(userId);
      credentials.delete(userId);
      vaults.delete(userId);
      for (const [hash, row] of loginChallenges) {
        if (row.userId === userId) loginChallenges.delete(hash);
      }
      for (const [hash, session] of sessions) {
        if (session.user_id === userId) sessions.delete(hash);
      }
      authEvents.delete(userId);
      for (let index = links.length - 1; index >= 0; index -= 1) {
        if (links[index]?.guardian_id === userId || links[index]?.student_id === userId) links.splice(index, 1);
      }
      for (let index = passkeys.length - 1; index >= 0; index -= 1) {
        if (passkeys[index]?.user_id === userId) passkeys.splice(index, 1);
      }
      return true;
    },
    async createLink(input) {
      const clash = links.some(
        (link) => link.guardian_id === input.guardianId && link.student_username_lower === input.studentUsernameLower,
      );
      if (clash) return null;
      const row: LinkRow = {
        id: input.id,
        guardian_id: input.guardianId,
        student_id: null,
        student_username_lower: input.studentUsernameLower,
        code_hash: input.codeHash,
        wrapped_share: input.wrappedShare,
        share_ciphertext: null,
        note_to_student: null,
        note_to_guardian: null,
        note_week: null,
        share_week: null,
        share_updated_at: null,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      links.push(row);
      return row;
    },
    async listOutgoingLinks(guardianId) {
      return links.filter((link) => link.guardian_id === guardianId && link.status !== 'revoked');
    },
    async listIncomingLinks(user) {
      return links
        .filter(
          (link) =>
            (link.student_username_lower === user.usernameLower && link.status === 'pending') ||
            (link.student_id === user.id && link.status === 'linked'),
        )
        .map((link) => {
          const guardian = users.get(link.guardian_id);
          return {
            ...link,
            guardian_username: guardian?.username ?? '',
            guardian_display_name: guardian?.display_name ?? '',
          };
        });
    },
    async acceptLink(codeHash, student) {
      const link = links.find(
        (item) =>
          item.code_hash === codeHash &&
          item.status === 'pending' &&
          item.student_username_lower === student.usernameLower,
      );
      if (!link) return null;
      link.status = 'linked';
      link.student_id = student.id;
      link.updated_at = new Date().toISOString();
      return link;
    },
    async putShare(linkId, studentId, ciphertext, weekOf) {
      const link = links.find((item) => item.id === linkId && item.student_id === studentId && item.status === 'linked');
      if (!link) return null;
      link.share_ciphertext = ciphertext;
      link.share_week = weekOf;
      link.share_updated_at = new Date().toISOString();
      link.updated_at = link.share_updated_at;
      return link;
    },
    async getShare(linkId, guardianId) {
      const link = links.find((item) => item.id === linkId && item.guardian_id === guardianId);
      return link ? { ...link } : null;
    },

    async putNote(linkId, userId, to, ciphertext, weekOf) {
      const link = links.find((item) => item.id === linkId && item.status === 'linked');
      if (!link) return null;
      if (to === 'student' && link.guardian_id !== userId) return null;
      if (to === 'guardian' && link.student_id !== userId) return null;
      if (to === 'student') link.note_to_student = ciphertext;
      else link.note_to_guardian = ciphertext;
      link.note_week = weekOf;
      link.updated_at = new Date().toISOString();
      return link;
    },
    async getNote(linkId, userId) {
      const link = links.find((item) => item.id === linkId);
      if (!link) return null;
      const mine = link.guardian_id === userId ? link.note_to_guardian : link.student_id === userId ? link.note_to_student : null;
      if (mine === null && link.guardian_id !== userId && link.student_id !== userId) return null;
      return { ciphertext: mine, weekOf: link.note_week };
    },
    async deleteLink(linkId, userId) {
      const index = links.findIndex(
        (item) => item.id === linkId && (item.guardian_id === userId || item.student_id === userId),
      );
      if (index < 0) return false;
      links.splice(index, 1);
      return true;
    },

    async createPasskey(input) {
      if (passkeys.some((item) => item.credential_id === input.credentialId)) return null;
      const row: PasskeyRow = {
        credential_id: input.credentialId,
        user_id: input.userId,
        public_key: input.publicKey,
        label: input.label,
        sign_count: input.signCount,
        prf_wrapped_dek: input.prfWrappedDek,
        transports: input.transports,
        created_at: new Date().toISOString(),
        last_used_at: null,
      };
      passkeys.push(row);
      return { ...row };
    },
    async listPasskeys(userId) {
      return passkeys
        .filter((item) => item.user_id === userId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((item) => ({ ...item }));
    },
    async findPasskey(credentialId) {
      const row = passkeys.find((item) => item.credential_id === credentialId);
      return row ? { ...row } : null;
    },
    async touchPasskey(credentialId, signCount) {
      const row = passkeys.find((item) => item.credential_id === credentialId);
      if (!row) return;
      row.sign_count = Math.max(row.sign_count, signCount);
      row.last_used_at = new Date().toISOString();
    },
    async deletePasskey(userId, credentialId) {
      const index = passkeys.findIndex((item) => item.credential_id === credentialId && item.user_id === userId);
      if (index < 0) return false;
      passkeys.splice(index, 1);
      return true;
    },
  };
}

/* --------------------------------------------------------------- neon store */

export async function createNeonAuthStore(databaseUrl: string | undefined): Promise<AuthStore | null> {
  const url = cleanDatabaseUrl(databaseUrl ?? '');
  if (!url) return null;
  // Assigned by ensure() before any method body runs its first query; the
  // definite-assignment assertion keeps every store method's code unchanged.
  let sql!: NeonQueryFunction<false, false>;
  let ready: Promise<unknown> | null = null;
  const ensure = () => {
    ready ??= (async () => {
      // Created here, not at store creation: an unparseable DATABASE_URL must
      // surface as a caught error inside a handler (JSON 502), not as a
      // rejected store promise that crashes the function with a raw 500.
      const { neon } = await import('@neondatabase/serverless');
      try {
        sql = neon(url);
      } catch (error) {
        throw new DatabaseConfigError(
          `DATABASE_URL is not a valid database connection string. Check the value in Vercel → Settings → Environment Variables (no quotes or extra text). (${redactDatabaseError(error)})`,
        );
      }
      await sql.transaction([
        sql`CREATE TABLE IF NOT EXISTS planner_users (
          id             text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
          username       text NOT NULL,
          username_lower text NOT NULL UNIQUE,
          email_lower    text UNIQUE,
          display_name   text NOT NULL,
          role           text NOT NULL CHECK (role IN ('personal','student','guardian')),
          created_at     timestamptz NOT NULL DEFAULT now()
        )`,
        sql`CREATE TABLE IF NOT EXISTS planner_credentials (
          user_id     text PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
          kdf_salt    text NOT NULL,
          auth_hash   text NOT NULL,
          hash_salt   text NOT NULL,
          recovery_hash      text,
          recovery_hash_salt text,
          updated_at         timestamptz NOT NULL DEFAULT now()
        )`,
        sql`ALTER TABLE planner_credentials ADD COLUMN IF NOT EXISTS recovery_hash text`,
        sql`ALTER TABLE planner_credentials ADD COLUMN IF NOT EXISTS recovery_hash_salt text`,
        sql`CREATE TABLE IF NOT EXISTS planner_vaults (
          user_id          text PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
          version          integer NOT NULL CHECK (version > 0),
          ciphertext       text NOT NULL,
          wrapped_dek      text NOT NULL,
          wrapped_recovery text NOT NULL,
          updated_at       timestamptz NOT NULL DEFAULT now()
        )`,
        sql`CREATE TABLE IF NOT EXISTS planner_sessions (
          id           text PRIMARY KEY,
          user_id      text NOT NULL REFERENCES planner_users(id) ON DELETE CASCADE,
          token_hash   text NOT NULL UNIQUE,
          label        text NOT NULL DEFAULT '',
          created_at   timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now(),
          expires_at   timestamptz NOT NULL
        )`,
        sql`CREATE INDEX IF NOT EXISTS planner_sessions_user_idx ON planner_sessions (user_id)`,
        sql`CREATE TABLE IF NOT EXISTS planner_links (
          id                     text PRIMARY KEY,
          guardian_id            text NOT NULL REFERENCES planner_users(id) ON DELETE CASCADE,
          student_id             text REFERENCES planner_users(id) ON DELETE CASCADE,
          student_username_lower text NOT NULL,
          code_hash              text NOT NULL,
          wrapped_share          text NOT NULL,
          share_ciphertext       text,
          share_week             text,
          share_updated_at       timestamptz,
          status                 text NOT NULL CHECK (status IN ('pending','linked','revoked')),
          note_to_student        text,
          note_to_guardian       text,
          note_week              text,
          created_at             timestamptz NOT NULL DEFAULT now(),
          updated_at             timestamptz NOT NULL DEFAULT now(),
          UNIQUE (guardian_id, student_username_lower)
        )`,
        sql`CREATE INDEX IF NOT EXISTS planner_links_student_idx ON planner_links (student_username_lower)`,
        sql`CREATE INDEX IF NOT EXISTS planner_links_student_id_idx ON planner_links (student_id)`,
        sql`CREATE TABLE IF NOT EXISTS planner_passkeys (
          credential_id   text PRIMARY KEY,
          user_id         text NOT NULL REFERENCES planner_users(id) ON DELETE CASCADE,
          public_key      text NOT NULL,
          label           text NOT NULL DEFAULT '',
          sign_count      integer NOT NULL DEFAULT 0,
          prf_wrapped_dek text,
          transports      text NOT NULL DEFAULT '',
          created_at      timestamptz NOT NULL DEFAULT now(),
          last_used_at    timestamptz
        )`,
        sql`CREATE INDEX IF NOT EXISTS planner_passkeys_user_idx ON planner_passkeys (user_id)`,
      ]);
    })().catch((error: unknown) => {
      ready = null;
      throw error;
    });
    return ready;
  };

  return withLoggedFailures({
    async createAccount(input) {
      await ensure();
      const id = newId();
      // Claim the name first: on a conflict this does nothing and we can answer
      // "taken" without touching anything else.
      const rows = (await sql`
        INSERT INTO planner_users (id, username, username_lower, email_lower, display_name, role)
        VALUES (${id}, ${input.username}, ${input.username.toLowerCase()}, ${input.email}, ${input.displayName}, ${input.role})
        ON CONFLICT DO NOTHING
        RETURNING id, username, username_lower, email_lower, display_name, role, created_at
      `) as UserRow[];
      const user = rows[0];
      if (!user) {
        // Unique conflict: report which field collided without leaking the row.
        const clash = (await sql`SELECT email_lower FROM planner_users WHERE username_lower = ${input.username.toLowerCase()}`) as {
          email_lower: string | null;
        }[];
        if (clash.length > 0) return { ok: false, reason: 'username_taken' };
        return { ok: false, reason: 'email_taken' };
      }

      const [credential, verifiers] = await Promise.all([
        hashCredential(input.authToken),
        hashRecoveryVerifiers(input.recoveryHashes),
      ]);
      const first = verifiers[0];
      try {
        // Credentials and vault land together: an account with one but not the
        // other could never sign in, and the name would be gone for good.
        await sql.transaction([
          sql`
            INSERT INTO planner_credentials
              (user_id, kdf_salt, auth_hash, hash_salt, recovery_hash, recovery_hash_salt, recovery_verifiers)
            VALUES
              (${id}, ${input.kdfSalt}, ${credential.authHash}, ${credential.hashSalt},
               ${first?.hash ?? null}, ${first?.salt ?? null}, ${JSON.stringify(verifiers)})
          `,
          sql`
            INSERT INTO planner_vaults (user_id, version, ciphertext, wrapped_dek, wrapped_recovery)
            VALUES (${id}, 1, ${input.ciphertext}, ${input.wrappedDek}, ${JSON.stringify(input.wrappedRecovery)})
          `,
        ]);
      } catch (error) {
        // Give the name back rather than leaving a dead account behind.
        await sql`DELETE FROM planner_users WHERE id = ${id}`.catch(() => undefined);
        throw error;
      }
      return { ok: true, user };
    },

    async findAccount(login) {
      await ensure();
      const needle = login.trim().toLowerCase();
      const rows = (await sql`
        SELECT u.id, u.username, u.username_lower, u.email_lower, u.display_name, u.role, u.created_at,
               c.kdf_salt, c.hash_salt, c.auth_hash
        FROM planner_users u
        JOIN planner_credentials c ON c.user_id = u.id
        WHERE u.username_lower = ${needle} OR u.email_lower = ${needle}
        LIMIT 1
      `) as (UserRow & { kdf_salt: string; hash_salt: string; auth_hash: string })[];
      const row = rows[0];
      if (!row) return null;
      return { user: row, kdfSalt: row.kdf_salt, hashSalt: row.hash_salt, authHash: row.auth_hash };
    },

    async recoverAccount(login, recoveryHash, update) {
      await ensure();
      const needle = login.trim().toLowerCase();
      const rows = (await sql`
        SELECT u.id, c.recovery_hash, c.recovery_hash_salt, c.recovery_verifiers
        FROM planner_users u
        JOIN planner_credentials c ON c.user_id = u.id
        JOIN planner_vaults v ON v.user_id = u.id
        WHERE u.username_lower = ${needle} OR u.email_lower = ${needle}
        LIMIT 1
      `) as {
        id: string;
        recovery_hash: string | null;
        recovery_hash_salt: string | null;
        recovery_verifiers: string | null;
      }[];
      const row = rows[0];
      const verifiers = row ? parseRecoveryVerifiers(row.recovery_verifiers, row.recovery_hash, row.recovery_hash_salt) : [];
      if (verifiers.length === 0) {
        await spendRecoveryFailureWork(recoveryHash);
        return false;
      }
      // Any code in the set works, and the server cannot tell which one it was.
      const candidates = await Promise.all(verifiers.map((v) => hashAuthToken(recoveryHash, v.salt)));
      if (!verifiers.some((v, index) => safeEqual(v.hash, candidates[index]))) return false;

      const credential = await hashCredential(update.authToken);
      const nextVerifiers = await hashRecoveryVerifiers(update.newRecoveryHashes);
      const nextFirst = nextVerifiers[0];
      const updated = (await sql`
        WITH credential_update AS (
          UPDATE planner_credentials
          SET kdf_salt = ${update.kdfSalt}, auth_hash = ${credential.authHash},
              hash_salt = ${credential.hashSalt}, recovery_hash = ${nextFirst?.hash ?? null},
              recovery_hash_salt = ${nextFirst?.salt ?? null},
              recovery_verifiers = ${JSON.stringify(nextVerifiers)},
              totp_secret = NULL, totp_confirmed_at = NULL, totp_last_step = NULL, updated_at = now()
          WHERE user_id = ${row.id}
            AND recovery_verifiers IS NOT DISTINCT FROM ${row.recovery_verifiers}
          RETURNING user_id
        ),
        vault_update AS (
          UPDATE planner_vaults
          SET wrapped_dek = ${update.wrappedDek}, wrapped_recovery = ${JSON.stringify(update.wrappedRecovery)}, updated_at = now()
          WHERE user_id IN (SELECT user_id FROM credential_update)
          RETURNING user_id
        ),
        sessions_delete AS (
          DELETE FROM planner_sessions WHERE user_id IN (SELECT user_id FROM credential_update)
          RETURNING id
        )
        SELECT user_id FROM credential_update
      `) as { user_id: string }[];
      return updated.length > 0;
    },

    async findUserById(id) {
      await ensure();
      const rows = (await sql`SELECT * FROM planner_users WHERE id = ${id}`) as UserRow[];
      return rows[0] ?? null;
    },

    async updateRecovery(userId, update) {
      await ensure();
      const nextVerifiers = await hashRecoveryVerifiers(update.newRecoveryHashes);
      const first = nextVerifiers[0];
      const rows = (await sql`
        WITH credential_update AS (
          UPDATE planner_credentials
          SET recovery_hash = ${first?.hash ?? null}, recovery_hash_salt = ${first?.salt ?? null},
              recovery_verifiers = ${JSON.stringify(nextVerifiers)}, updated_at = now()
          WHERE user_id = ${userId}
          RETURNING user_id
        ),
        vault_update AS (
          UPDATE planner_vaults
          SET wrapped_dek = ${update.wrappedDek}, wrapped_recovery = ${JSON.stringify(update.wrappedRecovery)}, updated_at = now()
          WHERE user_id IN (SELECT user_id FROM credential_update)
          RETURNING user_id
        )
        SELECT user_id FROM credential_update
      `) as { user_id: string }[];
      return rows.length > 0;
    },

    async getVault(userId) {
      await ensure();
      // Aliased: the rest of the code reads camelCase names.
      const rows = (await sql`
        SELECT version, ciphertext, wrapped_dek AS "wrappedDek", wrapped_recovery AS "wrappedRecovery", updated_at
        FROM planner_vaults WHERE user_id = ${userId}
      `) as VaultRow[];
      const row = rows[0];
      if (!row) return null;
      // Rows written before codes came in sets hold one plain wrapped copy;
      // callers always get a list.
      return { ...row, wrappedRecovery: parseRecoveryWraps(row.wrappedRecovery) };
    },

    async putVault(userId, baseVersion, ciphertext) {
      await ensure();
      const rows = (baseVersion === 0
        ? await sql`INSERT INTO planner_vaults (user_id, version, ciphertext, wrapped_dek, wrapped_recovery)
            VALUES (${userId}, 1, ${ciphertext}, '', '')
            ON CONFLICT (user_id) DO NOTHING
            RETURNING version, ciphertext, wrapped_dek AS "wrappedDek", wrapped_recovery AS "wrappedRecovery", updated_at`
        : await sql`UPDATE planner_vaults
            SET version = version + 1, ciphertext = ${ciphertext}, updated_at = now()
            WHERE user_id = ${userId} AND version = ${baseVersion}
            RETURNING version, ciphertext, wrapped_dek AS "wrappedDek", wrapped_recovery AS "wrappedRecovery", updated_at`) as VaultRow[];
      return rows[0] ?? null;
    },

    async updateCredential(userId, kdfSalt, authToken) {
      await ensure();
      const credential = await hashCredential(authToken);
      await sql`UPDATE planner_credentials
        SET kdf_salt = ${kdfSalt}, auth_hash = ${credential.authHash}, hash_salt = ${credential.hashSalt}, updated_at = now()
        WHERE user_id = ${userId}`;
    },

    async createSession(userId, tokenHash, label, expiresAt) {
      await ensure();
      // Housekeeping while we are here: expired rows are dead weight, and this
      // keeps the table bounded without a cron job.
      await sql`DELETE FROM planner_sessions WHERE user_id = ${userId} AND expires_at < now()`;
      await sql`INSERT INTO planner_sessions (id, user_id, token_hash, label, expires_at) VALUES (${newId()}, ${userId}, ${tokenHash}, ${label.slice(0, 60)}, ${expiresAt.toISOString()})`;
    },

    async findSession(tokenHash) {
      await ensure();
      const rows = (await sql`
        SELECT s.id, s.user_id, s.expires_at, s.last_seen_at, u.id AS u_id, u.username, u.username_lower, u.email_lower,
               u.display_name, u.role, u.created_at
        FROM planner_sessions s
        JOIN planner_users u ON u.id = s.user_id
        WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()
        LIMIT 1
      `) as (SessionRow & { u_id: string; username: string; username_lower: string; email_lower: string | null; display_name: string; role: AccountRole; created_at: string; last_seen_at: string | Date })[];
      const row = rows[0];
      if (!row) return null;
      // "Last seen" is only worth a write about once a minute: it is a hint for
      // the devices list, not an audit log, and this runs on every request.
      const seen = new Date(row.last_seen_at).getTime();
      if (!Number.isFinite(seen) || Date.now() - seen > 60_000) {
        await sql`UPDATE planner_sessions SET last_seen_at = now() WHERE id = ${row.id}`;
      }
      return {
        session: { id: row.id, user_id: row.user_id, expires_at: row.expires_at },
        user: {
          id: row.u_id,
          username: row.username,
          username_lower: row.username_lower,
          email_lower: row.email_lower,
          display_name: row.display_name,
          role: row.role,
          created_at: row.created_at,
        },
      };
    },

    async deleteSession(id) {
      await ensure();
      await sql`DELETE FROM planner_sessions WHERE id = ${id}`;
    },

    async getTotp(userId) {
      await ensure();
      const rows = (await sql`
        SELECT totp_secret AS secret, totp_confirmed_at AS "confirmedAt", totp_last_step AS "lastStep"
        FROM planner_credentials WHERE user_id = ${userId}
      `) as { secret: string | null; confirmedAt: string | Date | null; lastStep: number | string | null }[];
      const row = rows[0];
      if (!row) return null;
      return {
        secret: row.secret ?? null,
        confirmedAt: row.confirmedAt ? new Date(row.confirmedAt).toISOString() : null,
        // bigint comes back from the driver as a string.
        lastStep: row.lastStep === null || row.lastStep === undefined ? null : Number(row.lastStep),
      };
    },

    async setTotpSecret(userId, secret) {
      await ensure();
      await sql`UPDATE planner_credentials
        SET totp_secret = ${secret}, totp_confirmed_at = NULL, totp_last_step = NULL, updated_at = now()
        WHERE user_id = ${userId}`;
    },

    async confirmTotp(userId) {
      await ensure();
      await sql`UPDATE planner_credentials
        SET totp_confirmed_at = now(), updated_at = now()
        WHERE user_id = ${userId}`;
    },

    async recordTotpStep(userId, step) {
      await ensure();
      await sql`UPDATE planner_credentials
        SET totp_last_step = ${step}, updated_at = now()
        WHERE user_id = ${userId}`;
    },

    async createLoginChallenge(userId, tokenHash, expiresAt) {
      await ensure();
      // One live challenge per account; anything expired is dead weight, and
      // this keeps the table bounded without a cron job.
      await sql`DELETE FROM planner_login_challenges
        WHERE user_id = ${userId} OR expires_at < now()`;
      await sql`INSERT INTO planner_login_challenges (token_hash, user_id, expires_at)
        VALUES (${tokenHash}, ${userId}, ${expiresAt.toISOString()})`;
    },

    async findLoginChallenge(tokenHash) {
      await ensure();
      const rows = (await sql`
        SELECT c.user_id, u.id, u.username, u.username_lower, u.email_lower, u.display_name, u.role, u.created_at
        FROM planner_login_challenges c
        JOIN planner_users u ON u.id = c.user_id
        WHERE c.token_hash = ${tokenHash} AND c.expires_at > now()
        LIMIT 1
      `) as (UserRow & { user_id: string })[];
      const row = rows[0];
      if (!row) return null;
      return { user: { id: row.id, username: row.username, username_lower: row.username_lower, email_lower: row.email_lower, display_name: row.display_name, role: row.role, created_at: row.created_at } };
    },

    async deleteLoginChallenge(tokenHash) {
      await ensure();
      await sql`DELETE FROM planner_login_challenges WHERE token_hash = ${tokenHash}`;
    },

    async listSessions(userId) {
      await ensure();
      const rows = (await sql`
        SELECT id, label, created_at AS "createdAt", last_seen_at AS "lastSeenAt", expires_at AS "expiresAt"
        FROM planner_sessions
        WHERE user_id = ${userId} AND expires_at > now()
        ORDER BY last_seen_at DESC
      `) as { id: string; label: string; createdAt: string | Date; lastSeenAt: string | Date; expiresAt: string | Date }[];
      const iso = (value: string | Date) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: iso(row.createdAt),
        lastSeenAt: iso(row.lastSeenAt),
        expiresAt: iso(row.expiresAt),
      }));
    },

    async deleteSessionForUser(id, userId) {
      await ensure();
      const rows = (await sql`
        DELETE FROM planner_sessions WHERE id = ${id} AND user_id = ${userId} RETURNING id
      `) as { id: string }[];
      return rows.length > 0;
    },

    async deleteOtherSessions(userId, keepId) {
      await ensure();
      const rows = (await sql`
        DELETE FROM planner_sessions WHERE user_id = ${userId} AND id <> ${keepId} RETURNING id
      `) as { id: string }[];
      return rows.length;
    },

    async recordAuthEvent(event) {
      await ensure();
      const network = event.network ?? null;
      // "Have we seen this place before?" is answered inside the insert, so
      // two sign-ins at once cannot both read "no" and both claim to be new.
      await sql`INSERT INTO planner_auth_events (id, user_id, kind, device_label, network, new_network)
        VALUES (
          ${newId()}, ${event.userId}, ${event.kind}, ${event.deviceLabel ?? ''}, ${network},
          ${network} IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM planner_auth_events
              WHERE user_id = ${event.userId} AND network = ${network}
            )
        )`;
      // Bounded without a cron job: the log is for reading, not for hoarding.
      await sql`DELETE FROM planner_auth_events
        WHERE user_id = ${event.userId}
          AND id NOT IN (
            SELECT id FROM planner_auth_events
            WHERE user_id = ${event.userId}
            ORDER BY created_at DESC
            LIMIT ${AUTH_EVENT_LIMIT}
          )`;
      await sql`DELETE FROM planner_auth_events
        WHERE user_id = ${event.userId} AND created_at < now() - make_interval(days => ${AUTH_EVENT_DAYS})`;
    },

    async listAuthEvents(userId, limit = AUTH_EVENT_LIMIT) {
      await ensure();
      const take = Math.max(1, Math.min(limit, AUTH_EVENT_LIMIT));
      const rows = (await sql`
        SELECT id, kind, device_label AS "deviceLabel", created_at AS "at", network, new_network AS "newNetwork"
        FROM planner_auth_events
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${take}
      `) as { id: string; kind: string; deviceLabel: string | null; at: string | Date; network: string | null; newNetwork: boolean | null }[];
      return rows.map((row) => ({
        id: row.id,
        kind: cleanAuthEventKind(row.kind) ?? 'password',
        deviceLabel: row.deviceLabel ?? '',
        at: row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString(),
        network: row.network ?? null,
        newNetwork: Boolean(row.newNetwork),
      }));
    },

    async deleteAccount(userId) {
      await ensure();
      const rows = (await sql`DELETE FROM planner_users WHERE id = ${userId} RETURNING id`) as Array<{ id: string }>;
      return rows.length > 0;
    },

    async createLink(input) {
      await ensure();
      const rows = (await sql`
        INSERT INTO planner_links (id, guardian_id, student_username_lower, code_hash, wrapped_share, status)
        VALUES (${input.id}, ${input.guardianId}, ${input.studentUsernameLower}, ${input.codeHash}, ${input.wrappedShare}, 'pending')
        ON CONFLICT (guardian_id, student_username_lower) DO NOTHING
        RETURNING *
      `) as LinkRow[];
      return rows[0] ?? null;
    },

    async listOutgoingLinks(guardianId) {
      await ensure();
      const rows = (await sql`
        SELECT * FROM planner_links WHERE guardian_id = ${guardianId} AND status <> 'revoked' ORDER BY created_at
      `) as LinkRow[];
      return rows;
    },

    async listIncomingLinks(user) {
      await ensure();
      const rows = (await sql`
        SELECT l.*, u.username AS guardian_username, u.display_name AS guardian_display_name
        FROM planner_links l
        JOIN planner_users u ON u.id = l.guardian_id
        WHERE (l.student_username_lower = ${user.usernameLower} AND l.status = 'pending')
           OR (l.student_id = ${user.id} AND l.status = 'linked')
        ORDER BY l.created_at
      `) as (LinkRow & { guardian_username: string; guardian_display_name: string })[];
      return rows;
    },

    async acceptLink(codeHash, student) {
      await ensure();
      const rows = (await sql`
        UPDATE planner_links SET status = 'linked', student_id = ${student.id}, updated_at = now()
        WHERE code_hash = ${codeHash} AND student_username_lower = ${student.usernameLower} AND status = 'pending'
        RETURNING *
      `) as LinkRow[];
      return rows[0] ?? null;
    },

    async putShare(linkId, studentId, ciphertext, weekOf) {
      await ensure();
      const rows = (await sql`
        UPDATE planner_links
        SET share_ciphertext = ${ciphertext}, share_week = ${weekOf}, share_updated_at = now(), updated_at = now()
        WHERE id = ${linkId} AND student_id = ${studentId} AND status = 'linked'
        RETURNING *
      `) as LinkRow[];
      return rows[0] ?? null;
    },

    async getShare(linkId, guardianId) {
      await ensure();
      const rows = (await sql`SELECT * FROM planner_links WHERE id = ${linkId} AND guardian_id = ${guardianId}`) as LinkRow[];
      return rows[0] ?? null;
    },

    async putNote(linkId, userId, to, ciphertext, weekOf) {
      await ensure();
      // Two plain statements rather than a fragment: easier to read, and the
      // test double understands them.
      const rows = (to === 'student'
        ? await sql`
            UPDATE planner_links
            SET note_to_student = ${ciphertext}, note_week = ${weekOf}, updated_at = now()
            WHERE id = ${linkId} AND status = 'linked' AND guardian_id = ${userId}
            RETURNING *
          `
        : await sql`
            UPDATE planner_links
            SET note_to_guardian = ${ciphertext}, note_week = ${weekOf}, updated_at = now()
            WHERE id = ${linkId} AND status = 'linked' AND student_id = ${userId}
            RETURNING *
          `) as LinkRow[];
      return rows[0] ?? null;
    },

    async getNote(linkId, userId) {
      await ensure();
      const rows = (await sql`SELECT * FROM planner_links WHERE id = ${linkId}`) as LinkRow[];
      const row = rows[0];
      if (!row || (row.guardian_id !== userId && row.student_id !== userId)) return null;
      const ciphertext = row.guardian_id === userId ? row.note_to_guardian : row.note_to_student;
      return { ciphertext, weekOf: row.note_week };
    },

    async deleteLink(linkId, userId) {
      await ensure();
      const rows = (await sql`
        DELETE FROM planner_links WHERE id = ${linkId} AND (guardian_id = ${userId} OR student_id = ${userId}) RETURNING id
      `) as { id: string }[];
      return rows.length > 0;
    },

    async createPasskey(input) {
      await ensure();
      const rows = (await sql`
        INSERT INTO planner_passkeys (credential_id, user_id, public_key, label, sign_count, prf_wrapped_dek, transports, created_at, last_used_at)
        VALUES (${input.credentialId}, ${input.userId}, ${input.publicKey}, ${input.label}, ${input.signCount}, ${input.prfWrappedDek}, ${input.transports}, now(), NULL)
        ON CONFLICT (credential_id) DO NOTHING
        RETURNING *
      `) as PasskeyRow[];
      return rows[0] ?? null;
    },

    async listPasskeys(userId) {
      await ensure();
      const rows = (await sql`SELECT * FROM planner_passkeys WHERE user_id = ${userId} ORDER BY created_at`) as PasskeyRow[];
      return rows;
    },

    async findPasskey(credentialId) {
      await ensure();
      const rows = (await sql`SELECT * FROM planner_passkeys WHERE credential_id = ${credentialId} LIMIT 1`) as PasskeyRow[];
      return rows[0] ?? null;
    },

    async touchPasskey(credentialId, signCount) {
      await ensure();
      await sql`UPDATE planner_passkeys SET sign_count = ${signCount}, last_used_at = now() WHERE credential_id = ${credentialId}`;
    },

    async deletePasskey(userId, credentialId) {
      await ensure();
      const rows = (await sql`
        DELETE FROM planner_passkeys WHERE credential_id = ${credentialId} AND user_id = ${userId} RETURNING credential_id
      `) as { credential_id: string }[];
      return rows.length > 0;
    },
  });
}

let cached: { url: string | null; store: Promise<AuthStore | null> } | null = null;

/**
 * Resolves the store for a request. Production requires a real database;
 * development and preview fall back to memory so the app is usable with no
 * configuration, which is why the fallback is explicit rather than silent.
 */
export function authStore(databaseUrl: string | undefined): Promise<AuthStore | null> {
  const url = cleanDatabaseUrl(databaseUrl ?? '') || null;
  if (!url) {
    if (process.env.NODE_ENV === 'production') return Promise.resolve(null);
    return Promise.resolve((cached ??= { url: null, store: Promise.resolve(createMemoryAuthStore()) }).store);
  }
  if (cached && cached.url === url) return cached.store;
  cached = { url, store: createNeonAuthStore(url) };
  return cached.store;
}
