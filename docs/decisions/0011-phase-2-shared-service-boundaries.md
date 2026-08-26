# ADR 0011: Phase 2 Shared Service Boundaries

## Context

The desktop shell needs durable settings, credential handling, provider diagnostics, cancellation, recovery, audit records, and notifications before product workflows can safely be implemented.

## Decision

Keep these concerns in six Rust boundary crates: persistence, secret store, model gateway, job runtime, tool runtime, and notification service. Compose them only in the Tauri host. SQLite retains non-secret metadata and durable job records; the operating-system keychain retains provider credentials. The first provider adapter is a diagnostic-only OpenAI Responses stream with an explicit user model and `store: false`.

## Consequences

Chat, Code, and Agent remain absent. The renderer cannot obtain credential values or issue a provider request without the host enforcing prerequisite state. Native notifications are requested by the renderer but delivered only by the host. Restart recovery is a shared runtime concern rather than a product-domain concern.

## Verification

`cargo check --workspace`, `cargo test --workspace`, renderer lint/typecheck/build/tests, and the reference/identity audits cover the boundary. The Diagnostics view provides a manual acceptance path for credential validation, stream cancellation, notifications, and recovery.
