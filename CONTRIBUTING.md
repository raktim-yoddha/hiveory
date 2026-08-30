# Contributing

Thank you for contributing. This project is Apache-2.0 licensed.

## Guardrails

- Treat `techn/` as read-only research material. Do not copy source, assets, identifiers, layouts, or product identity from it.
- New implementation-owned crate names, source roots, commands, and configuration namespaces must begin with `hiveory` or `hiveory`.
- Keep the Rust host authoritative for privileged work. The renderer is a projection, never an authorization boundary.
- Add tests with behavior changes and update the relevant audit, ADR, or threat-model record when an architectural decision changes.

## Checks

Run `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm check`, `pnpm test`, `pnpm audit:identity`, and `pnpm audit:references` before opening a pull request.

## Commit and review

Use focused commits. Pull requests should state the affected mode or shared domain, the user-visible behavior, test evidence, and any security or persistence implication.
