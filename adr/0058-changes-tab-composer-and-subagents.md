# ADR 0058 — Changes tab, a richer message box and subagents on any CLI

Builds on ADR 0018, 0022, 0031, 0042, 0052 and 0055; amends ADR 0012 (the CLI lock). Decided by the product owner, 2026-11-08.

## Context

The product owner asked for the message box of chat view to work like the agent environments they
use (Paseo, T3 Code): the CLI and model chosen in one control, effort beside it only when the model
has one, and the details around the box — what the agent plans, the subagents it started, and how
much it changed. Everything the agents change in a worktree should be visible in the right side
panel. Any agent, on any CLI and model, should be able to use another CLI or model as a subagent, in a
terminal or in chat view. T3 Code's useful native features should come too where they fit. All of it
must keep working when the window is a client of a Hiveory server hosted elsewhere (a home lab, a
cloud machine, another computer: ADR 0022, 0052). We studied both projects' behavior and wrote our
own implementation; no code or names were copied.

## Decision

- **Changes tab** in every worktree's side panel (after Dashboard): the branch, a source picker
  (Uncommitted — everything not committed, untracked files included; Branch — against its base's merge
  base; one of the branch's commits; one chat turn), the totals ("+1.9k −684") and a file tree with
  each folder's and file's line counts and a mark (added, modified, deleted, renamed). A file opens its
  diff in place; a pencil opens it in an editor pane; a Commits section lists the branch's commits. It
  reads Git where the worktree lives (this computer, an SSH host or a Hiveory server) and never changes
  the index, branches or files. It refreshes when an agent there changes state, when the window comes
  back, and every 10 s while visible. Channels `changes.list`, `changes.diff`, `changes.commits`
  (remote: a client reads its server's worktrees). `ChangesService` and `WorktreeChanges` in
  `main/services/git`.
- **Turn checkpoints** (after T3 Code): before and after each chat-view turn the worktree is written to
  Git as a tree through a copy of the index (`GIT_INDEX_FILE`), so nothing the user sees in Git
  changes. A reply that changed files says "4 files changed +120 −30 · View · Undo". View opens the
  Changes tab on that turn; Undo (after a confirmation) puts back only the files that turn changed and
  removes those it added (`chat.revertTurn`, remote). Writing a checkpoint takes at most 5 s or is
  skipped; the turn's "after" is written before the next queued message starts.
- **The message box** (chat view):
  - Above it, a strip that shows only what has something to say: the agent's own to-do list ("4/6
    tasks", from Claude's TodoWrite, Codex's plan, OpenCode's todos), its subagents (status dots; a
    click focuses one), and the worktree's uncommitted changes (opens the Changes tab).
  - Placeholder "Message the agent, tag @files, or use /commands and /skills". `@` searches the
    worktree's files; `/` at the start of a message lists the CLI's own slash commands and skills
    (Claude Code lists them in its `initialize` reply, `ChatCatalog.commands`).
  - Toolbar: "+" (files, or a picture of an open window — captured by the window's own computer and
    sent up with `chat.attach`, so it works as a client too), the **CLI and model in one picker** (CLI
    tabs, the chosen one's models; a model of another CLI switches both), effort only when the model
    has levels, permissions, **fast mode** (Claude's Opus models, `--settings {"fastMode":true}`),
    **plan mode** (Claude `--permission-mode plan`, OpenCode/Kilo `--agent plan`; it wins over full
    access), the **context meter** (Claude's context use against the model's window), usage limits,
    send.
  - ↑ in an empty box walks back through the prompts sent here, ↓ forward; Ctrl+S puts a draft aside
    and, in an empty box, brings the last one back (kept in this window only). Text selected in a reply
    offers **Quote**, which puts it in the box as a quote.
- **Switching CLI mid-conversation** (amends ADR 0012): a chat-view agent may move to another CLI. Its
  model, effort, fast mode and CLI session are reset, and the new CLI's first turn starts a new session
  with the conversation so far as context (`ChatSession.handoff`); later turns resume as usual. The
  agent itself becomes an agent of that CLI (`AgentService.followChatCli`).
- **Subagents on any CLI**: `open_agent` takes `model`, `effort`, `task`, `view` (chat or terminal)
  and `wait`. The caller becomes the new agent's parent (`CliInstance.parentId`, with its `model` and
  `effort`); Claude Code and Codex terminals get them as flags, chat view always. With `wait` it returns
  the reply; otherwise a chat-view parent gets the subagent's reply as its next message when it
  finishes (queued while it answers). `list_agents` names each agent's parent. Model ids and efforts
  from a model are checked against the same patterns as `chat.update` before reaching a CLI.
- `ChatMessage` gains `tasks`, `usage` and `checkpoint`; `ChatSession` gains `plan`, `fast`, `handoff`;
  `ChatModel.fast`; `ChatCatalog.commands` and `plan`. The side panel gains the `changes` tab kind.

## Consequences

- Each chat turn in a Git worktree runs `git add -A` into a temporary index twice; a huge folder that
  is not ignored makes that slow (it is skipped after 5 s). Checkpoint trees are not referenced by any
  ref, so `git gc` may prune them after two weeks; an older turn can then no longer be undone.
- Undo overwrites later edits to the same files; the confirmation says so. It does not rewind the
  conversation.
- Fast mode and the context meter are Claude-only for now; Codex's fast tier and context window need
  its app-server, not `exec`. Slash commands come from Claude Code; other CLIs show none yet.
- A terminal parent is not told when a subagent finishes (typing into its TUI could collide with the
  user); it uses `wait` or `wait_for_agent`. Subagent reports live in memory and are lost if Hiveory
  quits meanwhile.
- Voice dictation, visual (HTML) replies, prompt links and rewinding a conversation from T3 Code are
  left for later.
