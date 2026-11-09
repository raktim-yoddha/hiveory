# ADR 0064 — Review pane, Pull request tab, worktree bar and one agent picker

Builds on ADR 0040, 0042, 0058, 0060, 0061 and 0062. Decided by the product owner, 2026-11-09.

## Context

The product owner asked for a proper code review page and a proper pull request page like Paseo's,
the actions Paseo shows above a worktree, and one menu for everything a chat runs with. Before this,
changes could only be read one file at a time in the narrow Changes tab, a pull request was a link
in the Dashboard, the worktree had no bar of its own, and the composer spread the CLI and model,
effort, access, fast and plan mode over five controls.

## Decision

- **Review pane.** A worktree's changes open as a pane, "Review": every changed file's diff one
  after another, each with its own sticky header (name, folder, New/Deleted/Renamed, +/−, open in an
  editor), old and new line numbers, folding one or every file, the same Uncommitted · Branch ·
  Commit · Turn choice as the Changes tab (they share it, `useChangeSource`). A file's diff is read
  as it scrolls near. Opened from the Changes tab, the git button's menu or Find › Review changes;
  one per worktree. Code: an editor of `kind: 'review'` (`StoredEditor.kind`, `editors.openReview`),
  so it places, tabs, drags and closes like a file; `DiffView` and `diffLines` (now numbered) are
  shared with the Changes tab.
- **Pull request tab.** The side panel gains **Pull request** (after Changes): the worktree branch's
  review on GitHub or GitLab — title and number, Open · Draft · Merged · Closed, branch → base,
  author and review decision, a checks card ("All checks have passed · 9 successful, 13 skipped",
  or failing or running) that unfolds into every check with its workflow, time and log link, and
  **Merge pull request** (squash, merge commit or rebase; confirmed). Without one: Create PR or Draft.
  On the Primary on the default branch it says why there is none. Read again every 30 s while shown
  and on focus. Code: `CodeHost.pullRequestFor` and `merge` (`gh pr view --json …`, `gh pr merge`,
  `glab mr view`, `glab mr merge`), channels `github.pullRequestFor` and `github.merge`.
- **Worktree bar.** Above the panes: the worktree's name, Workspace and branch with its ⋯ actions,
  then **Run ▾** (the Workspace script used last, or pick one; Edit scripts opens Workspace
  settings), **Open in ▾** (VS Code, Cursor, Windsurf, Zed, VSCodium, Sublime Text, IntelliJ IDEA,
  WebStorm or PyCharm — only those installed — the file manager, copy path) and the **git button**
  with the worktree's next step: Commit (opens Changes at the message), Publish branch, Push, Create
  PR or Merge PR, with every step, the pull request and Review changes in its menu. The Primary never
  suggests a pull request of its own. Code: `SplitButton`, `nextGitStep`, channels
  `system.editorApps` and `system.openIn` (an id from the installed list only; local Workspaces).
- **One agent picker.** The composer's CLI, model, effort, access, fast and plan controls become one
  menu: CLIs down a rail (starred models first, across CLIs), the chosen CLI's models with search,
  Ctrl+1–9 and Show more, the model's Reasoning levels beside them, and along the bottom Standard |
  Fast, Plan mode and Read-only | Full access. It stays open while choosing. The trigger shows the CLI,
  model, effort and access at a glance. Stars are kept in this window's storage.
- All new channels are open to a paired Hiveory client (`REMOTE_CHANNELS`), not to the phone.

## Consequences

The side panel has five tabs (ADR 0062 said four). A diff is unified only; side-by-side is left for
later. GitLab shows its pipeline as one check rather than each job. Merging needs `gh` or `glab`
signed in, as pull requests already did. Opening in an editor uses its command-line launcher (or its
macOS app); an editor installed without either is not offered.
