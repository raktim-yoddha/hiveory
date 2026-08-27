CREATE TABLE IF NOT EXISTS agentic_super_app_release_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  product_version TEXT NOT NULL,
  protocol_major INTEGER NOT NULL,
  last_started_at_unix_ms INTEGER NOT NULL,
  last_clean_shutdown_at_unix_ms INTEGER,
  last_backup_at_unix_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread_created
  ON agentic_super_app_notifications(read_at_unix_ms, created_at_unix_ms DESC);

CREATE INDEX IF NOT EXISTS idx_audit_entries_created
  ON agentic_super_app_audit_entries(created_at_unix_ms DESC);
