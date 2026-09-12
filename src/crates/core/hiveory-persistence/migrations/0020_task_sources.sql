-- Per-workspace task providers. Secrets are intentionally stored outside
-- SQLite: secret_ref points to the operating-system keyring.
CREATE TABLE IF NOT EXISTS hiveory_task_sources (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES hiveory_code_workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'jira', 'linear')),
  label TEXT NOT NULL,
  endpoint TEXT,
  account_label TEXT,
  secret_ref TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  validated_at_unix_ms INTEGER,
  last_error TEXT,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  UNIQUE(workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_task_sources_workspace
  ON hiveory_task_sources(workspace_id, updated_at_unix_ms DESC);
