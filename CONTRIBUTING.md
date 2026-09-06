# Contributing

Thank you for contributing. This project is Apache-2.0 licensed.

## Guardrails

- Treat `techn/` as read-only research material. Do not copy source, assets, identifiers, layouts, or product identity from it.
- New implementation-owned crate names, source roots, commands, and configuration namespaces must use the `hiveory` namespace.
- Keep the Rust host authoritative for privileged work. The renderer is a projection, never an authorization boundary.
- Add tests with behavior changes. Update the root README for user-visible behavior and the owning architecture or threat-model document for boundary changes. Add an ADR for lasting ownership or policy decisions.
- Treat [docs/README.md](docs/README.md) as the documentation index. Phase plans, dated design specs, milestone checklists, and verification evidence are historical records; current behavior belongs in the maintained architecture documents.

## Checks

Run `pnpm verify`, `pnpm audit:identity`, and `pnpm audit:references` before opening a pull request. `pnpm verify` runs renderer checks/tests plus `cargo fmt --all -- --check`, Clippy, and the Rust workspace tests.

## Commit and review

Use focused commits. Pull requests should state the affected mode or shared domain, the user-visible behavior, test evidence, and any security or persistence implication.
