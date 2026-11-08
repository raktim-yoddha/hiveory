# ADR 0059 — Chat UI is its own entry; CLIs open in their terminals

Builds on ADR 0058; supersedes the chat-view choices of ADR 0013, 0037 and 0038. Decided by the product owner, 2026-11-08.

## Context

Chat view was a way of opening a CLI: a "Terminal | Chat" dropdown in a pane's "+", a "Use chat UI"
toggle in presets and new worktrees, a Workspace setting and an app setting ("New agents open as").
Since ADR 0058 a chat picks its CLI and model in its own message box and can change them at any time,
so choosing the view per CLI up front is no longer needed. The CLI and model picker also showed the
CLIs as a row above the models.

## Decision

- A pane's "+" lists Browser, **Chat UI**, Terminals and Agents. A CLI picked from the list always
  opens in its terminal. Chat UI opens a chat on the CLI last picked in a chat in this window (else the
  first chat CLI installed); its CLI and model are chosen, and changed, in the message box. SSH
  Workspaces have no Chat UI (a chat runs its CLI on the machine Hiveory runs on). The phone's "Open an
  agent" sheet has the same Chat UI row.
- Gone: the "Terminal | Chat" dropdown, "Use chat UI" in presets and new worktrees, Settings › Agents ›
  New agents open as (`defaultChatUi`), Workspace settings › New agents open as (`agentView`), and the
  stored `chatUi` of worktrees and presets. Saved values are dropped when the state is read.
  `agents.open` still takes `chatUi` (Chat UI, the phone and subagents ask for it); without it a CLI
  opens in its terminal.
- The CLI and model picker shows the CLIs down the left and the chosen CLI's models on the right.

## Consequences

A preset or a new worktree can no longer open its agents as chats; open a Chat UI and pick the CLI.
Agents already open in chat view stay chats. A Workspace's chat models (ADR 0037) still apply to a Chat
UI on that CLI.
