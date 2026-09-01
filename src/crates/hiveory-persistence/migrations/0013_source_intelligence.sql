CREATE TABLE IF NOT EXISTS agentic_super_app_code_hosted_tracking_cache (
    workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES agentic_super_app_code_workspaces(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    refreshed_at_unix_ms INTEGER NOT NULL,
    stale INTEGER NOT NULL DEFAULT 0,
    updated_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_hosted_tracking_cache_updated
    ON agentic_super_app_code_hosted_tracking_cache(updated_at_unix_ms DESC);
