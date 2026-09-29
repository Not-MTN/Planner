-- Planner sync storage (Neon / Postgres).
-- The API creates this table automatically on first use; run it yourself if you prefer.
-- Rows hold only client-side-encrypted blobs. The id is a SHA-256 hash of the user's sync code.
CREATE TABLE IF NOT EXISTS planner_sync (
  id          text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  version     integer NOT NULL CHECK (version > 0),
  ciphertext  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Web Push subscriptions and opaque scheduled reminder keys. Planner sends
-- generic notification text; task/event titles are never uploaded here.
CREATE TABLE IF NOT EXISTS planner_push_subscriptions (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS planner_push_jobs (
  subscription_id text NOT NULL REFERENCES planner_push_subscriptions(id) ON DELETE CASCADE,
  reminder_key text NOT NULL,
  send_at timestamptz NOT NULL,
  PRIMARY KEY (subscription_id, reminder_key)
);
CREATE INDEX IF NOT EXISTS planner_push_jobs_due_idx ON planner_push_jobs (send_at);
