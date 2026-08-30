# Hiveory

A local-first Tauri 2 desktop application with three deliberately separate contexts: named agents, an agentic coding workbench, and standalone AI chat.

The Phase 10 release delivers a terminal-first multipane Code workspace: a fluid pane canvas with recursive binary splitting, resizable splitters, drag-and-drop pane arrangement, deterministic Tidy layouts, inline renaming, and concurrent interactive sessions for Shell, Codex CLI, Claude Code, Antigravity, and OpenCode alongside sandboxed local previews and workspace chat threads. Runtime privileges, PTY lifecycle, and layout topology remain strictly host-authoritative in Rust.

## Run it

```bash
pnpm install
pnpm app:dev
```

The browser-only renderer is still available with `pnpm --dir hiveory-renderer dev`. Build a native package with `pnpm app:build`; inspect the local toolchain with `pnpm app:doctor`.

Before opening a provider workflow, configure a model and store its key from Diagnostics. Keys are handed to the operating-system credential manager and are never returned to the renderer.

## Release checks

```bash
pnpm verify
pnpm release:check
```

`pnpm release:check` includes the identity and reference guards. A signed update channel is opt-in: set `HIVEORY_UPDATER_ENDPOINT` and `HIVEORY_UPDATER_PUBKEY` for runtime checks, and provide the Tauri signing credentials when producing updater artifacts. Local builds remain usable without a configured release server.

See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/architecture/hiveory-foundation.md](docs/architecture/hiveory-foundation.md), [docs/architecture/terminal-pane-workspace.md](docs/architecture/terminal-pane-workspace.md), and [docs/phases/phase-10-terminal-pane-workspace.md](docs/phases/phase-10-terminal-pane-workspace.md).
