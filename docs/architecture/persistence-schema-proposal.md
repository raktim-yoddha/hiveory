# Persistence Schema Proposal

SQLite is the local durable store after its dedicated persistence crate is introduced. Migrations are forward-only and transactional; destructive changes require export/recovery guidance.

| Table family | Owner | Purpose |
| --- | --- | --- |
| `agentic_super_app_meta` | persistence | schema version, installation identity, migration journal |
| `agentic_super_app_shell_preferences` | common domain | window state and selected workspace mode |
| `agentic_super_app_command_receipts` | shared runtime | idempotency keys, result digest, expiry |
| `agentic_super_app_event_log` | selected domains | append-only domain facts where replay is justified |
| `agentic_super_app_approval_audit` | security | redacted approval decision records |

Secrets, raw provider tokens, and unredacted command output never belong in SQLite. They are deferred to an OS-backed secret store and redacted audit design.
