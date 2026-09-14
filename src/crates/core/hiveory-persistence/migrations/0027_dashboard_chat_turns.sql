CREATE INDEX IF NOT EXISTS idx_chat_turns_state_updated
  ON hiveory_chat_turns (state, updated_at_unix_ms DESC);
