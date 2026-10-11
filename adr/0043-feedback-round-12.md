# ADR 0043 — Feedback round 12: browser panes done right, pane spacing, workspace marks

Builds on ADR 0042. Decided by the product owner, 2026-10-11.

## Context

The product owner tried round 11 and asked for the browser pane to follow every pane rule, an
attached (gapless) pane look like Orca's, more ways to mark a Workspace (more icons, emoji, the GitHub
avatar), a tidier Appearance page, remote sessions, and a few corrections.

## Decision

### Corrections
- In the Tabs style a pane's "+" opens a tab, with no Tab | Right | Bottom choice; splitting is a drag
  or a tab's menu.
- A Worktree's bar in the sidebar lists every pane: agents and terminals (busiest first), browser
  pages (globe) and open files, headed "N panes".
- The Dashboard's workspace mark sits on the name's line, a size smaller.
- A click anywhere in a chat (Chat mode, a bot's thread, a Work agent's chat view) goes to its message
  box, unless it hit a button, link or field, or ended a text selection (`focusChatInput`).

### Workspace marks
- Icon and color has **Icon | Emoji | Avatar**. Icons: the product owner's twenty (folder, code,
  terminal, bot, package, database, globe, server, chip, layers, braces, rocket, wrench, briefcase,
  building, palette, gauge, sparkles, shapes, box) plus the earlier flask, book and phone; theme colors
  and any color.
- Emoji: every emoji by group with a search over names (the `unicode-emoji-json` package, MIT, loaded
  the first time the picker opens); stored as `emoji`, shown over the icon.
- Avatar: an image of the user's own, or **GitHub avatar**: the avatar of the repository's GitHub
  owner (a person or organization), else of the account signed in to `gh`, fetched from GitHub's public
  avatar address and kept like any avatar (`projects.githubAvatar`). Avatar over emoji over icon; choosing
  one clears the others. The phone shows all three.

### Browser panes follow the pane rules
- A click in a page selects its pane like any other (main reports which page has keyboard focus,
  `focusedPageId`; the frame's `data-focused`). Jumping to a pane from the Kanban or the sidebar's pane
  list brings its tab forward in the Tabs style.
- The page, a native view drawn above the app, steps aside whenever its pane can't be seen: zero size,
  hidden (a maximized side panel hides the main area), covered by the app at its centre and every
  corner, a menu or dialog open, or its tab not chosen. Class changes re-measure it at once.
- A page an agent opens lands beside that agent, and a popup beside the page that opened it: a tab in
  its area in the Tabs style, else to its right. Pages the user opens go where "+" or the menu says.
- Removing a worktree closes its pages instead of leaving them running unseen.
- The end-to-end suite covers it: the page opens beside its agent, a click selects its pane, it hides
  under a maximized side panel, behind another tab and under a menu, a removed worktree closes its
  pages, and a popup lands beside its opener.

### Remote sessions
- The side panel's Sessions lists a Workspace's sessions from the machine it lives on: an SSH host's
  CLIs' own history, read by the host daemon (a new `sessions.list` host service). All adds every
  connected host's sessions to this computer's. A host that can't answer shows none, not an error.

### Pane spacing and Appearance
- **Pane spacing**: Spaced (today's look: air and rounded corners between the sidebars, side panel,
  panes and screens) or **Attached**: no air, square corners, no surface shadow; surfaces meet at their
  borders, like Orca. Asked in the first-run welcome beside the pane style, changed in Settings ›
  Appearance › Panes. Stored as `paneSpacing` (`spaced` default); applied as `data-panes` on the root,
  which sets `--gutter`, `--page-padding` and `--surface-radius`. Dividers and resize handles keep a
  grabbable strip when the gutter is zero; grids inside screens use the spacing scale, not the gutter.
- Settings › Appearance has a section bar: Theme · Panes · Background · VS Code themes · Terminal font,
  one shown at a time.

## Consequences

The sidebar bar now needs the browser pages and open files of each Worktree; files are known once a
Worktree has been opened in this session. One new dependency: `unicode-emoji-json` (data only).
