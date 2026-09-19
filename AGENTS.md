# Hiveory UI requirements

Before changing any renderer UI, read `design-system/MASTER.md`.

- Use the shared tokens and primitives in `src/apps/renderer/src/shared/ui/`.
- Do not introduce raw visual values, new `!important` rules, or ad-hoc component variants.
- Preserve the two approved densities: `standard` for global/settings pages and `compact` for workbench utilities.
- Run `pnpm design:check` with the normal renderer checks before handing off UI work.
