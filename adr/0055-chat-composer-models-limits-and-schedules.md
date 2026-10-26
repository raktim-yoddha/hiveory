# ADR 0055 — Chat knows its models, limits, worktree and schedules

Builds on ADR 0012, 0031 and 0046. Decided by the product owner, 2026-10-26.

## Context

The chat composer (Chat mode, Work agents in chat view and bot threads share it) named Claude's
models only by alias ("Opus", "Sonnet"), missed newer families such as Fable, and ticked the chosen
model in a list that already highlights it.

## Decision

- **Models by version.** Claude's model list comes from Claude Code itself: Hiveory starts a
  headless session (`-p --input-format stream-json --output-format stream-json
  --no-session-persistence`) and sends the `initialize` control request; the reply lists every model
  the CLI offers with the model it runs now. The picker shows "Opus 5.5", "Fable 5.1",
  "Default (Opus 5.5)"; prices are left out. No message is sent to a model. When the CLI cannot
  answer, the aliases are listed as before. `probeCli` (chat/cli-probe.ts) is the one helper that
  asks a CLI over its JSON-lines stdio protocol.
- The model list has no tick; the chosen model is the highlighted row.

## Consequences

Listing Claude's models starts Claude Code for a few seconds (cached for ten minutes, like every
catalog), which runs the user's own session-start hooks. Model ids stay what the CLI accepts
(`opus`, `claude-fable-5-1[1m]`), so saved chats and Workspace defaults keep working.
