# Foundation Architecture

## Scope

Phase 0–1 established the shell. Phase 2 adds shared durable infrastructure and diagnostics, but deliberately does not add Chat, Code, or Agent product workflows.

## Runtime shape

The single trusted local renderer is React and TypeScript. It renders state obtained through explicit Tauri commands. The Rust host is the authority for all state that may later affect files, processes, network access, credentials, or approval decisions. A selected workspace mode is presentation state, not permission.

The host exposes namespaced, typed commands for shell state and diagnostics. A global event channel carries job state and streaming text updates; it is an observation mechanism, not an authority boundary.

## Phase 2 shared services

Six boundary crates own the cross-cutting foundation:

- `agentic-super-app-persistence`: SQLite migrations, settings, provider metadata, jobs, checkpoints, audit entries, and in-app notifications.
- `agentic-super-app-secret-store`: operating-system keychain access only; the database stores a secret reference, never the credential.
- `agentic-super-app-model-gateway`: provider adapter boundary. The OpenAI Responses diagnostic stream always sets `store: false` and requires a user-entered model.
- `agentic-super-app-job-runtime`: durable job creation, cancellation tokens, state transitions, checkpoints, and event fan-out.
- `agentic-super-app-tool-runtime`: approval fingerprinting and redacted audit persistence. It has no executable tool adapters in Phase 2.
- `agentic-super-app-notification-service`: persistent in-app notifications and host-mediated native notification requests.

At startup, the host enables SQLite foreign keys and WAL mode, runs migrations, and marks incomplete jobs as `Interrupted`. Diagnostics provides the explicit recovery exercise for that behavior.

## Future boundaries

Product-domain crates for Chat, Code, and Agent remain deferred until a parity feature has an owner and acceptance test. The shared infrastructure is intentionally independent of all three domains.

One renderer/webview keeps desktop authorization simple. Future browser preview is an auxiliary, capability-free surface rather than a peer authority.

## Design system

The Phase 0 shell uses a restrained graphite dark palette, blue keyboard focus, green local-host status, flat panels, and compact navigation. It targets 4.5:1 contrast, visible focus states, usable mobile widths, and reduced-motion preferences. The intended typography is IBM Plex Sans with JetBrains Mono for future code data. Reference images supplied later may revise visual tokens without changing this security model.
