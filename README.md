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
pnpm build && pnpm e2e     # 50 end-to-end checks against the real app (screenshots saved)
```

`E2E_CHAT=1 pnpm e2e` also sends one tiny real chat prompt through Codex.

## Releases

Say "release X.Y.Z" to an agent, or run `pnpm release X.Y.Z --check` then
`pnpm release X.Y.Z` (rules: AGENTS.md §26, Semantic Versioning). GitHub Actions builds the
installers for Windows, macOS, Linux and Android; every version is in [CHANGELOG.md](CHANGELOG.md).

## Installers

```bash
pnpm dist:win     # dist/Hiveory-Setup-<version>.exe
pnpm dist:mac     # dist/Hiveory-<version>.dmg   (run on macOS)
pnpm dist:linux   # dist/Hiveory-<version>.AppImage / .deb
```

The app logo lives in `resources/icon.png` (512×512). It is the single source
for the title bar, window/taskbar icon and every installer icon.
