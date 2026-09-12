# Source layout

All product source code belongs under this directory.

- `apps/desktop/` — Tauri host, native integrations, and command adapters.
- `apps/renderer/` — React shell and feature views.
- `crates/core/` — protocol, persistence, security, and reusable services.
- `crates/modes/` — Chat and Code crates, plus public Agent compatibility contracts.
- `crates/global/` — plugin and automation capabilities shared across modes.

Keep repository automation in `/tools` and documentation in `/docs`. New
application code must be added to an existing feature or capability boundary,
not to the repository root.

Inside the renderer, `features/modes/` owns mode-specific UI and
`features/global/` owns Plugins, Skills, Automations, Browser, Tasks, and
Settings. The Code workspace lives under `features/modes/code/workspace/`.
Premium implementations live in the separate private sibling repository;
public feature receivers live in `apps/renderer/src/app/`.
The complete public/private boundary and build behavior are documented in
[`docs/architecture/private-feature-boundary.md`](../docs/architecture/private-feature-boundary.md).

The current architecture map and documentation ownership rules are in
[`docs/README.md`](../docs/README.md). The renderer must remain a projection;
privileged behavior belongs in the desktop host or an owning Rust crate.
