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
import type { AccountRole } from '../shared/authContract';

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
  updated_at  timestamptz NOT NULL DEFAULT now()
);

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
  wrappedRecovery: string;
  updated_at: string | Date;
}

export interface NewAccount {
  username: string;
  email: string | null;
  displayName: string;
  role: AccountRole;
  kdfSalt: string;
  authToken: string;
  wrappedDek: string;
  wrappedRecovery: string;
  ciphertext: string;
}

export type CreateResult = { ok: true; user: UserRow } | { ok: false; reason: 'username_taken' | 'email_taken' };

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string | Date;
}

export interface AuthStore {
  createAccount(input: NewAccount): Promise<CreateResult>;
  findAccount(login: string): Promise<AccountRow | null>;
  getVault(userId: string): Promise<VaultRow | null>;
  putVault(userId: string, baseVersion: number, ciphertext: string): Promise<VaultRow | null>;
  updateCredential(userId: string, kdfSalt: string, authToken: string): Promise<void>;
  createSession(userId: string, tokenHash: string, label: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string): Promise<{ session: SessionRow; user: UserRow } | null>;
  deleteSession(id: string): Promise<void>;
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

/* ------------------------------------------------------------- memory store */

/** Used only outside production when no database is configured. */
export function createMemoryAuthStore(): AuthStore {
  const users = new Map<string, UserRow>();
  const credentials = new Map<string, { kdfSalt: string; hashSalt: string; authHash: string }>();
  const vaults = new Map<string, VaultRow>();
  const sessions = new Map<string, SessionRow>();

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
      const hashSalt = newSalt();
      credentials.set(user.id, {
        kdfSalt: input.kdfSalt,
        hashSalt,
        authHash: await hashAuthToken(input.authToken, hashSalt),
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
      const hashSalt = newSalt();
      credentials.set(userId, { kdfSalt, hashSalt, authHash: await hashAuthToken(authToken, hashSalt) });
    },
    async createSession(userId, tokenHash, _label, expiresAt) {
      sessions.set(tokenHash, { id: newId(), user_id: userId, expires_at: expiresAt.toISOString() });
    },
    async findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session) return null;
      if (new Date(session.expires_at).getTime() <= Date.now()) {
        sessions.delete(tokenHash);
        return null;
      }
      const user = users.get(session.user_id);
      return user ? { session, user } : null;
    },
    async deleteSession(id) {
      for (const [hash, session] of sessions) {
        if (session.id === id) sessions.delete(hash);
      }
    },
  };
}

/* --------------------------------------------------------------- neon store */

