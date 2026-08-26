# ADR 0004: Local persistence

**Decision:** Adopt SQLite with UUIDv7 string IDs, UTC timestamps, forward-only migrations, and recovery documentation.

**Consequences:** Secrets and unredacted diagnostics are excluded from the database.
