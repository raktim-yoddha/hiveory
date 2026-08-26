# ADR 0003: Event sourcing scope

**Decision:** Use append-only domain events only where replay, auditability, or idempotency need them; ordinary preferences use direct state.

**Consequences:** Each evented aggregate needs an owner, projection, replay test, and retention policy.
