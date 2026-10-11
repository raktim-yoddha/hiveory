# ADR 0040 — Feedback round 10: agent bars, integrations and Work routines

Builds on ADR 0039.
Decided by the product owner, 2026-10-11.

## Context

The product owner reviewed round 9 and asked for a worktree's agents to read as one bar that unfolds
into a list, a calmer title bar, worktrees without panes, GitHub features that visibly work, more
code hosts and issue trackers, and routines that belong to Work instead of borrowing the Bots page.
Shipped as PATCH releases (ADR 0038).

## Decision

### Sidebar
- A Worktree's agents and terminals sit in one rounded bar under its row: a chip per agent (its
  status dot and CLI logo), busiest first, "+N" for what doesn't fit, a chevron that unfolds it.
  Unfolded, it is a list headed "N agents": status dot, logo, pet name · status and how long it has
  been in that status. Every chip and row opens its pane. A click anywhere else on the bar unfolds it;
  "+N" shows only when another chip would not fit (measured from a real chip). The open Worktree's
  highlight covers its row and its bar as one.
- The pane count at the end of a Worktree's row is gone. In its place a loop spins while any agent
  in that Worktree is working.
- The sidebar toggle in the title bar stays where it sits while the sidebar is open, open or closed.

### Dialogs start on their action
A confirmation (delete a worktree, remove a workspace…) opens with its confirm button focused, so
Enter does it; other dialogs start on their first field, else their last footer button — never the
header's Close.

### New worktree
One Create button. With no panes chosen it creates an empty Worktree (Open agent, Load preset);
"Create empty" is gone.

### Code hosts and issue trackers
The GitHub features were checked against a real repository (status, pull requests, issues, creating
one, the GitHub account for new repositories): they work, but they only showed in a tab few found and
only isolated worktrees could open a pull request. Now:
- **Code hosts**: GitHub (`gh`) and GitLab (`glab`, gitlab.com or the user's own instance), each
  through its own CLI the user is signed in to; Hiveory keeps no token for them. A Workspace's code
  host is Automatic (GitLab when the origin address says so, else GitHub), GitHub, GitLab or Off
  (Workspace settings › Integrations). `CodeHost` is the adapter; `GithubService` and
  `GitlabService` implement it, `IntegrationService.hostFor` picks one. The `github.*` channels keep
  their names (phones already use them) and answer for whichever host the Workspace has.
- **Issue trackers**: Jira Cloud (site, email, API token) and Linear (personal API key), connected
  once in Settings › Integrations. The key is checked with the service before it is kept, sealed by
  SecretBox in `PersistedState.trackers`, sent only to that service's own address, and never to the
  renderer, a model or a phone (AGENTS.md rule 27). A Workspace's issues come from its code host
  (default), Jira (a project), Linear (a team) or nowhere.
- **Dashboard**: tabs are Tasks · Worktrees · Issues · Routines · Settings. Pull Requests merges into
  Worktrees: each worktree card shows its PR/MR (or Create PR/MR for any branch but the default, the
  Primary included), and the open PRs/MRs follow below. Issues lists the open issues with a filter;
  Start worktree opens New worktree named after the issue, with it attached. New worktree's issue
  picker uses the same source.
- New channels: `integrations.status`, `integrations.connectJira`, `integrations.connectLinear`,
  `integrations.disconnect`, `integrations.groups`, `issues.list` (desktop and paired desktops; not
  phones). Queen Bee's "open integrations" goes to the new Settings page.
- Not added: Bitbucket and Azure DevOps (no first-party CLI to lean on), Jira Data Center, GitLens (a
  VS Code extension, not a service). Their place is a new `CodeHost` or tracker in the same layer.

### Routines in Work (amends ADR 0030)
Routines stay one engine (schedules, runs, catch-up, keep-awake, the run log; ADR 0028, 0030), but
Work's are Work's own:
- The Dashboard has a **Routines** tab: the routines of this Workspace's worktrees, their run log, and
  New routine (for the open Worktree). A Worktree's "Schedule a routine…" opens the editor in place;
  nothing switches to Bots mode. The editor is mounted once for the whole app.
- A Work routine's editor picks only its Worktree and CLI (the Workspace is fixed, named in its title).
- Bots' Routines page, calendar, run logs and work board show bots' routines and scheduled chats only;
  its editor no longer offers "A new agent in a Work worktree". `isWorkRoutine` draws the line.

## Consequences

The bar needs the agents of every visible Worktree loaded; they already were for the logo line.
Tracker keys are one more secret on disk (sealed like Queen Bee's and Composio's). Issues and
reviews need the network at the moment the tab opens; nothing is cached.
Work routines are no longer on the Bots calendar: a user looking for every schedule in one place
looks in two (Bots, and each Workspace's Dashboard).
