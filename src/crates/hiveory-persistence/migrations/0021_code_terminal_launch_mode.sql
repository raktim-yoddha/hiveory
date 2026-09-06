-- Keep an explicit coding-agent permission posture with each terminal.
ALTER TABLE hiveory_code_terminals
    ADD COLUMN agent_launch_mode TEXT NOT NULL DEFAULT 'standard';
