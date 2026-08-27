# Foundation Architecture

## Scope

Phase 0–1 established the shell, Phase 2 added shared durable infrastructure, and Phase 3 adds the first complete product vertical slice: standalone Chat. Code and Agent remain separate future domains.

## Runtime shape

The single trusted local renderer is React and TypeScript. It renders state obtained through explicit Tauri commands. The Rust host is the authority for all state that may later affect files, processes, network access, credentials, or approval decisions. A selected workspace mode is presentation state, not permission.

The host exposes namespaced, typed commands for shell state, diagnostics, and Chat. Global and Chat-specific Tauri channels carry observations; SQLite remains authoritative for durable state and the renderer resumes from persisted sequence cursors.

## Phase 2 shared services

Six boundary crates own the cross-cutting foundation:

- `agentic-super-app-persistence`: SQLite migrations, settings, provider metadata, jobs, checkpoints, audit entries, and in-app notifications.
- `agentic-super-app-secret-store`: operating-system keychain access only; the database stores a secret reference, never the credential.
- `agentic-super-app-model-gateway`: provider adapter boundary. The OpenAI Responses diagnostic stream always sets `store: false` and requires a user-entered model.
- `agentic-super-app-job-runtime`: durable job creation, cancellation tokens, state transitions, checkpoints, and event fan-out.
- `agentic-super-app-tool-runtime`: approval fingerprinting and redacted audit persistence. It has no executable tool adapters in Phase 2.
- `agentic-super-app-notification-service`: persistent in-app notifications and host-mediated native notification requests.

## Phase 3 Chat services

The Chat slice adds two original boundary crates and a host-owned orchestration path:

- `agentic-super-app-chat-domain`: validates turns, estimates context, and owns Chat-specific policy values such as reasoning effort.
- `agentic-super-app-artifact-store`: copies explicitly selected PDF, image, text, and Markdown attachments into an application-controlled content-addressed directory, then produces sanitized ZIP exports.
- `agentic-super-app-persistence::chat`: stores conversations, branches, typed message parts, turns, attachments, drafts, and transactional ordered events. Provider sequence numbers and command request IDs are unique guards against duplicate effects.
- `agentic-super-app-model-gateway`: streams Responses API text/reasoning events with `store: false` and `tools: []`; the host constructs provider input only from active-branch messages and explicitly attached artifacts.

At startup, the host enables SQLite foreign keys and WAL mode, runs migrations, and marks incomplete jobs as `Interrupted`. Diagnostics provides the explicit recovery exercise for that behavior.

## Future boundaries

Code and Agent product-domain crates remain deferred until their parity features have owners and acceptance tests. The Chat domain is intentionally isolated from workspace, Git, terminal, and shell capabilities.

One renderer/webview keeps desktop authorization simple. Future browser preview is an auxiliary, capability-free surface rather than a peer authority.

## Design system

The shell and Phase 3 Chat use a restrained graphite dark palette, blue keyboard focus, green local-host status, flat panels, and compact navigation. Chat adds a responsive conversation/sidebar split, persistent title and branch metadata, explicit attachment chips, safe typed-part rendering, live streaming status, and reduced-motion behavior. The UI uses IBM Plex Sans with JetBrains Mono for token/diagnostic data. Visual tokens can evolve without changing the security model.
