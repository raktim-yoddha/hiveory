# ADR 0002: Trusted renderer and preview isolation

**Decision:** Use one trusted local renderer. Future browser previews are auxiliary, capability-free surfaces.

**Consequences:** Workspace mode never grants authority; Rust checks explicit capability grants.
