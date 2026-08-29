CREATE TABLE IF NOT EXISTS agentic_super_app_code_worker_resources (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES agentic_super_app_code_tasks(id) ON DELETE SET NULL,
    dispatch_id TEXT NOT NULL REFERENCES agentic_super_app_code_dispatches(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES agentic_super_app_code_workspaces(id) ON DELETE CASCADE,
    pane_id TEXT,
    terminal_id TEXT,
    process_id INTEGER,
    process_incarnation TEXT NOT NULL,
    ownership TEXT NOT NULL,
    state TEXT NOT NULL,
    lease_generation INTEGER NOT NULL,
    retained INTEGER NOT NULL DEFAULT 0,
    output_archive_path TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    UNIQUE(dispatch_id, lease_generation)
);

CREATE INDEX IF NOT EXISTS idx_code_worker_resources_run_state
    ON agentic_super_app_code_worker_resources(run_id, state, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_completion_reports (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES agentic_super_app_code_tasks(id) ON DELETE SET NULL,
    dispatch_id TEXT NOT NULL REFERENCES agentic_super_app_code_dispatches(id) ON DELETE CASCADE,
    outcome TEXT NOT NULL,
    summary TEXT NOT NULL,
    files_json TEXT NOT NULL,
    tests_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    remaining_work_json TEXT NOT NULL,
    artifact_path TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    UNIQUE(dispatch_id)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_decision_gates (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES agentic_super_app_code_tasks(id) ON DELETE SET NULL,
    dispatch_id TEXT REFERENCES agentic_super_app_code_dispatches(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    reason TEXT NOT NULL,
    state TEXT NOT NULL,
    allowed_actor TEXT NOT NULL,
    resolved_by TEXT,
    resolution TEXT,
    expires_at_unix_ms INTEGER,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_gates_run_state
    ON agentic_super_app_code_decision_gates(run_id, state, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_task_path_claims (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES agentic_super_app_code_tasks(id) ON DELETE CASCADE,
    dispatch_id TEXT REFERENCES agentic_super_app_code_dispatches(id) ON DELETE SET NULL,
    relative_path TEXT NOT NULL,
    access_mode TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    UNIQUE(run_id, task_id, relative_path, access_mode)
);

CREATE INDEX IF NOT EXISTS idx_code_path_claims_active_path
    ON agentic_super_app_code_task_path_claims(run_id, relative_path, state);
