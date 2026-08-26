# Agentic Super App

A local-first, open-source desktop foundation for separate agent, code, and chat workspaces.

This repository currently implements the Phase 0–1 foundation: a blank three-mode Tauri shell, governance and CI controls, a versioned internal protocol, and reference-audit contracts. It deliberately does not execute models, tools, terminals, or external providers yet.

## Development

Install the renderer dependencies with `pnpm install`, then run `pnpm --dir agentic-super-app-renderer dev` for the web shell or `cargo tauri dev --manifest-path agentic-super-app-desktop/src-tauri/Cargo.toml` for the desktop host.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/architecture/agentic-super-app-foundation.md](docs/architecture/agentic-super-app-foundation.md).
