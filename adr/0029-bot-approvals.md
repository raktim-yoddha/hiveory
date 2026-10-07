# ADR 0029 — Bot approvals: asking before a bot acts in your apps

Builds on ADR 0017 (the MCP gateway), 0022 (Bots) and 0028 (routines and triggers). Decided by the
agent on the product owner's standing instruction ("you decide"), 2026-10-08.

## Problem

Every app and MCP tool a bot thread uses goes through Hiveory's own MCP server, and every CLI is
told to allow that server's tools without asking (`--allowedTools mcp__hiveory`). So a bot could
send an email or post to Slack as the user with no stop, and a trigger's "read-only" run could still
change things in apps: an event's payload could talk a bot into acting (prompt injection).

## Decision

- **One gate, in main.** `ApprovalService.guard` wraps the gateway family for bot threads only
  (Work agents and Chat keep their CLI's own permission model). It holds whatever the engine, its
  permission mode or the prompt says.
- **Risk from the tool's name** (`toolRisk`, `src/shared/domain/approval.ts`): the first verb-like word
  decides. Read words (get, list, search, fetch…) → **read**; send words (send, post, reply, forward,
  publish, comment, invite, share…) and code runners (bash, shell, workbench, execute…) → **send**;
  anything else → **change**. Composio's multi-execute is as risky as the riskiest action inside it.
  Unknown names are never treated as reads.
- **Levels per bot** (`Bot.approvals`, the Overview tab's "Asks before"): **Sending as you** (default,
  `sends`), **Any change** (`changes`), **Never** (`never`). Reads are never asked.
- **Read-only runs** (`ChatSession.readOnly`, set on trigger runs): changes and sends are refused
  outright, never asked, and the thread can't be switched to full access.
- **Asking:** the call waits (in memory) while the request shows in the bot's thread above the composer,
  in the work board's **Needs you** card and as the bot's waiting dot; a desktop notification when
  Hiveory is in the background, a notice when it is in Work or Chat. Allow runs the call; Decline,
  15 minutes without an answer, stopping or deleting the thread, deleting the bot or quitting declines
  it, and the bot is told not to retry. Arguments show as plain text, cut at 1,500 characters.
- IPC `approvals.list | answer` (also for a paired desktop client); topic `approvals`.

## Not done

- Per-app or per-action allow lists ("always allow Slack in #general").
- The phone app does not answer requests yet (not in `MOBILE_CHANNELS`).
- Desktop and computer tools are not gated: reaching the user's screen is chosen on purpose in
  "Works on", and the bot's own Linux computer is its sandbox.
