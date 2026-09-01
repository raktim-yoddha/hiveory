# Hiveory repository conventions

Hiveory is organized by product responsibility so that a team can change one
area without navigating unrelated application code.

## Top-level ownership

| Path | Responsibility |
| --- | --- |
| `src/apps/renderer/` | React user interface and client-side interaction state. |
| `src/apps/desktop/` | Tauri desktop host, native window lifecycle, and native commands. |
| `src/crates/` | Rust domain, runtime, persistence, and integration crates. |
| `tools/` | Build, release, and protocol-generation tooling. |
| `docs/` | Architecture decisions, verification evidence, and contributor guidance. |

## Root layout

```text
src/
  apps/
    desktop/             desktop application host
    renderer/            frontend application
  crates/                Rust capability crates
tools/                   repository automation and generators
docs/                    architecture and verification records
```

## Renderer layout

```text
src/
  app/                 application composition and global styles
  features/            independently owned product capabilities
    browser/
    workspace/
    chat/
    agent/
    automation/
    code/
  shared/              cross-feature code with no feature ownership
    api/                typed desktop-client boundary
  generated/           generated protocol code; never hand-edit
  main.tsx             the renderer entry point only
```

The desktop host keeps `src/lib.rs` as a stable public facade. Its application
composition lives in `src/application/`; native browser, release, and hosted
source integrations remain separate modules until they are split further by
their command families.

A feature may import from `shared/` and its own folder. Cross-feature imports
are deliberate and should use that feature's public component or model, not
its internal state implementation.

## Naming rules

- Directories use lowercase kebab-case (`code-workspace`, `browser`).
- React components use PascalCase filenames and named exports
  (`CodePaneHeader.tsx`, `HiveoryShell.tsx`).
- Hooks use `use-` kebab-case filenames and `useThing` exports.
- Non-component modules use lowercase kebab-case (`browser-models.ts`).
- Tests sit alongside the code they cover and end in `.test.ts` or
  `.test.tsx`.
- API and protocol types retain their source-system names where needed for
  compatibility.

## Change boundaries

- Keep `app/` thin: composition, navigation, and global styling only.
- Put feature-specific reducer, pane, and view code inside its feature.
- Promote code to `shared/` only after at least two features need it.
- Do not manually edit `generated/`; update the source protocol and regenerate.
- Rust crates remain capability-based (`hiveory-*-domain`,
  `hiveory-*-runtime`, `hiveory-*-service`) with dependency direction from UI
  host to orchestration/runtime to domain/persistence.

This structure lets contributors own a feature end-to-end while preserving a
small, explicit shared surface.
