# ADR 0030 — Routines for Work and Chat

Builds on ADR 0028 (decision 4: "Workspace routines (Work) and scheduled chats (Chat) follow on the
same scheduler"). Decided by the agent on the product owner's standing instruction, 2026-10-08.

## Decision

- **One scheduler, three doers.** A routine has either a `botId` (ADR 0028) or a `target`:
  - `{ kind: 'chat', cliId, model? }`: each run starts a **new chat in Chat mode** with that CLI and
    sends the instructions (read-only, like any new chat). It shows in the Chat list like any chat.
  - `{ kind: 'workspace', projectId, workspaceId, cliId }`: each run **opens a new agent** of that CLI
    in the workspace, waits until it is ready (running, idle, something on screen), types the
    instructions and ends when the agent stops working. If the agent asks a question before it
    starts (trust this folder?), the run fails with that reason and the agent stays for the user.
- **Work rules hold.** The agent's card moves on the Kanban by its real state (rules 6–7); nothing is
  added to Work: no new column, no history, no Task entity (rules 9–10). The run's record lives in
  the Bots run log (ADR 0028 decision 1), with `where` ("Claude Code in demo-app · main") naming who
  did it, so a receipt outlives a renamed or removed workspace.
- **No bot permission** applies: the user creates these routines; bots can only schedule themselves
  (paused) through `schedule_routine`. Chat and Work routines have no results thread (`results: 'none'`).
- **Time limit** marks a Work run failed and leaves the agent open ("still open in Work"); a later
  finish is ignored (a run ends once).
- **Where to find them:** the Routines page shows every routine ("All routines"); the editor's "Who
  does it" picks a bot, "A new chat" or "A new agent in a Work workspace". Chat's sidebar has
  **Schedule a chat**; a workspace's menu has **Schedule a routine…**. Both open the editor there.
- Shared helpers: `waitIdle` and `waitReady` now live in `agent-tools/deliver.ts` (used by agent
  tools and Work runs); `routines/work-run.ts` runs one Work routine.

## Not done

- A Work run reusing an idle agent instead of opening a new one.
- Opening a Work run's agent from the run log (its workspace is shown by name only).
