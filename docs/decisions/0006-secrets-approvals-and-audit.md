# ADR 0006: Secrets, approvals, and audit

**Decision:** Store secrets in an OS-backed store, authorize tools in Rust, and keep a redacted approval audit trail.

**Consequences:** Raw tokens and sensitive command output cannot be persisted or rendered by default.