export async function createNeonAuthStore(databaseUrl: string | undefined): Promise<AuthStore | null> {
  const url = databaseUrl?.trim();
  if (!url) return null;
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  let ready: Promise<unknown> | null = null;
  const ensure = () => {
    ready ??= (async () => {
      await sql`CREATE TABLE IF NOT EXISTS planner_users (
        id             text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
        username       text NOT NULL,
        username_lower text NOT NULL UNIQUE,
        email_lower    text UNIQUE,
        display_name   text NOT NULL,
        role           text NOT NULL CHECK (role IN ('personal','student','guardian')),
        created_at     timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS planner_credentials (
        user_id     text PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
        kdf_salt    text NOT NULL,
        auth_hash   text NOT NULL,
        hash_salt   text NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS planner_vaults (
        user_id          text PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
        version          integer NOT NULL CHECK (version > 0),
        ciphertext       text NOT NULL,
        wrapped_dek      text NOT NULL,
        wrapped_recovery text NOT NULL,
        updated_at       timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS planner_sessions (
        id           text PRIMARY KEY,
        user_id      text NOT NULL REFERENCES planner_users(id) ON DELETE CASCADE,
        token_hash   text NOT NULL UNIQUE,
        label        text NOT NULL DEFAULT '',
        created_at   timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at   timestamptz NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS planner_sessions_user_idx ON planner_sessions (user_id)`;
    })().catch((error: unknown) => {
      ready = null;
      throw error;
    });
    return ready;
  };

  return {
    async createAccount(input) {
      await ensure();
      const id = newId();
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
      const hash = await hashAuthToken(input.authToken, newSalt());
      await sql`
        INSERT INTO planner_credentials (user_id, kdf_salt, auth_hash, hash_salt)
        VALUES (${id}, ${input.kdfSalt}, ${hash}, ${newSalt()})
      `;
      await sql`
        INSERT INTO planner_vaults (user_id, version, ciphertext, wrapped_dek, wrapped_recovery)
        VALUES (${id}, 1, ${input.ciphertext}, ${input.wrappedDek}, ${input.wrappedRecovery})
      `;
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

    async getVault(userId) {
      await ensure();
      const rows = (await sql`SELECT version, ciphertext, wrapped_dek, wrapped_recovery, updated_at FROM planner_vaults WHERE user_id = ${userId}`) as VaultRow[];
      return rows[0] ?? null;
    },

    async putVault(userId, baseVersion, ciphertext) {
      await ensure();
      const rows = (baseVersion === 0
        ? await sql`INSERT INTO planner_vaults (user_id, version, ciphertext, wrapped_dek, wrapped_recovery)
            VALUES (${userId}, 1, ${ciphertext}, '', '')
            ON CONFLICT (user_id) DO NOTHING
            RETURNING version, ciphertext, wrapped_dek, wrapped_recovery, updated_at`
        : await sql`UPDATE planner_vaults
            SET version = version + 1, ciphertext = ${ciphertext}, updated_at = now()
            WHERE user_id = ${userId} AND version = ${baseVersion}
            RETURNING version, ciphertext, wrapped_dek, wrapped_recovery, updated_at`) as VaultRow[];
      return rows[0] ?? null;
    },

    async updateCredential(userId, kdfSalt, authToken) {
      await ensure();
      const hash = await hashAuthToken(authToken, newSalt());
      await sql`UPDATE planner_credentials SET kdf_salt = ${kdfSalt}, auth_hash = ${hash}, hash_salt = ${newSalt()}, updated_at = now() WHERE user_id = ${userId}`;
    },

    async createSession(userId, tokenHash, label, expiresAt) {
      await ensure();
      await sql`INSERT INTO planner_sessions (id, user_id, token_hash, label, expires_at) VALUES (${newId()}, ${userId}, ${tokenHash}, ${label.slice(0, 60)}, ${expiresAt.toISOString()})`;
    },

    async findSession(tokenHash) {
      await ensure();
      const rows = (await sql`
        SELECT s.id, s.user_id, s.expires_at, u.id AS u_id, u.username, u.username_lower, u.email_lower,
               u.display_name, u.role, u.created_at
        FROM planner_sessions s
        JOIN planner_users u ON u.id = s.user_id
        WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()
        LIMIT 1
      `) as (SessionRow & { u_id: string; username: string; username_lower: string; email_lower: string | null; display_name: string; role: AccountRole; created_at: string })[];
      const row = rows[0];
      if (!row) return null;
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
  };
}

let cached: { url: string | null; store: Promise<AuthStore | null> } | null = null;

/**
 * Resolves the store for a request. Production requires a real database;
 * development and preview fall back to memory so the app is usable with no
 * configuration, which is why the fallback is explicit rather than silent.
 */
export function authStore(databaseUrl: string | undefined): Promise<AuthStore | null> {
  const url = databaseUrl?.trim() || null;
  if (!url) {
    if (process.env.NODE_ENV === 'production') return Promise.resolve(null);
    return Promise.resolve((cached ??= { url: null, store: Promise.resolve(createMemoryAuthStore()) }).store);
  }
  if (cached && cached.url === url) return cached.store;
  cached = { url, store: createNeonAuthStore(url) };
  return cached.store;
}
