# Hiveory

Local-first AI Development Environment: run coding-agent CLIs (Claude Code,
Codex, Gemini CLI, OpenCode, …) side by side in isolated Git worktrees, with a
live Kanban of what each agent is doing.

Start with [AGENTS.md](AGENTS.md) — the engineering contract — and the docs it links.

## Develop

```bash
pnpm install
pnpm dev          # run the app with hot reload
pnpm test         # unit tests
pnpm typecheck
pnpm lint
pnpm build && pnpm smoke   # drive the built app end to end, saving screenshots
```

`SMOKE_AGENTS="Claude Code" pnpm smoke` also opens real agents and exercises
pane docking and Space-swap.

## Installers

```bash
pnpm dist:win     # dist/Hiveory-Setup-<version>.exe
pnpm dist:mac     # dist/Hiveory-<version>.dmg   (run on macOS)
pnpm dist:linux   # dist/Hiveory-<version>.AppImage / .deb
```

The app logo lives in `resources/icon.png` (512×512). It is the single source
for the title bar, window/taskbar icon and every installer icon.
