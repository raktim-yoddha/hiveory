ALTER TABLE agentic_super_app_agent_runs
  ADD COLUMN routine_execution_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_routine_execution
  ON agentic_super_app_agent_runs(routine_execution_id);

CREATE TABLE IF NOT EXISTS agentic_super_app_routines (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE RESTRICT,
  prompt_template TEXT NOT NULL,
  schedule_expression TEXT NOT NULL,
  timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  catch_up TEXT NOT NULL DEFAULT 'skip',
  concurrency TEXT NOT NULL DEFAULT 'skip',
  delivery TEXT NOT NULL DEFAULT 'in_app',
  folder_grant_ids_json TEXT NOT NULL DEFAULT '[]',
  plugin_tool_names_json TEXT NOT NULL DEFAULT '[]',
  max_duration_seconds INTEGER NOT NULL DEFAULT 1800,
  max_tool_calls INTEGER NOT NULL DEFAULT 32,
  approval_timeout_seconds INTEGER NOT NULL DEFAULT 86400,
  next_run_unix_ms INTEGER,
  last_run_unix_ms INTEGER,
  last_execution_state TEXT,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routines_enabled_next
  ON agentic_super_app_routines(enabled, archived, next_run_unix_ms);

CREATE TABLE IF NOT EXISTS agentic_super_app_routine_executions (
  id TEXT PRIMARY KEY NOT NULL,
  routine_id TEXT NOT NULL REFERENCES agentic_super_app_routines(id) ON DELETE CASCADE,
  run_id TEXT,
  occurrence_key TEXT NOT NULL,
  scheduled_for_unix_ms INTEGER NOT NULL,
  state TEXT NOT NULL,
  folder_grant_ids_json TEXT NOT NULL DEFAULT '[]',
  plugin_tool_names_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  report TEXT,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  started_at_unix_ms INTEGER,
  completed_at_unix_ms INTEGER,
  UNIQUE(routine_id, occurrence_key)
);

CREATE INDEX IF NOT EXISTS idx_routine_executions_routine_created
  ON agentic_super_app_routine_executions(routine_id, created_at_unix_ms DESC);

CREATE INDEX IF NOT EXISTS idx_routine_executions_active
  ON agentic_super_app_routine_executions(state, updated_at_unix_ms);

CREATE TABLE IF NOT EXISTS agentic_super_app_plugin_manifests (
  id TEXT PRIMARY KEY NOT NULL,
  publisher TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  adapter TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  installed INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_plugin_connections (
  id TEXT PRIMARY KEY NOT NULL,
  plugin_id TEXT NOT NULL REFERENCES agentic_super_app_plugin_manifests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  origin TEXT NOT NULL,
  kind TEXT NOT NULL,
  api_key_header TEXT,
  secret_ref TEXT,
  validated_at_unix_ms INTEGER,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  UNIQUE(plugin_id, name)
);

CREATE INDEX IF NOT EXISTS idx_plugin_connections_plugin
  ON agentic_super_app_plugin_connections(plugin_id);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_plugin_grants (
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL REFERENCES agentic_super_app_plugin_manifests(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES agentic_super_app_plugin_connections(id) ON DELETE CASCADE,
  tool_names_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(agent_id, plugin_id, connection_id)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_plugin_invocations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  plugin_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  state TEXT NOT NULL,
  target TEXT NOT NULL,
  request_preview TEXT NOT NULL,
  response_preview TEXT,
  error TEXT,
  created_at_unix_ms INTEGER NOT NULL,
  completed_at_unix_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_plugin_invocations_run_created
  ON agentic_super_app_plugin_invocations(run_id, created_at_unix_ms DESC);
