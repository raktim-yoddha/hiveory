CREATE TABLE IF NOT EXISTS agentic_super_app_code_runs (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES agentic_super_app_code_workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    state TEXT NOT NULL,
    review_policy TEXT NOT NULL DEFAULT 'manual',
    model TEXT,
    concurrency_limit INTEGER NOT NULL,
    host_concurrency_cap INTEGER NOT NULL,
    source_checkpoint_id TEXT,
    proposal_json TEXT,
    error TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_runs_workspace_updated
    ON agentic_super_app_code_runs(workspace_id, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    title TEXT NOT NULL,
    specification TEXT NOT NULL,
    state TEXT NOT NULL,
    position INTEGER NOT NULL,
    active_dispatch_id TEXT,
    latest_checkpoint_id TEXT,
    base_checkpoint_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    UNIQUE(run_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_code_tasks_run_position
    ON agentic_super_app_code_tasks(run_id, position);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_task_dependencies (
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES agentic_super_app_code_tasks(id) ON DELETE CASCADE,
    depends_on_task_id TEXT NOT NULL REFERENCES agentic_super_app_code_tasks(id) ON DELETE CASCADE,
    PRIMARY KEY(run_id, task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_dispatches (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES agentic_super_app_code_tasks(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL,
    state TEXT NOT NULL,
    lease_generation INTEGER NOT NULL DEFAULT 1,
    session_id TEXT,
    pid INTEGER,
    worktree_id TEXT,
    checkpoint_id TEXT,
    last_heartbeat_at_unix_ms INTEGER,
    started_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    error TEXT,
    result_summary TEXT,
    UNIQUE(task_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_code_dispatches_run_state
    ON agentic_super_app_code_dispatches(run_id, state, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_worktrees (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES agentic_super_app_code_tasks(id) ON DELETE CASCADE,
    dispatch_id TEXT NOT NULL REFERENCES agentic_super_app_code_dispatches(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    branch TEXT NOT NULL,
    base_checkpoint_id TEXT,
    state TEXT NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_checkpoints (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES agentic_super_app_code_tasks(id) ON DELETE SET NULL,
    dispatch_id TEXT REFERENCES agentic_super_app_code_dispatches(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    ref_name TEXT NOT NULL UNIQUE,
    commit_oid TEXT,
    parent_checkpoint_id TEXT REFERENCES agentic_super_app_code_checkpoints(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    created_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_checkpoints_run_created
    ON agentic_super_app_code_checkpoints(run_id, created_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_reviews (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES agentic_super_app_code_tasks(id) ON DELETE CASCADE,
    checkpoint_id TEXT NOT NULL REFERENCES agentic_super_app_code_checkpoints(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,
    feedback TEXT,
    created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_questions (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES agentic_super_app_code_tasks(id) ON DELETE CASCADE,
    dispatch_id TEXT NOT NULL REFERENCES agentic_super_app_code_dispatches(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    answer TEXT,
    answered INTEGER NOT NULL DEFAULT 0,
    created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_messages (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES agentic_super_app_code_tasks(id) ON DELETE SET NULL,
    dispatch_id TEXT REFERENCES agentic_super_app_code_dispatches(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    question_id TEXT REFERENCES agentic_super_app_code_questions(id) ON DELETE SET NULL,
    payload TEXT NOT NULL,
    created_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_messages_run_created
    ON agentic_super_app_code_messages(run_id, created_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_events (
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    task_id TEXT,
    dispatch_id TEXT,
    lease_generation INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 1,
    emitted_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY(run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_code_events_run_sequence
    ON agentic_super_app_code_events(run_id, sequence);
