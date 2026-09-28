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

-- A guardian's request to follow a student. code_hash is all the server ever
-- sees of the pairing code; wrapped_share is the results key sealed by a key
-- derived from that code, so the server cannot read the results either. The
-- results themselves (share_ciphertext) are replaced every week — only the
-- newest week is kept.
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
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guardian_id, student_username_lower)
);

CREATE INDEX IF NOT EXISTS planner_links_student_idx ON planner_links (student_username_lower);
CREATE INDEX IF NOT EXISTS planner_links_student_id_idx ON planner_links (student_id);

-- ---------------------------------------------------------------------------
-- Starting over (optional)
-- ---------------------------------------------------------------------------
-- Accounts created before 28 Sep 2026 stored a credential hash made with a
-- different salt than the one saved next to it, so those accounts can never
-- sign in. Nothing can repair them (the password itself never reached the
-- server). If you created an account while that bug was live, clear the tables
-- and sign up again:
--
--   DROP TABLE IF EXISTS planner_sessions, planner_vaults, planner_credentials, planner_users;
--
-- The API recreates them, empty, on the next request.
