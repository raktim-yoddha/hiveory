CREATE TABLE IF NOT EXISTS agentic_super_app_code_workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    host_id TEXT NOT NULL,
    root_path TEXT NOT NULL,
    canonical_root_path TEXT NOT NULL,
    display_name TEXT NOT NULL,
    repository_name TEXT,
    branch TEXT,
    is_git_repository INTEGER NOT NULL DEFAULT 0,
    trust_state TEXT NOT NULL DEFAULT 'untrusted',
    trusted_at_unix_ms INTEGER,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_workspaces_host_root
    ON agentic_super_app_code_workspaces(host_id, canonical_root_path);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_layouts (
    workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES agentic_super_app_code_workspaces(id) ON DELETE CASCADE,
    layout_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_documents (
    workspace_id TEXT NOT NULL REFERENCES agentic_super_app_code_workspaces(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    last_fingerprint TEXT,
    language TEXT,
    last_opened_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, relative_path)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_terminals (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES agentic_super_app_code_workspaces(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    pid INTEGER,
    adapter_id TEXT,
    session_id TEXT,
    exit_code INTEGER,
    started_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_terminals_workspace_updated
    ON agentic_super_app_code_terminals(workspace_id, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_previews (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES agentic_super_app_code_workspaces(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    origin TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);
