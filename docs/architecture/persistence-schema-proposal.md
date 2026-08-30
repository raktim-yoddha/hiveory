# Persistence Schema Proposal

SQLite is the local durable store after its dedicated persistence crate is introduced. Migrations are forward-only and transactional; destructive changes require export/recovery guidance.

| Table family | Owner | Purpose |
| --- | --- | --- |
| `hiveory_meta` | persistence | schema version, installation identity, migration journal |
| `hiveory_shell_preferences` | common domain | window state and selected workspace mode |
| `hiveory_command_receipts` | shared runtime | idempotency keys, result digest, expiry |
| `hiveory_event_log` | selected domains | append-only domain facts where replay is justified |
| `hiveory_approval_audit` | security | redacted approval decision records |

Secrets, raw provider tokens, and unredacted command output never belong in SQLite. They are deferred to an OS-backed secret store and redacted audit design.
