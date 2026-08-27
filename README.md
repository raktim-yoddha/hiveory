# Agentic Super App

A local-first Tauri 2 desktop application with three deliberately separate contexts: named agents, an agentic coding workbench, and standalone AI chat.

The Phase 8 release hardens the completed vertical slices with a persistent shell, keyboard command palette, notifications, accessibility preferences, crash/restart diagnostics, signed-update hooks, and portable local backups. Runtime privileges remain in Rust; the React renderer is a projection of host-owned state.

## Run it

```bash
pnpm install
pnpm app:dev
```

The browser-only renderer is still available with `pnpm --dir agentic-super-app-renderer dev`. Build a native package with `pnpm app:build`; inspect the local toolchain with `pnpm app:doctor`.

Before opening a provider workflow, configure a model and store its key from Diagnostics. Keys are handed to the operating-system credential manager and are never returned to the renderer.

## Release checks

```bash
pnpm verify
pnpm release:check
```

`pnpm release:check` includes the identity and reference guards. A signed update channel is opt-in: set `AGENTIC_SUPER_APP_UPDATER_ENDPOINT` and `AGENTIC_SUPER_APP_UPDATER_PUBKEY` for runtime checks, and provide the Tauri signing credentials when producing updater artifacts. Local builds remain usable without a configured release server.

See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/architecture/agentic-super-app-foundation.md](docs/architecture/agentic-super-app-foundation.md), and the [Phase 8 release checklist](docs/release/phase-8-release-checklist.md).
