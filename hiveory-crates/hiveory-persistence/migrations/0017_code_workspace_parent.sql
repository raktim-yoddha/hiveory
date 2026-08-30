ALTER TABLE hiveory_code_workspaces
    ADD COLUMN parent_workspace_id TEXT REFERENCES hiveory_code_workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_code_workspaces_parent
    ON hiveory_code_workspaces(parent_workspace_id);
