ALTER TABLE hiveory_code_agent_pane_statuses
    ADD COLUMN last_adapter_hook_sequence INTEGER NOT NULL DEFAULT 0;
