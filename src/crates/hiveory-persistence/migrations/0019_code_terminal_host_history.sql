-- Durable terminal sessions are owned by the background terminal host.  The
-- extra columns let a new host recreate a pane without changing its resource
-- id, while the history table keeps a complete encrypted audit of terminal
-- input and output.
ALTER TABLE hiveory_code_terminals ADD COLUMN root_path TEXT;
ALTER TABLE hiveory_code_terminals ADD COLUMN cols INTEGER NOT NULL DEFAULT 80;
ALTER TABLE hiveory_code_terminals ADD COLUMN rows INTEGER NOT NULL DEFAULT 24;
ALTER TABLE hiveory_code_terminals ADD COLUMN history_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hiveory_code_terminals ADD COLUMN host_instance_id TEXT;

CREATE TABLE IF NOT EXISTS hiveory_code_terminal_history (
    id TEXT PRIMARY KEY NOT NULL,
    terminal_id TEXT NOT NULL REFERENCES hiveory_code_terminals(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('input', 'output', 'event')),
    sequence INTEGER NOT NULL,
    payload BLOB NOT NULL,
    created_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS hiveory_code_terminal_history_terminal_idx
    ON hiveory_code_terminal_history(terminal_id, created_at_unix_ms, id);

CREATE INDEX IF NOT EXISTS hiveory_code_terminal_history_output_idx
    ON hiveory_code_terminal_history(terminal_id, direction, sequence);
