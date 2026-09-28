-- Planner account storage (Neon / Postgres).
-- The API creates these tables automatically on first use; run this yourself if
-- you prefer to provision them up front.
--
-- What the server can read: usernames, emails, roles, session records, and the
-- encrypted vault blob. What it can never read: passwords (they never arrive),
-- the vault key, or anything inside the planner.

CREATE TABLE IF NOT EXISTS planner_users (
  id             text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
  username       text NOT NULL,
  username_lower text NOT NULL UNIQUE,
  email_lower    text UNIQUE,
  display_name   text NOT NULL,
  role           text NOT NULL CHECK (role IN ('personal','student','guardian')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- auth_hash is a server-side scrypt of the client's Argon2id output. The
-- password itself is never transmitted, so it cannot be stored or leaked here.
CREATE TABLE IF NOT EXISTS planner_credentials (
  user_id     text PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
  kdf_salt    text NOT NULL,
  auth_hash   text NOT NULL,
  hash_salt   text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ciphertex           the whole planner, encrypted in the browser (AES-GCM-256)
-- wrapped_dek         the vault key, encrypted under the password key
-- wrapped_recovery    the vault key, encrypted under the recovery key
-- The server can hand all three back but can open none of them.
CREATE TABLE IF NOT EXISTS planner_vaults (
  user_id          text PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
  version          integer NOT NULL CHECK (version > 0),
  ciphertext       text NOT NULL,
  wrapped_dek      text NOT NULL,
  wrapped_recovery text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- token_hash is the session cookie value passed through a one-way hash, so a
-- database leak does not hand over live sessions.
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
