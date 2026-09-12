CREATE TABLE IF NOT EXISTS agentic_super_app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_provider_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  provider_kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  default_model TEXT,
  secret_ref TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS agentic_super_app_job_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES agentic_super_app_jobs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  summary TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_audit_entries (
  id TEXT PRIMARY KEY NOT NULL,
  action_code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  severity TEXT NOT NULL,
  target TEXT,
  redacted_context TEXT,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL,
  read_at_unix_ms INTEGER,
  created_at_unix_ms INTEGER NOT NULL
);
