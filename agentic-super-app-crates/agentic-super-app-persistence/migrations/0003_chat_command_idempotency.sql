ALTER TABLE agentic_super_app_chat_conversations ADD COLUMN command_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS agentic_super_app_chat_conversations_command_request_idx
  ON agentic_super_app_chat_conversations (command_request_id)
  WHERE command_request_id IS NOT NULL;

ALTER TABLE agentic_super_app_chat_branches ADD COLUMN command_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS agentic_super_app_chat_branches_command_request_idx
  ON agentic_super_app_chat_branches (command_request_id)
  WHERE command_request_id IS NOT NULL;

ALTER TABLE agentic_super_app_chat_turns ADD COLUMN command_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS agentic_super_app_chat_turns_command_request_idx
  ON agentic_super_app_chat_turns (command_request_id)
  WHERE command_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agentic_super_app_chat_events_provider_sequence_idx
  ON agentic_super_app_chat_events (turn_id, provider_sequence_start)
  WHERE provider_sequence_start IS NOT NULL;
