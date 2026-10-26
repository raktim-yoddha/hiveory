# ADR 0055 — Chat knows its models, limits, worktree and schedules

Builds on ADR 0012, 0031 and 0046. Decided by the product owner, 2026-10-26.

## Context

The chat composer (Chat mode, Work agents in chat view and bot threads share it) named Claude's
models only by alias ("Opus", "Sonnet"), missed newer families such as Fable, and ticked the chosen
model in a list that already highlights it. A chat could work in a Workspace's folder but not in one
of its Worktrees, and its folder vanished from the box once the chat started. The schedules calendar
existed only in Bots; Chat and Work listed schedules without it. The saved-prompts button crowded
the box. To see how much of a plan's 5-hour or weekly limit was left, the user had to open the CLI
itself.

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
- **Usage limits in every message box.** A gauge button (beside the permissions) opens the plan's
  limits: each window (5-hour, weekly for all models, weekly per model) with the share used, a bar,
  and when it resets ("Resets in 2 h 13 min · Tue 4:00 PM"), the plan, and Check again. They come
  from the CLI itself, never from its sign-in files: Claude Code's `get_usage` control request
  (`skip_behaviors`), Codex's app-server `account/rateLimits/read`. A provider declares `limits`;
  `ChatCatalog.limits` tells the box to show the button, so CLIs that cannot say show nothing. New
  channel `chat.limits` ({ cliId, refresh }) → `UsageLimits`, cached for a minute, also remote (a
  paired desktop sees its server's limits); not a phone channel yet. A sign-in without plan limits
  (an API key, a cloud provider, Codex not signed in with ChatGPT) gets a note instead of bars.
- **No saved-prompts button** in the desktop message box (amends ADR 0031). The phone keeps its saved
  prompts; the stored prompts and their channels stay.

## Consequences

Saved prompts can no longer be used from the desktop. Checking limits starts the CLI for a few
seconds; the phone does not show limits yet. Listing Claude's models starts Claude Code for a few seconds (cached for ten minutes, like every
catalog), which runs the user's own session-start hooks. Model ids stay what the CLI accepts
(`opus`, `claude-fable-5-1[1m]`), so saved chats and Workspace defaults keep working.
