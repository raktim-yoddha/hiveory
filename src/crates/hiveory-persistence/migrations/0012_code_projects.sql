CREATE TABLE IF NOT EXISTS agentic_super_app_code_projects (
    id TEXT PRIMARY KEY NOT NULL,
    host_id TEXT NOT NULL,
    root_path TEXT NOT NULL,
    canonical_root_path TEXT NOT NULL,
    display_name TEXT NOT NULL,
    repository_name TEXT,
    project_kind TEXT NOT NULL DEFAULT 'folder',
    current_branch TEXT,
    primary_workspace_id TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1,
    unavailable_reason TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_projects_host_root
    ON agentic_super_app_code_projects(host_id, canonical_root_path);

ALTER TABLE agentic_super_app_code_workspaces ADD COLUMN project_id TEXT;
ALTER TABLE agentic_super_app_code_workspaces ADD COLUMN workspace_kind TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE agentic_super_app_code_workspaces ADD COLUMN worktree_name TEXT;
ALTER TABLE agentic_super_app_code_workspaces ADD COLUMN base_ref TEXT;
ALTER TABLE agentic_super_app_code_workspaces ADD COLUMN managed_by_app INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agentic_super_app_code_workspaces ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agentic_super_app_code_workspaces ADD COLUMN unavailable_reason TEXT;

INSERT OR IGNORE INTO agentic_super_app_code_projects (
    id,
    host_id,
    root_path,
    canonical_root_path,
    display_name,
    repository_name,
    project_kind,
    current_branch,
    primary_workspace_id,
    available,
    created_at_unix_ms,
    updated_at_unix_ms
)
SELECT
    'project-' || id,
    host_id,
    root_path,
    canonical_root_path,
    display_name,
    repository_name,
    CASE WHEN is_git_repository != 0 THEN 'git' ELSE 'folder' END,
    branch,
    id,
    1,
    created_at_unix_ms,
    updated_at_unix_ms
FROM agentic_super_app_code_workspaces;

UPDATE agentic_super_app_code_workspaces
SET project_id = 'project-' || id
WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_code_workspaces_project_updated
    ON agentic_super_app_code_workspaces(project_id, updated_at_unix_ms DESC);
