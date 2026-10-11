# ADR 0041 — Skill and MCP stores, and agents that know Hiveory

Builds on ADR 0017, 0020 and 0023. Decided by the product owner, 2026-10-11.

## Context

Skills could only be created by hand or imported from a folder, and MCP servers added by typing their
command. The product owner asked for skills.sh inside the Skills tab (search, install, apply to every
CLI), a global MCP store, and for every agent and Queen Bee to know the app they run in.

## Decision

### Skills: skills.sh
- Settings › Skills, MCP & Apps › Skills has **Installed | skills.sh**. skills.sh is searched as you
  type through its public search (`skills.sh/api/search`, what `npx skills find` uses).
- Before a search it lists the **top 50 skills** by installs, numbered. skills.sh's leaderboard API
  needs a Vercel account, so they are read from the data its home page embeds (`parseLeaderboard`),
  kept ten minutes; if that page changes shape the list is empty and search still works.
- The Installed | skills.sh switch sits at the start of the search row (and In Hiveory | MCP Registry
  likewise), not as a bar of its own.
- Install opens a dialog with the skill's partner security audits (`/api/v1/skills/audit/…`, public),
  where it goes (everywhere, or this workspace / bot) and the skills folders, preselected to the fewest
  that reach every installed CLI (`coveringRoots`: the shared `.agents/skills`, then each CLI's own
  where it does not read the shared one). The dialog says which CLIs that reaches.
- skills.sh's own file API needs a Vercel account, so the files come from the skill's GitHub repository
  (the default branch): the folder named after the skill, else the SKILL.md whose name matches.
  Limits: 100 files, 2 MB each, 8 MB in all; every path stays inside the skill folder. Sources not on
  GitHub show their page only (install with `npx skills add`).

### MCP servers: the official MCP Registry
- The MCP tab has **In Hiveory | MCP Registry** (`registry.modelcontextprotocol.io/v0.1`): the newest
  servers, or a search on Enter (the registry's search takes seconds). Only each server's latest
  version is listed; packages Hiveory cannot run (NuGet, MCPB, local HTTP) are left out.
- Add opens a dialog: how it runs when there are several ways (npx, uvx, Docker, hosted), the command
  it will run, and the values it needs (environment variables, headers, arguments, placeholders such
  as a folder to mount). `connectionFor` turns that into a connection saved with
  `connections.saveCustom`, so Hiveory runs it for every agent like a server added by hand (ADR 0017).

### Agents and Queen Bee know Hiveory
- `APP_GUIDE` (`src/shared/hiveory/guide.ts`) says what Hiveory is and where everything lives (modes,
  Workspace, Worktree, side panel, Dashboard tabs, Bots, Chat, Queen Bee, each Settings section), in
  the user's words. It holds product facts only.
- Every agent, chat and bot gets the MCP tool `hiveory_about` (`AboutTools`): where the caller runs
  (worktree, workspace, branch, folder, the workspace's own settings), which Hiveory tools are on
  (coordination, browser, computer use), the MCP servers and apps Hiveory serves, the defaults for new
  agents, that the user changes settings in Settings, and the guide. Names and switches only: no keys,
  Queen Bee's notes or user data. Every launched agent's prompt points to it (`ABOUT_PROMPT`).
- Queen Bee's fixed prompt carries the same guide: questions about the app get an answer from it, and
  she navigates there when it is a page or a Settings section.

### Links
`system.openUrl` opens only fixed help pages (Composio, Jira and Linear keys) and https pages on
skills.sh and github.com (`isOpenableUrl`). The Jira and Linear links of ADR 0040 were refused before.

New channels: `store.searchSkills`, `store.skillAudits`, `store.installSkill`, `store.searchMcp`
(desktop and paired desktops, not phones).

## Consequences

Installing a skill or adding a server is trusting its author: the audits and the exact command are
shown first, and nothing runs until the user adds it. Unauthenticated GitHub downloads are limited to
60 an hour per computer. Updating installed skills and servers is left for later. The guide is
written by hand: a new screen or Settings section must be added to `APP_GUIDE` too, or agents and
Queen Bee will not know it.
