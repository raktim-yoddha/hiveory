# ADR 0062 — Schedules in the sidebar, Workspace settings in Settings

Builds on ADR 0040, 0042 and 0055; supersedes ADR 0042's Routines and Settings side-panel tabs.
Decided by the product owner, 2026-11-09.

## Context

The side panel carried six tabs. Two of them were not about the open worktree at all: Schedules (a
Workspace's calendar) and Workspace settings. They crowded the strip and pushed the worktree's own
tabs into icons sooner.

## Decision

- **The side panel** keeps Dashboard, Changes, Sessions and Explorer only. Its Schedules and
  Settings tabs are gone (`PanelTab.kind` loses `routines` and `settings`; `ProjectPanel` is removed).
- **Schedules** is a row at the top of the left sidebar, above Workspaces (an icon on the folded
  rail). It opens the Schedules page in the main area (`View` `{ type: 'schedules' }`,
  `openSchedules`): every Workspace's schedules on a week calendar (Day, List and Run logs too), the
  keep-awake switch and New schedule. The Open Schedules shortcut opens it from anywhere.
- **New schedule** from that page asks for the Workspace first (then its worktree, starting on the
  Primary, and the CLI). An existing schedule still cannot move to another Workspace (ADR 0040).
- **Workspace settings** live in Settings: a Workspace's right-click › Workspace settings opens the
  Settings window on that Workspace's page (`SettingsSection` `workspace` with the view's
  `projectId`). Settings lists every Workspace under its own sections, so each one's page is reachable
  there too. Find › Workspace settings and the Dashboard's "settings" links open the same page.

## Consequences

The Schedules page shows every Workspace's schedules at once; there is no per-Workspace filter yet.
A worktree's side panel opened before this simply loses the two tabs (side-panel tabs are never
stored). The phone is unchanged.
