# ADR 0031 — Queued messages and saved prompts

Builds on ADR 0012 (Chat), 0022 (Bots) and the K2 idea in `docs/plans/bots-automation.md` ("a queued
request you drop onto a bot to send as its next prompt; a saved prompt the user may want in all three
modes"). Decided by the agent on the product owner's standing instruction, 2026-10-08.

## Decision

- **Queued messages.** While a chat, a bot's thread or a Work agent in chat view is answering, the
  message box stays open: Enter (or the queue button beside Stop) lines the text up as the next turn.
  `ChatSession.queued` (at most 10, persisted with the chat) shows above the box as "Next" / "Then",
  each removable. When a turn ends without an error, main sends the first one; after an error the
  queue waits for the user; **Stop drops the queue**. A turn another part of Hiveory starts first (a
  delegated result) goes ahead, and the queue follows it. Files can't be queued (they are attached
  to one turn). IPC `chat.queue` (sends at once when idle) and `chat.unqueue`.
- **Saved prompts.** `PersistedState.savedPrompts` (at most 100; title from the first line). The
  bookmark button in every message box inserts one (after what is typed), saves what is typed, or
  removes one. IPC `prompts.list | save | delete`, topic `prompts`. The user's own words, kept on
  this computer (rule 27): no model sees them unless the user sends one.
- Both are shared by Chat, Bots and Work's chat view because they live in `ChatComposer`.

## Not done

- Dragging a saved prompt onto a bot in the sidebar.
- Queueing for Work agents in terminal view (their TUI has its own input).
