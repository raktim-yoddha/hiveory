-- Persist the per-conversation chat capability boundary with each turn.
-- NULL keeps historical turns readable and lets older clients continue to
-- submit requests without a profile payload.
ALTER TABLE hiveory_chat_turns ADD COLUMN profile_json TEXT;
