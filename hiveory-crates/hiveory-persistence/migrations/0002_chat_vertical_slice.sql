CREATE TABLE IF NOT EXISTS agentic_super_app_command_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  command_kind TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  active_branch_id TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  next_aggregate_sequence INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_branches (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES agentic_super_app_chat_conversations(id) ON DELETE CASCADE,
  parent_branch_id TEXT REFERENCES agentic_super_app_chat_branches(id) ON DELETE SET NULL,
  forked_after_message_id TEXT,
  label TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES agentic_super_app_chat_conversations(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES agentic_super_app_chat_branches(id) ON DELETE CASCADE,
  copied_from_message_id TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  branch_position INTEGER NOT NULL,
  turn_id TEXT,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_message_parts (
  message_id TEXT NOT NULL REFERENCES agentic_super_app_chat_messages(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (message_id, ordinal)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_turns (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES agentic_super_app_chat_conversations(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES agentic_super_app_chat_branches(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES agentic_super_app_chat_messages(id) ON DELETE CASCADE,
  assistant_message_id TEXT NOT NULL REFERENCES agentic_super_app_chat_messages(id) ON DELETE CASCADE,
  provider_account_id TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  state TEXT NOT NULL,
  job_id TEXT REFERENCES agentic_super_app_jobs(id) ON DELETE SET NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_events (
  global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES agentic_super_app_chat_conversations(id) ON DELETE CASCADE,
  aggregate_sequence INTEGER NOT NULL,
  branch_id TEXT,
  turn_id TEXT,
  message_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  provider_sequence_start INTEGER,
  provider_sequence_end INTEGER,
  emitted_at_unix_ms INTEGER NOT NULL,
  UNIQUE (conversation_id, aggregate_sequence)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL UNIQUE,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_message_attachments (
  message_id TEXT NOT NULL REFERENCES agentic_super_app_chat_messages(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES agentic_super_app_chat_attachments(id) ON DELETE RESTRICT,
  PRIMARY KEY (message_id, attachment_id)
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_drafts (
  conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES agentic_super_app_chat_conversations(id) ON DELETE CASCADE,
  draft TEXT NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agentic_super_app_chat_model_budgets (
  provider_account_id TEXT NOT NULL,
  model TEXT NOT NULL,
  context_budget_tokens INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY (provider_account_id, model)
);

CREATE INDEX IF NOT EXISTS agentic_super_app_chat_conversations_updated_idx
  ON agentic_super_app_chat_conversations (archived, pinned, updated_at_unix_ms DESC);
CREATE INDEX IF NOT EXISTS agentic_super_app_chat_messages_branch_idx
  ON agentic_super_app_chat_messages (conversation_id, branch_id, branch_position);
CREATE INDEX IF NOT EXISTS agentic_super_app_chat_events_conversation_idx
  ON agentic_super_app_chat_events (conversation_id, global_sequence);
CREATE INDEX IF NOT EXISTS agentic_super_app_chat_events_turn_idx
  ON agentic_super_app_chat_events (turn_id, provider_sequence_start);
