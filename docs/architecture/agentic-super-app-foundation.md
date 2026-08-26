# Foundation Architecture

## Scope

Phase 0–1 establishes a blank desktop shell and the contracts that later product domains must obey. It does not implement provider access, tool execution, terminals, repositories, persistence, or secret storage.

## Runtime shape

The single trusted local renderer is React and TypeScript. It renders state obtained through explicit Tauri commands. The Rust host is the authority for all state that may later affect files, processes, network access, credentials, or approval decisions. A selected workspace mode is presentation state, not permission.

The initial shell exposes `agentic_super_app_query_bootstrap`, `agentic_super_app_command_set_active_mode`, and `agentic_super_app_query_build_information`. All are namespaced, typed, and versioned by `agentic-super-app-protocol`.

## Future boundaries

The planned Rust crates are `agentic-super-app-agent-domain`, `agentic-super-app-code-domain`, `agentic-super-app-chat-domain`, `agentic-super-app-model-gateway`, `agentic-super-app-tool-runtime`, and `agentic-super-app-persistence`. They are intentionally not scaffolded until a parity feature has an owner and acceptance test.

One renderer/webview keeps desktop authorization simple. Future browser preview is an auxiliary, capability-free surface rather than a peer authority.

## Design system

The Phase 0 shell uses a restrained graphite dark palette, blue keyboard focus, green local-host status, flat panels, and compact navigation. It targets 4.5:1 contrast, visible focus states, usable mobile widths, and reduced-motion preferences. The intended typography is IBM Plex Sans with JetBrains Mono for future code data. Reference images supplied later may revise visual tokens without changing this security model.
