# ADR 0071 — A repository in a parent folder is used only when chosen

Builds on ADR 0021, 0039, 0058, 0060 and 0064. Decided by the product owner, 2026-11-13.

## Context

A Workspace folder without a `.git` of its own belongs to whatever repository Git finds above it.
On a real machine that was a repository started by mistake in the folder that holds all of one's
projects: a Workspace inside it saw 110,083 untracked files from every other project. Hiveory used
that repository like the Workspace's own. Commit ran `git add -A` at its root, staging other
projects' files, Push and Publish branch sent them to that repository's remote, Discard and chat
checkpoints worked on it, and every Workspace under it was treated as the same checkout (ADR 0021,
0039), so they mirrored each other's Worktrees.

VS Code met the same problem (confusing change lists, data lost by discarding) and since 1.75 does
not open a repository in a parent folder by default: `git.openRepositoryInParentFolders` is
`prompt`, and it asks "A git repository was found in the parent folders… Would you like to open
it?".

## Decision

Ask first, as VS Code does.

- A Workspace whose repository root is not its own folder (`Project.repositoryRoot` above
  `Project.path`) does not use that repository until the user chooses it. Its Git features stay off:
  no git button in the Worktree bar, no branch on the Primary, no new Worktrees, no pull requests or
  issues from it, no chat checkpoints. Commit, Push and Discard refuse (`NOT_A_REPOSITORY`); the
  change list and commits are empty.
- The Changes tab and Workspace settings › Repository say where that repository is and why Git is
  off, with two choices: **Use that repository** (stored as the Workspace setting
  `useParentRepository`, sent through `projects.update`; no new channel) and **Give this folder its
  own** (Initialize Git in the folder itself). Once used, Workspace settings offers **Stop using it**.
- Two Workspaces mirror each other, or count as one checkout, only through a repository both use.
- One rule decides all of it: `parentRepository` and `usedRepository` in `src/shared/domain/project.ts`,
  used by main and the window alike. Paths compare across `\` and `/`, a trailing slash and a
  Windows drive's case.

## Consequences

A Workspace opened on a subfolder of a real monorepo now needs one click before its Git features
work, existing ones included (VS Code asks the same). Initialize Git in such a folder creates a
repository nested in the larger one, which the larger one then sees as an embedded repository.
Hiveory does not change the parent repository itself; removing a mistaken one is left to the user.
