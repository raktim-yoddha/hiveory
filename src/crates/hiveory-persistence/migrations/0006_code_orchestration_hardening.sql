ALTER TABLE agentic_super_app_code_runs
    ADD COLUMN coordinator_id TEXT NOT NULL DEFAULT 'local-coordinator';

ALTER TABLE agentic_super_app_code_runs
    ADD COLUMN adapter_id TEXT NOT NULL DEFAULT 'codex-cli';

ALTER TABLE agentic_super_app_code_runs
    ADD COLUMN next_event_sequence INTEGER NOT NULL DEFAULT 1;

UPDATE agentic_super_app_code_runs
SET next_event_sequence = COALESCE(
    (SELECT MAX(sequence) + 1
     FROM agentic_super_app_code_events
     WHERE agentic_super_app_code_events.run_id = agentic_super_app_code_runs.id),
    1
);

ALTER TABLE agentic_super_app_code_dispatches
    ADD COLUMN adapter_id TEXT NOT NULL DEFAULT 'codex-cli';

ALTER TABLE agentic_super_app_code_dispatches
    ADD COLUMN terminal_id TEXT;

ALTER TABLE agentic_super_app_code_dispatches
    ADD COLUMN cancel_requested_at_unix_ms INTEGER;

ALTER TABLE agentic_super_app_code_events
    ADD COLUMN origin TEXT NOT NULL DEFAULT 'host';

ALTER TABLE agentic_super_app_code_events
    ADD COLUMN worker_sequence INTEGER;

ALTER TABLE agentic_super_app_code_events
    ADD COLUMN nonce TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_events_nonce
    ON agentic_super_app_code_events(nonce)
    WHERE nonce IS NOT NULL;
