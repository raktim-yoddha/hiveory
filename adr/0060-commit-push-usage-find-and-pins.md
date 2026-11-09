# ADR 0060 — Commit and push from Changes, Usage, Find and pinned Workspaces

Builds on ADR 0027, 0047, 0053 and 0058. Decided by the product owner, 2026-11-08.

The product owner asked for more features in the spirit of Paseo and T3 Code, an all-in-one app, and
the phone app built to match.

## Context

The Changes tab (ADR 0058) showed every change but could not act on any of it: committing or
pushing meant opening a terminal. Nothing showed how many tokens the agents used. Finding a
worktree, a CLI or a Settings page meant knowing where it lives, and a long sidebar had no way to
keep the Workspaces in daily use on top. The phone had none of the Changes tab.

## Decision

- **Commit, push and discard in Changes.** With Uncommitted shown, a message box under the tree
  commits every change, new files included (`changes.commit`: `git add -A` then `git commit`);
  Ctrl/⌘+Enter commits, Commit & push pushes after. Push sends the branch's commits; a branch
  without an upstream goes to `origin` under its own name and tracks it (`changes.push`). A file's
  undo button, after a confirmation, puts it back as it is in HEAD: restored when HEAD has it,
  removed when it is new (`changes.discard`). Ignored files are never touched. Every path is a
  `:(top,literal)` pathspec, so a name can never act as a pattern or an option. Git's own message
  is shown when it refuses (no identity, a rejected push, a detached HEAD, no origin).
  The writing code lives in `git/commit-changes.ts`; `WorktreeChanges` still only reads.
- **Usage** (Settings › Usage, and the phone's Settings › Usage): tokens per day, CLI and model
  (input, output, cache read, cache write, replies) for Today, 7, 30 or 90 days, read from the
  Claude Code, Codex and Gemini CLI history on the machine Hiveory runs on (`usage.report`). Each
  Claude reply counts once (its records repeat the same usage per content part); Codex counts the
  growth of its running totals. Counts only: Hiveory never shows a price it cannot know.
- **Find** (the command palette): Ctrl+Shift+P on Windows and Linux, ⌘K on macOS (a new
  `command-palette` shortcut, changeable in Settings › Keyboard), or the search button at the
  bottom of the sidebar and on the rail. It finds Chat UI and each installed CLI to open in the
  open worktree, its side panel tabs, every Workspace and worktree, every app command (with its
  keys) and every Settings page. Every word must match; one word may match letters in order.
- **Pinned Workspaces**: a Workspace's menu has Pin to top / Unpin (`ProjectSettings.pinned`).
  Pinned Workspaces come first in the sidebar, the rail, Find and the phone's Work list, each
  part in the chosen order. The phone pins from a Workspace's settings.
- **The phone** gets a Changes screen (a worktree's branch row opens it): Uncommitted or Branch,
  each file's diff, Commit, Commit & push, Push and Discard; and the Usage screen.
- New channels `changes.commit`, `changes.push`, `changes.discard` and `usage.report` are remote
  channels and phone channels. `diffLines` and the usage helpers moved to `src/shared/domain/diff.ts`
  and `usage.ts`, dependency-free, so the phone uses the same code.

## Consequences

- Commit always takes every change; picking files to commit, amending and pulling are left to a
  terminal or an agent. A rejected push says to pull first rather than doing it.
- Usage covers the three CLIs whose history format Hiveory already reads for Sessions; other CLIs
  and Workspaces on SSH hosts are not counted yet. A CLI that changes its history format shows less,
  never an error.
- Find has no history or ranking by use; the list is rebuilt from the live stores each time.

## Amendment (2026-11-09): Find in titled sections, roomier screens

Decided by the product owner: Find and other screens were cramped and wordy.

- Find lists its results in titled sections (each group named once, with its icon on every row), in
  the order of each group's best match (`groupRanked`). Rows are taller with the label first and a
  short hint after it; a footer shows ↑ ↓, Enter and Esc. Hints that only repeated themselves ("in a
  terminal", the link's address) are gone; "Copy a link" and "Workspace settings" form a This worktree
  section.
- Settings rows, group titles and menus get more room (padding, line height, a hairline between
  rows), within the design tokens, and the longest Settings, Remote, Schedules and board texts are cut
  to one sentence.
- The side panel's Changes, Sessions and Explorer pages share the Dashboard's inset; Explorer rows
  and its search are taller. Skills and other Settings lists get roomier items, and a skill's
  description shows one line (the full text is its tooltip).
