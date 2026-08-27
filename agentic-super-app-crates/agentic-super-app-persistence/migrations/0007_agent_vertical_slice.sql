CREATE TABLE IF NOT EXISTS agentic_super_app_agents (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#22d3ee',
  provider_account_id TEXT NOT NULL,
  model TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_versions (
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  operating_brief TEXT NOT NULL,
  system_instructions TEXT NOT NULL,
  approval_policy TEXT NOT NULL,
  memory_policy TEXT NOT NULL,
  runtime_limits_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY (agent_id, version)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_folders (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  can_read INTEGER NOT NULL DEFAULT 1,
  can_write INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  UNIQUE(agent_id, root_path)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_tools (
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(agent_id, tool_name)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_skill_catalog (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT NOT NULL,
  origin TEXT NOT NULL,
  source_path TEXT NOT NULL,
  triggers_json TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  instructions TEXT NOT NULL,
  resources_json TEXT NOT NULL DEFAULT '[]',
  valid INTEGER NOT NULL DEFAULT 1,
  validation_message TEXT,
  discovered_at_unix_ms INTEGER NOT NULL,
  UNIQUE(id, version)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_skills (
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES agentic_super_app_skill_catalog(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_skill_conflicts (
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  selected_skill_id TEXT,
  PRIMARY KEY(agent_id, trigger)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_runs (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE CASCADE,
  agent_version INTEGER NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES agentic_super_app_agent_conversations(id) ON DELETE CASCADE,
  parent_run_id TEXT REFERENCES agentic_super_app_agent_runs(id) ON DELETE SET NULL,
  state TEXT NOT NULL,
  prompt TEXT NOT NULL,
  background INTEGER NOT NULL DEFAULT 0,
  step_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  pending_approval_id TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error TEXT,
  next_event_sequence INTEGER NOT NULL DEFAULT 1,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  completed_at_unix_ms INTEGER
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_messages (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES agentic_super_app_agent_runs(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES agentic_super_app_agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_id TEXT,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_tool_calls (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES agentic_super_app_agent_runs(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  risk TEXT NOT NULL,
  state TEXT NOT NULL,
  approval_id TEXT,
  result_preview TEXT,
  result_json TEXT,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  UNIQUE(run_id, call_id)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES agentic_super_app_agent_runs(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL REFERENCES agentic_super_app_agent_tool_calls(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  target TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  reversible INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending',
  comment TEXT,
  created_at_unix_ms INTEGER NOT NULL,
  resolved_at_unix_ms INTEGER
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_events (
  run_id TEXT NOT NULL REFERENCES agentic_super_app_agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  step INTEGER NOT NULL,
  tool_call_id TEXT,
  payload TEXT NOT NULL,
  emitted_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(run_id, sequence)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_continuations (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES agentic_super_app_agent_runs(id) ON DELETE CASCADE,
  input_items_json TEXT NOT NULL,
  pending_call_id TEXT,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_memory (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agentic_super_app_agents(id) ON DELETE CASCADE,
  class TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS agentic_super_app_agent_memory_fts USING fts5(
  memory_id UNINDEXED,
  agent_id UNINDEXED,
  class UNINDEXED,
  content
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_memory_retrievals (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES agentic_super_app_agent_runs(id) ON DELETE CASCADE,
  memory_id TEXT NOT NULL REFERENCES agentic_super_app_agent_memory(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  UNIQUE(run_id, memory_id)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_agent_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES agentic_super_app_agent_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_state_updated
  ON agentic_super_app_agent_runs(state, updated_at_unix_ms DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_updated
  ON agentic_super_app_agent_runs(agent_id, updated_at_unix_ms DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation_created
  ON agentic_super_app_agent_messages(conversation_id, created_at_unix_ms);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_updated
  ON agentic_super_app_agent_memory(agent_id, updated_at_unix_ms DESC);
