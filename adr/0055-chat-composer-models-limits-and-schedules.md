# ADR 0055 — Chat knows its models, limits, worktree and schedules

Builds on ADR 0012, 0031 and 0046. Decided by the product owner, 2026-10-26.

## Context

The chat composer (Chat mode, Work agents in chat view and bot threads share it) named Claude's
models only by alias ("Opus", "Sonnet"), missed newer families such as Fable, and ticked the chosen
model in a list that already highlights it. A chat could work in a Workspace's folder but not in one
of its Worktrees, and its folder vanished from the box once the chat started. The schedules calendar
existed only in Bots; Chat and Work listed schedules without it. The saved-prompts button crowded
the box.

## Decision

- **Models by version.** Claude's model list comes from Claude Code itself: Hiveory starts a
  headless session (`-p --input-format stream-json --output-format stream-json
  --no-session-persistence`) and sends the `initialize` control request; the reply lists every model
  the CLI offers with the model it runs now. The picker shows "Opus 5.5", "Fable 5.1",
  "Default (Opus 5.5)"; prices are left out. No message is sent to a model. When the CLI cannot
  answer, the aliases are listed as before. `probeCli` (chat/cli-probe.ts) is the one helper that
  asks a CLI over its JSON-lines stdio protocol.
- The model list has no tick; the chosen model is the highlighted row.
- **Where a chat works.** Chat's picker lists the home folder, then each Workspace with its Worktrees
  (Primary and isolated ones, with their branch). `ChatSession.workspaceId` (and `ChatSummary`) holds
  the Worktree; `chat.update` takes `workspaceId` ('' = the Workspace's own folder) and main accepts
  only a Worktree of that Workspace or of one mirroring its repository. It is fixed once the chat has
  started; then the box shows it as a plain pill ("demo-app · fix-login").
- **A Schedules calendar in every mode.** `RoutinesPage` takes a scope: Bots (as before), Chat (its
  scheduled chats; the sidebar's new Schedules row) and Work (a Workspace's schedules, in its side
  panel's Schedules tab, opening on Day). New schedule and a click on an empty hour start a schedule
  for that scope. `WorkRoutinesTab` is gone.
- **No saved-prompts button** in the desktop message box (amends ADR 0031). The phone keeps its saved
  prompts; the stored prompts and their channels stay.

## Consequences

Saved prompts can no longer be used from the desktop. Listing Claude's models starts Claude Code for a few seconds (cached for ten minutes, like every
catalog), which runs the user's own session-start hooks. Model ids stay what the CLI accepts
(`opus`, `claude-fable-5-1[1m]`), so saved chats and Workspace defaults keep working.
