CREATE TABLE IF NOT EXISTS hiveory_code_launch_presets (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES hiveory_code_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entries_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_launch_presets_workspace_updated
  ON hiveory_code_launch_presets(workspace_id, updated_at_unix_ms DESC);
