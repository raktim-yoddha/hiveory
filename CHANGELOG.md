# Changelog

Every Hiveory version, newest first. Hiveory follows [Semantic Versioning](https://semver.org); before 1.0, a
breaking change bumps the minor number. Versions v0.1.0 to v0.20.0 were tagged after the fact, on 2026-10-08,
from the commits that shipped on the dates shown.

The GitHub release for each version lists these highlights and every commit in it.

## v0.22.0 — Workspace settings, chat or terminal per agent, phone chat
_2026-10-09_

- Each Workspace has its own settings: its name, whether new agents open as a chat or a terminal, the model and effort chat agents start with, how new worktree branches are named and where they start, and whether its agents send updates and phone alerts.
- Opening an agent, on the computer or the phone, offers Terminal or Chat every time.
- Chat agents work on the phone: your message shows at once on every screen, replies stream in with formatting, and you can pick the model and effort.
- The phone gets each Workspace's settings and pull requests, a Worktree's branch and changes, the CLI's logo next to an agent's name, and a slash key above the keyboard.
- The phone's Home is calmer: one overview card, worktrees first, and the Silver theme by default.
- Phone sheets, buttons and the live connection work reliably on Android and iOS, also after switching apps.

## v0.21.1 — Windows installer
_2026-10-08_

- The Windows installer is back: v0.21.0's Windows build failed, so this release adds it. Nothing else changes.

## v0.21.0 — Update pop-up, Android updates, terminal zoom, steadier panes
_2026-10-08_

- When a new version is out, a pop-up shows what changed and offers Download, then Restart and update. Settings › Updates can also download updates automatically.
- The Android app checks for new versions when it opens and offers the new APK.
- Terminal text zooms with pane width, for every CLI.
- Full-screen CLIs get the rows they need and show the part that matters.
- A released divider stays put, and every pane keeps its minimum size when the sidebars resize.

## v0.20.0 — VS Code color themes, movable Queen Bee bar, native phone UI
_2026-10-08_

- Install and apply VS Code color themes from Open VSX.
- Drag Queen Bee's floating bar left, middle or right, and shrink it to her mark.
- Phone app: native tab bar, headers, touch feedback, sheets and iOS action sheets in the desktop theme.

## v0.19.0 — Workspaces and Worktrees naming, Primary worktree, narrow-pane terminal fixes
_2026-10-08_

- Projects are now called Workspaces and workspaces Worktrees everywhere; the main one is Primary, with a fixed name.
- The Work/Bots/Chat switch is centred and tab labels line up exactly.
- OpenCode, Kilo and Kimi stay readable in narrow panes; OpenCode no longer crashes (exit 3) in small panes.

## v0.18.0 — Scheduled chats and Work routines, message queue, saved prompts, Podman bot computers
_2026-10-08_

- Scheduled chats and Work routines on the same scheduler.
- Queue the next message while an answer is coming; saved prompts in every message box.
- Routines day view, mini month picker, drag a bot onto an hour, and files every run gets.
- Podman bot computers with a pinned image, Rebuild, reading the screen as UI elements, and shared computers.

## v0.17.0 — Bot triggers, work board, approvals, Queen Bee bot controls
_2026-10-08_

- Bots save their own routines (paused) and runs notify you.
- Overview tab, per-bot notifications and skills.
- Triggers: app events start read-only bot runs.
- A work board of handoffs and runs.
- Queen Bee opens Bots pages and pauses or resumes routines.
- Bots ask before sending or changing things in apps.

## v0.16.0 — Bot panel, routine scheduler and editor, templates, teams
_2026-10-07_

- "Works on" per bot and a bot panel with its computer, a Browser tab and per-bot logins.
- Routines: scheduler with catch-up, editor, Routines page and run log.
- A "+" menu with New bot (Ctrl N) and a templates gallery.
- Teams with one Chief each, and a team map.

## v0.15.0 — Phone app
_2026-10-07_

- The phone app, and the desktop side it needs.

## v0.14.0 — Tailscale device discovery and full SSH remote support
_2026-10-07_

- Find your devices over Tailscale and share this computer.
- SSH host picker, in-app prompts, Hiveory's own Node, terminals that survive drops, and ports.

## v0.13.1 — Pane placement and floating Queen Bee fixes
_2026-10-07_

- Panes move in the same frame as the layout.
- The floating Queen Bee stays pinned.

## v0.13.0 — Apps naming and logos, work-ordered sidebar, more Queen Bee and CLIs
_2026-10-07_

- Plugins are now Apps, with logos.
- The sidebar is ordered by work.
- Steadier panes, more Queen Bee and more CLIs.

## v0.12.0 — Plugins now use your own Composio account (breaking)
_2026-10-07_

- Breaking: key-based plugins are removed. Apps connect through your own Composio account; reconnect them after updating.

## v0.11.0 — Composio sign-in for plugins
_2026-10-06_

- Sign in to Composio with your own account.

## v0.10.1 — Client mode, status timing and OpenCode fixes
_2026-10-06_

- Neutral start-up answers in client mode.
- A hook-started turn counts its silence from when it started.
- OpenCode starts in its mini interface so small panes don't break it.

## v0.10.0 — Run Hiveory as a server with desktop clients
_2026-10-06_

- Run Hiveory as a server and use it from a desktop client, paired with a code.

## v0.9.0 — Host daemon, SSH remote workspaces, bot Docker computers
_2026-10-06_

- Agent and shell terminals run in the hiveoryd host process.
- Workspaces on SSH hosts, over your own OpenSSH.
- Each bot can have its own Docker computer, here or on an SSH host.

## v0.8.0 — Bots mode with a Chief of Staff
_2026-10-06_

- Bots mode: a Chief of Staff with threads, memory and delegation.

## v0.7.2 — Contained startup steps
_2026-10-06_

- Each startup step is contained, so one failure can't stop the app from starting.

## v0.7.1 — One worktree per checkout, terminal replay fix
_2026-10-06_

- One worktree per checkout across workspaces.
- Replayed terminal output no longer answers capability queries.

## v0.7.0 — Side panel areas and Sessions tab, CLI skills, live model on cards, tray, Add workspace dialog
_2026-10-06_

- Side panel tabs can be dragged and split into top and bottom areas, plus a Sessions history tab.
- Every CLI's skills folder, from the CLI registry.
- Live model on every running agent's card.
- Closing the window keeps agents running in the tray.
- An Add workspace dialog; removed workspaces come back whole.

## v0.6.0 — Queen Bee: talkback, four voices, small talk, auto-hide bar
_2026-10-06_

- Queen Bee talks back, in four distinct voices with previews.
- Talk to agents by name, with live updates and small talk.
- An auto-hide bar that rises from the bottom edge.

## v0.5.1 — Browser tool calls can no longer hang
_2026-10-05_

- A web page that never answers can no longer freeze an agent's browser tool call.

## v0.5.0 — Queen Bee: system-wide shortcut, notes, custom personality, subscription CLIs
_2026-10-05_

- A system-wide shortcut for Queen Bee.
- Notes she remembers and a custom personality.
- Subscription CLIs can be her brain.

## v0.4.1 — Queen Bee speech pack fixes
_2026-10-05_

- The Whisper speech pack description matches Latin-script Hinglish.

## v0.4.0 — Queen Bee: rule parser, model brain, voice and provider accounts
_2026-10-05_

- Queen Bee arrives: an assistant that understands requests, runs actions and reports back, with personas.
- Optional model brain and messages to agents.
- Voice input, provider accounts and a shortcut.

## v0.3.0 — Device mode, computer use, flat UI, explorer, editor and shell panes, plugins
_2026-10-05_

- Device mode and computer use; faster browser use.
- Flat UI with explorer, editor and shell panes.
- Plugins and themed dropdowns.

## v0.2.0 — Work and Chat modes, agent tools MCP, Git worktrees, themes, browser use
_2026-10-04_

- Work and Chat modes.
- Agents get Hiveory's tools over MCP.
- Git worktrees are created for you.
- Themes, settings, and a built-in browser agents can drive.

## v0.1.0 — Initial Hiveory: local-first ADE for coding-agent CLIs
_2026-10-04_

- First version: a desktop app that runs coding-agent CLIs side by side in panes.
- A Kanban board shows every agent as Idle, Working or Waiting for you.
