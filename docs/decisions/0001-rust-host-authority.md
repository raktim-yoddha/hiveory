# ADR 0001: Rust host authority

**Decision:** The Rust desktop host owns privileged state and operations; the renderer is a projection.

**Consequences:** Renderer convenience cannot become a security boundary. Every privileged feature needs a host contract and test.
