CREATE TABLE IF NOT EXISTS hiveory_code_agent_pane_statuses (
    session_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES hiveory_code_workspaces(id) ON DELETE CASCADE,
    terminal_id TEXT,
    pane_id TEXT,
    run_id TEXT REFERENCES hiveory_code_runs(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES hiveory_code_tasks(id) ON DELETE SET NULL,
    participant_address TEXT,
    adapter_id TEXT,
    state TEXT NOT NULL,
    source TEXT NOT NULL,
    summary TEXT,
    sequence INTEGER NOT NULL DEFAULT 0,
    last_cli_report_sequence INTEGER NOT NULL DEFAULT 0,
    updated_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_agent_pane_status_workspace_sequence
    ON hiveory_code_agent_pane_statuses(workspace_id, sequence DESC);

CREATE TABLE IF NOT EXISTS hiveory_code_agent_pane_status_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES hiveory_code_agent_pane_statuses(session_id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES hiveory_code_workspaces(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    source TEXT NOT NULL,
    summary TEXT,
    created_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_agent_pane_status_events_workspace_sequence
    ON hiveory_code_agent_pane_status_events(workspace_id, sequence);
