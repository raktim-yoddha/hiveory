# Code coordination threat model

This document narrows the general [threat model](../security/threat-model.md) to Code runs.

## Assets

- workspace files and uncommitted changes;
- repository credentials available to the local user;
- terminal input/output and worker process identity;
- run, task, dispatch, worktree, checkpoint, mailbox, completion, path-claim, and gate history.

## Controls

- Workspace roots are host-resolved and canonicalized before Git, file, or process work.
- Write-capable orchestration requires explicit workspace trust and the relevant capability.
- Workers use application-managed worktrees by default. A PID alone is never treated as a complete resource identity.
- A dispatch lease generation fences previous attempts. Bridge events carry an ephemeral HMAC secret, monotonic sequence, and nonce.
- Duplicate worker events are rejected or replayed idempotently without creating a second effect.
- Mailbox request IDs make sends idempotent; recipient sequences preserve FIFO delivery; acknowledgement requires the exact run, delivery, and recipient.
- Gate resolution requires an open gate and the configured actor.
- Worker output, mailbox payloads, terminal history, provider results, and persisted events are bounded and redacted where necessary.
- Dependency fan-in is non-interactive and blocks on conflicts. Cleanup remains within the application-managed root and requires exact intent.

## Residual risks

A coding CLI executes third-party and repository-controlled code with the permissions granted to its workspace and local user. Managed worktrees limit repository overlap but are not an operating-system sandbox. Repository hooks, build tools, package managers, and provider CLIs retain their own risk. Users must review requested capabilities, checkpoints, and externally visible actions.

External task-provider items are read into Hiveory for context. Board movement is local-only; provider workflow mutation requires a separately implemented and approved provider tool.
