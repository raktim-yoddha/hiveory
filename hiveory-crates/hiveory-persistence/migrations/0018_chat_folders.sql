CREATE TABLE IF NOT EXISTS hiveory_chat_folders (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);

ALTER TABLE hiveory_chat_conversations
    ADD COLUMN folder_id TEXT REFERENCES hiveory_chat_folders(id) ON DELETE SET NULL;

ALTER TABLE hiveory_chat_conversations
    ADD COLUMN folder_position INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS hiveory_chat_conversations_folder_idx
    ON hiveory_chat_conversations(folder_id, folder_position, updated_at_unix_ms DESC);

CREATE INDEX IF NOT EXISTS hiveory_chat_folders_position_idx
    ON hiveory_chat_folders(position, updated_at_unix_ms);
