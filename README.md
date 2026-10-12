<p align="center">
  <img src="resources/icon.png" alt="Hiveory logo" width="112" height="112">
</p>

<h1 align="center">Hiveory</h1>

<p align="center">
  A local-first desktop app for running coding-agent CLIs side by side, each in its own Git worktree,
  with a live board of what every agent is doing.
</p>

<p align="center">
  <a href="https://github.com/raktim-yoddha/hiveory/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/raktim-yoddha/hiveory?sort=semver"></a>
  <a href="https://github.com/raktim-yoddha/hiveory/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/raktim-yoddha/hiveory/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

---

Hiveory runs the agent CLIs you already use (Claude Code, Codex, Gemini CLI, OpenCode and any
other CLI it detects on your computer) in real terminals, next to each other. Each piece of work
gets its own **Worktree**, so agents never step on each other's changes, and a Kanban board shows
which agents are **Idle**, **Working** or **Waiting for you**, by their real state.

Everything runs on your computer. Hiveory has no account and no server of its own.

## Features

- **Workspaces and Worktrees.** Add a folder, create a new repository or clone one. Every Workspace
  has its Primary worktree, and new Worktrees are isolated Git branches that Hiveory creates and
  cleans up for you.
- **Many agents, many panes.** Open several instances of any CLI in one Worktree. Each has its own
  name, process, status and conversation. Split panes right or down, drag them to an edge, swap
  them, or show them as tabs.
- **A live Kanban.** Cards move between Idle, Working and Waiting for you as the agents work, with
  the reason an agent is waiting and the model it is using right now.
- **Terminal or chat.** Open any agent as its real terminal or as a chat, and pick the model and
  effort per agent.
- **Presets.** Save which CLIs to open, and how many of each, then load them into any Worktree.
- **Built-in browser.** A real browser pane that agents can drive (with a visible cursor), with
  profiles, device sizes and element picking to send parts of a page to an agent.
- **Queen Bee.** An assistant bar that answers questions about the app, opens places and acts on
  your Workspaces by voice or text. Speech is transcribed on your computer.
- **Bots.** Teammates with their own brief, memory, schedules and triggers, grouped into teams.
- **Skills, MCP servers and apps.** Manage Agent Skills and MCP servers for every installed CLI in
  one place, browse skills.sh and the MCP Registry, and connect apps through your own Composio key.
- **Code hosts and issues.** Pull requests, merge requests and issues from GitHub, GitLab, Jira and
  Linear in each Workspace's Dashboard; start a Worktree straight from an issue.
- **Remote work.** Open Workspaces on SSH hosts, run Hiveory as a headless server, and reach your
  computers over Tailscale.
- **Phone app.** Watch and steer your agents from Android or iOS, with notifications when an agent
  needs you. It talks only to your own computers.
- **Keeps running.** Closing the window leaves agents working in the tray, and terminal agents
  resume their conversations after a restart.

## Install

Download the installer for your system from the
[latest release](https://github.com/raktim-yoddha/hiveory/releases/latest):

| System  | File                                                  |
| ------- | ----------------------------------------------------- |
| Windows | `Hiveory-Setup-<version>.exe`                         |
| macOS   | `Hiveory-<version>-arm64.dmg`                         |
| Linux   | `.AppImage` or `.deb`, for x64 and arm64 (aarch64)    |
| Android | `Hiveory-<version>.apk`                               |

The desktop app updates itself from GitHub releases. Install at least one agent CLI (for example
Claude Code, Codex or Gemini CLI) and Hiveory will find it.

## Build from source

Requirements: Node.js 24, pnpm 11 and Git.

```bash
git clone https://github.com/raktim-yoddha/hiveory.git
cd hiveory
pnpm install
pnpm dev
```

| Command                | What it does                                       |
| ---------------------- | -------------------------------------------------- |
| `pnpm dev`             | Run the app with hot reload                        |
| `pnpm test`            | Unit tests (Vitest)                                |
| `pnpm typecheck`       | TypeScript checks for main, preload and renderer   |
| `pnpm lint`            | ESLint                                             |
| `pnpm build && pnpm e2e` | End-to-end checks against the real app (screenshots saved) |
| `pnpm dist:win`        | Windows installer in `dist/`                       |
| `pnpm dist:mac`        | macOS `.dmg` and `.zip` (run on macOS)             |
| `pnpm dist:linux`      | Linux `.AppImage` and `.deb` for the build machine |

`E2E_CHAT=1 pnpm e2e` also sends one tiny real chat prompt through Codex.

The phone app lives in [`mobile/`](mobile/README.md) as its own pnpm workspace:

```bash
pnpm mobile:install
```

```bash
pnpm mobile start
```

The app logo is `resources/icon.png` (512×512): the single source for the title bar, window and
taskbar icon, and every installer icon.

## Project layout

```text
src/main      Electron main process: Git, worktrees, PTYs, persistence, IPC handlers
src/host      Separate terminal host process (also installed on SSH hosts)
src/preload   The narrow, typed bridge between main and renderer
src/renderer  React UI
src/shared    Types and contracts shared by desktop and phone
mobile/       The phone app (Expo / React Native)
adr/          Architecture Decision Records
scripts/      Release, end-to-end and repository checks
```

## Contributing

Read [AGENTS.md](AGENTS.md) first. It is the engineering contract for people and coding agents
alike, and links the rest of the docs:

- [design.md](design.md): visual design and tokens
- [architecture.md](architecture.md): processes, services and data flow
- [product-spec.md](product-spec.md): what the product does
- [ui-map.md](ui-map.md): every screen
- [adr/](adr): why things are the way they are

Before opening a pull request, run `pnpm test`, `pnpm typecheck` and `pnpm lint`. Commits follow
[Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:` …), and
releases follow [Semantic Versioning](https://semver.org); see [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Raktim Yoddha
