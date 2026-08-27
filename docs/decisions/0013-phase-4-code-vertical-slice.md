# ADR 0013: Phase 4 Code Vertical Slice

## Context

Code mode needs to make a real local repository editable and testable while keeping repository content and process execution outside the renderer's authority. Opening a folder must not silently become permission to run setup scripts, write files, or share credentials with a preview.

## Decision

Introduce dedicated Code, workspace, runtime, and Git boundaries. The host canonicalizes a selected workspace root and opens it as a `cap-std` directory capability. Every renderer path is normalized as a relative path, parent traversal and symlink components are rejected, and editor saves use an expected SHA-256 fingerprint plus atomic sibling-file replacement.

Persist workspace summaries, trust state, layouts, document fingerprints, terminal summaries, and preview metadata in migration `0004_code_vertical_slice.sql`. Do not persist raw terminal bytes. Untrusted workspaces permit read/list only; explicit trust grants writes, process execution, read-only Git status/diff, and preview access.

Use `portable-pty` for native PTY/ConPTY sessions. Shell launches use structured command arguments and the host's configured shell. The first coding-agent adapter is a structured Codex CLI launch with workspace-write sandboxing and on-request approvals. Output travels as bounded base64 chunks over a per-terminal Tauri channel. Graceful stop sends an interrupt; confirmed force-stop uses the PTY process group on Unix or `taskkill /T /F` on Windows.

Use `git2` for read-only status and working-tree diffs. Open local previews in a separate capability-free Tauri webview, reject embedded URL credentials, permit localhost HTTP and explicitly entered HTTPS, allow only the initial origin during navigation, and deny child windows. The main renderer never embeds an untrusted preview in its privileged document.

## Consequences

Phase 4 can open a real repository, inspect files, edit and save after trust, run a shell or installed Codex CLI, review Git changes, and launch a local preview without granting the renderer filesystem or shell permissions. Layouts are deterministic and invalid persisted layouts fall back safely. Remote workspaces, Git mutations/worktrees, setup-command approvals, richer adapter protocols, and full browser devtools remain later phases.

## Verification

Rust tests cover path normalization, trust capabilities, atomic editor saves, Git status/diff, PTY start/stop, and adapter metadata. Renderer tests cover browser-preview trust enforcement and pane contracts. The renderer lint, typecheck, production build, generated TypeScript bindings, and the Phase 4 reference/prohibited-name audits are required before the phase gate.
