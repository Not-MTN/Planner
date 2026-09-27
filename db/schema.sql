-- Planner sync storage (Neon / Postgres).
-- The API creates this table automatically on first use; run it yourself if you prefer.
-- Rows hold only client-side-encrypted blobs. The id is a SHA-256 hash of the user's sync code.
CREATE TABLE IF NOT EXISTS planner_sync (
  id          text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  version     integer NOT NULL CHECK (version > 0),
  ciphertext  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
