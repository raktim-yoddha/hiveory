# ADR 0006 — CLI Status Detection: Native Hooks First, PTY Heuristics as Fallback

## Decision

Runtime status (`idle | working | waiting-for-you`) comes from two sources,
both translated by provider adapters into neutral `StatusEvent`s and reduced
by one state machine (`status-machine.ts`):

1. **Native hooks** (authoritative when available)
   - A loopback HTTP server (`127.0.0.1`, random port, random per-run token)
     receives callbacks. Responses are always empty so hook stdout never feeds
     text back into an agent.
   - Claude Code: per-launch settings file passed with `--settings` registers
     `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`,
     `Notification`, `Stop`. The user's own settings are never modified.
   - Codex: `-c notify=[...]` reports `agent-turn-complete`.
   - The hook command is `curl` with all arguments quoted, which works in
     bash, cmd and PowerShell.
2. **PTY heuristics** (`heuristics.ts`) for everything hooks do not cover:
   Enter = working, output patterns = waiting, output silence = idle.
   Claude's folder-trust prompt and user interrupts fire no hook, so a small
   heuristic set also runs alongside Claude's hooks.

If the hook server cannot start, adapters fall back to full heuristics.

## Notes

- Windows ConPTY encodes spaces as cursor-forward escapes; `stripAnsi`
  restores them before pattern matching.
- Errors and exits never create a fourth status; they are `idle` with
  `running: false` and an `error` diagnostic.

## Consequences

Heuristic patterns are provider-version-sensitive and live only in adapters.
