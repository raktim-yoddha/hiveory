CREATE TABLE IF NOT EXISTS agentic_super_app_code_participants (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    kind TEXT NOT NULL,
    display_name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    next_delivery_sequence INTEGER NOT NULL DEFAULT 1,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    UNIQUE(run_id, address)
);

CREATE INDEX IF NOT EXISTS idx_code_participants_run_active
    ON agentic_super_app_code_participants(run_id, active, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS agentic_super_app_code_mailbox_deliveries (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES agentic_super_app_code_runs(id) ON DELETE CASCADE,
    sender_address TEXT NOT NULL,
    recipient_address TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    thread_id TEXT,
    delivery_sequence INTEGER NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at_unix_ms INTEGER NOT NULL,
    acknowledged_at_unix_ms INTEGER,
    client_request_id TEXT,
    UNIQUE(run_id, recipient_address, delivery_sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_mailbox_client_request
    ON agentic_super_app_code_mailbox_deliveries(run_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_code_mailbox_recipient_pending
    ON agentic_super_app_code_mailbox_deliveries(run_id, recipient_address, acknowledged, delivery_sequence);

CREATE INDEX IF NOT EXISTS idx_code_mailbox_thread_sequence
    ON agentic_super_app_code_mailbox_deliveries(run_id, thread_id, delivery_sequence);
