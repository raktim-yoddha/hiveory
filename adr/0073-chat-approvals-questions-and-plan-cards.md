# ADR 0073 — A chat asks before it acts: approval, question and plan cards

Builds on ADR 0051, 0058 and 0064. Decided by the product owner, 2026-11-13.

## Context

A Chat UI ran each turn as a one-shot `claude -p`, so it could only refuse everything that needs
permission (Read-only) or allow everything (Full access). The agent's questions (`AskUserQuestion`)
and a plan in plan mode (`ExitPlanMode`) only turned its status to Needs you, with nothing in the chat
to answer them. Claude desktop, the Codex app, Paseo, T3 Code and Orca all ask on a card; it was item 1
of the feature-gap research (`docs/research-feature-gaps-2026-11.md`).

## Decision

- **Access has three levels** for a CLI that can ask: Read-only, **Ask first** (new) and Full access, in
  the message box's picker (`ChatSession.ask`). Today that is Claude Code; other chat CLIs keep
  Read-only and Full access.
- Claude Code turns get `--permission-prompt-tool mcp__hiveory__approval_prompt`. Hiveory's own MCP
  server offers that tool to chat agents only and holds the call open until the user answers
  (`ChatService.requestPrompt`, `approvals.ts`). Read-only answers tool requests itself (refused);
  Full access never reaches it; Ask first shows a card.
- **Cards** above the message box, one at a time, oldest first ("N more waiting"):
  - a tool: what it would do (its command or file) and everything it would send; Deny or Allow;
  - the agent's questions: its options as keys (several when it allows that) or the user's own words;
    Answer — asked in every access level;
  - a plan (plan mode): the plan in Markdown; Keep planning (with what to change) or Approve plan,
    which leaves plan mode for this turn (at the chat's own access) and for the next message.
- While a card waits, the agent is **Needs you** (permission, answer or plan approval) on the board,
  the sidebar and the phone, and the phone answers the same cards (`chat.answer`, a new channel on both
  lists).
- Stopping the reply, or a turn that ends, refuses what was still waiting.

## Consequences

- A card can wait for hours: the turn's MCP tool timeout is 12 hours (`APPROVAL_WAIT_MS`) and the
  terminal host's relay waits as long. If Hiveory quits while a card waits, the tool call fails and the
  agent continues as refused.
- "Always allow" for a tool is left for later: each turn is a new process, so it would need a list
  Hiveory keeps and passes back. Codex needs its app-server for the same cards, also left for later.
- Claude Code answers tools it treats as safe (like `echo`) without asking, as it does in a terminal.
