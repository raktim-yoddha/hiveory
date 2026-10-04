# ADR 0005 — Technology Stack

## Decision

- Electron (main / sandboxed preload / renderer) built with electron-vite.
- React 19 + TypeScript (strict, `noUncheckedIndexedAccess`).
- Zustand for renderer caches and UI state.
- zod validates every IPC payload in main (`src/shared/ipc/contract.ts`).
- xterm.js renders terminals; `@lydell/node-pty` (prebuilt binaries, N-API) owns PTYs in main.
- lucide-react for generic icons; Inter + JetBrains Mono bundled via Fontsource (offline-first).
- Plain CSS Modules over central design tokens (`src/renderer/src/styles/tokens.css`).
- Vitest for unit tests; `playwright-core` drives the built Electron app in `scripts/smoke.mjs`.
- pnpm.

## Rationale

Smallest set that covers the documented scope. No component library: the
design system is ours and token-driven. `@lydell/node-pty` avoids requiring a
native build toolchain on Windows.

## Consequences

- Installers are built with electron-builder (`electron-builder.yml`): NSIS on
  Windows, dmg on macOS, AppImage/deb on Linux, all branded from
  `resources/icon.png`. Native PTY binaries are unpacked from the asar; the
  per-platform `@lydell/node-pty-*` packages are optional dependencies so the
  right one ships. Code signing is not configured.
- macOS GUI launches inherit a minimal PATH; CLI discovery may need a login-shell PATH there later.
