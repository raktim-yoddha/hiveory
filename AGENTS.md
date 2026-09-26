# Hiveory repository guidance

## Contract map

- Read `docs/README.md` before repository-wide or cross-layer changes. Consult
  `docs/features/` for feature status; update the affected implemented feature
  page when behavior changes. Keep planned proposals prioritized and promote
  shipped items into implemented docs in the same change.
- User-visible capability or setup changes belong in `README.md`.
- Boundaries, ownership, lifecycle, and public/private editions belong in
  `docs/architecture/`.
- Renderer/host commands, DTOs, streams, and replay rules belong in
  `docs/architecture/internal-protocol.md`.
- Persistence and secret-storage changes belong in
  `docs/architecture/persistence-schema-proposal.md`.
- Security and privileged-capability changes belong in
  `docs/security/threat-model.md` and `SECURITY.md`.
- Source ownership and layout changes belong in
  `docs/architecture/repository-conventions.md` and `src/README.md`.
- Durable ownership or policy decisions require an ADR. Phase, specification,
  release-checklist, and verification documents are historical evidence.

## Ownership and generated boundaries

- The renderer is a projection. The Rust host remains authoritative for
  filesystem, process, credential, persistence, provider, and approval work.
- Production must not depend on `hiveory-private`; private Agent execution and
  premium prototypes load only through Dev edition commands.
- Regenerate `src/apps/renderer/src/generated/` with
  `cargo run -p hiveory-tooling`; never hand-edit generated bindings.
- Treat `techn/` as read-only research material.

## Renderer UI

- Before changing renderer UI, read `docs/design-system/README.md`.
- Use the shared tokens and primitives in `src/apps/renderer/src/shared/ui/`.
- Do not introduce raw visual values, new `!important` rules, or ad-hoc
  component variants.
- Preserve the two approved densities: `standard` for global/settings pages
  and `compact` for workbench utilities.

## Verification

- Renderer/UI work: run `pnpm design:check` with renderer checks and tests.
- General changes: run `pnpm verify`, `pnpm audit:identity`, and
  `pnpm audit:references`.
- Public/private boundary changes: also run
  `pnpm audit:private-boundary`.
- Dev/private runtime work: use the sibling checkout and validate with
  `pnpm app:build:dev` or `node tools/scripts/check-dev-native.mjs`.
