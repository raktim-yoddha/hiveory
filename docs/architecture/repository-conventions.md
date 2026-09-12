# Hiveory repository conventions

Hiveory is organized by product responsibility so that a team can change one
area without navigating unrelated application code.

## Top-level ownership

| Path | Responsibility |
| --- | --- |
| `src/apps/renderer/` | React user interface and client-side interaction state. |
| `src/apps/desktop/` | Tauri desktop host, native window lifecycle, and native commands. |
| `src/crates/core/` | Shared protocol, persistence, security, and services. |
| `src/crates/modes/` | Chat and Code crates, plus public Agent compatibility contracts. |
| `src/crates/global/` | Plugin and automation crates shared across modes. |
| `tools/` | Build, release, and protocol-generation tooling. |
| `docs/` | Architecture decisions, verification evidence, and contributor guidance. |

## Root layout

```text
src/
  apps/
    desktop/             desktop application host
    renderer/            frontend application
  crates/
    core/                cross-mode foundations
    modes/agent/         public Agent compatibility contracts and inert receiver
    modes/chat/          Chat domain
    modes/code/          Code runtime and workspace
    global/plugins/      manual plugin runtime
    global/automations/  scheduling
tools/                   repository automation and generators
docs/                    architecture and verification records
```

## Renderer layout

```text
src/
  app/                 application composition and global styles
  features/
    modes/
      chat/
      code/workspace/
    global/
      browser/
      plugins/
      skills/
      automations/
      tasks/
      settings/
  shared/              cross-feature code with no feature ownership
    api/                typed desktop-client boundary
  generated/           generated protocol code; never hand-edit
  main.tsx             the renderer entry point only
```

The desktop host keeps `src/lib.rs` as its public facade. Its application
composition lives in `src/application/`, with platform-specific modules under
`src/application/platform/`. Command families will be split from the existing
host module as their ownership boundaries are extracted.

A feature may import from `shared/` and its own folder. Shared screens such as
Plugins and Automations live in `features/global/`; Chat and Code consume their
public views directly. Premium UI resolves through an edition provider, whose
public implementation is an unavailable receiver.

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
