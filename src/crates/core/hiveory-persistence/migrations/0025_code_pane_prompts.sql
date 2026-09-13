CREATE TABLE hiveory_code_pane_prompts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    pane_id TEXT NOT NULL,
    terminal_id TEXT NOT NULL,
    session_id TEXT,
    prompt TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'delivering', 'delivered', 'failed', 'uncertain')),
    ready_sequence INTEGER,
    error TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    UNIQUE(workspace_id, client_request_id)
);

CREATE INDEX hiveory_code_pane_prompts_pending
    ON hiveory_code_pane_prompts(workspace_id, pane_id, state, created_at_unix_ms);
