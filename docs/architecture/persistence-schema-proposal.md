# Persistence architecture

Despite the legacy filename, this document describes the deployed SQLite architecture. Migrations live in `src/crates/core/hiveory-persistence/migrations/` and are forward-only, ordered, and transactional.

## Database ownership

The Rust host is the only database client. It enables foreign keys and WAL mode, applies migrations before domain services start, and exposes typed projections to the renderer. Request IDs, unique constraints, sequence numbers, and optimistic revisions prevent duplicate or stale effects.

## Durable table families

| Family | Representative data |
| --- | --- |
| Shared | settings, provider accounts, jobs, checkpoints, audit entries, notifications, command receipts, release metadata |
| Chat | folders, conversations, branches, messages, typed parts, turns, events, attachments, drafts, model budgets |
| Code workspace | projects, workspaces, pane layouts, documents, terminals, encrypted terminal history, previews, hosted-source cache, task sources |
| Code orchestration | runs, tasks, dependencies, dispatches, worktrees, checkpoints, reviews, questions, activity, participants, mailbox deliveries, worker resources, completion reports, decision gates, path claims |
| Agent | agents, versions, folder grants, tools, skills, conflicts, conversations, runs, messages, tool calls, approvals, events, continuations, memory, retrievals, artifacts |
| Integrations | plugin manifests, connections, agent grants, invocations, automations, and automation executions |

Migration `0016_hiveory_namespace.sql` moves legacy table names to the current `hiveory_*` namespace without discarding data. Later migrations add workspace parents, Chat folders, terminal-host recovery/history, and task sources.

## Data that does not belong in SQLite

- Provider tokens, API keys, passwords, and OAuth refresh tokens are stored through `hiveory-secret-store` in the operating-system credential manager.
- Live terminal bytes are owned by the terminal host's bounded ring buffer. Optional persisted terminal history uses the dedicated encrypted history policy.
- Arbitrary provider responses and unredacted command output are not retained as diagnostics.
- Imported attachments and generated artifacts live under application-managed roots; SQLite stores their metadata and content references.

## Migration and recovery policy

Migrations never rewrite an already shipped migration file. A schema change adds the next numbered migration and a regression test. Startup applies pending migrations before opening normal application services. Backup uses a consistent SQLite snapshot, and restore retains pre-restore files until the staged replacement succeeds.
