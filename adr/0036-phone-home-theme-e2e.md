# ADR 0036 — Phone: Home overview, its own theme, and end-to-end tests on Android

Builds on ADR 0027 (the phone app). Decided by the product owner, 2026-10-09.

## Context

A hands-on review of the phone app in Expo Go found a dead "notify me" switch (push cannot work in
Expo Go), long two-line rows, a Settings page with too many options, no way to pick the phone's
look, and no overview of every agent. The app had logic tests but no test that drives it on a phone.

## Decision

- **Home is an overview.** The first tab is **Home** (was Inbox): counts of agents that need you,
  are working and are idle across every workspace, then the agents that need you and those at
  work. Its badge still counts what needs you.
- **The phone picks its own theme.** Settings › Appearance › Theme offers "Same as computer"
  (the default, as before) or any palette. Only the phone changes; the computer's settings stay
  read-only for phones.
- **Workspaces are still added on the computer.** A phone creates worktrees inside existing
  workspaces, not workspaces (adding a folder stays desktop-only, as ADR 0027 decided).
- **Push says up front when it cannot work.** In Expo Go, the web build, simulators or a build
  without an EAS project there is no switch, only one line saying why.
- **Settings stays short.** One row per choice; the theme list opens in a sheet.
- **End-to-end tests run on a real Android phone.** `pnpm mobile e2e` starts a throwaway Hiveory
  server (`--serve`, its own profile, a temporary Git repository, and a stand-in agent on a
  PATH that holds nothing else), seeds it as a desktop client, then runs Maestro flows
  (`mobile/e2e/flows`) against Hiveory in Expo Go over adb. The user's own agents, workspaces
  and settings are never touched. `--serve-only` keeps just the seeded server for trying the app
  by hand.

## Consequences

- Running the flows needs adb with one phone (wireless debugging is enough), Java 17 and Maestro,
  plus `pnpm build` and Metro (`pnpm mobile start`).
- The stand-in answers to the Aider adapter because it has no hooks and no MCP configuration, so
  nothing outside the test profile is written.
