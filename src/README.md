# Source layout

All product source code belongs under this directory.

- `apps/desktop/` — Tauri host and native integrations.
- `apps/renderer/` — React application.
- `crates/` — Rust capability crates shared by the desktop application.

Keep repository automation in `/tools` and documentation in `/docs`. New
application code must be added to an existing feature or capability boundary,
not to the repository root.

The current architecture map and documentation ownership rules are in
[`docs/README.md`](../docs/README.md). The renderer must remain a projection;
privileged behavior belongs in the desktop host or an owning Rust crate.
