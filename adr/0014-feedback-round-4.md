# ADR 0014 — Product Owner Feedback, Round 4

Supersedes conflicting parts of ADR 0013.

## "New workspace" lives in the project's navigation
The button sits at the right end of the project page's tab bar (Tasks · Pull
Requests · Workspaces · Settings), not in the app title bar.

## Durable agent sessions
Agents are never left waiting for a Start button:
- On start-up (including after a reboot) Hiveory relaunches every terminal agent,
  a quarter-second apart, each resuming its own conversation.
- Resume is per CLI (adapter `session` spec):
  - **Exact:** Claude Code and Grok take a session id chosen by Hiveory up front
    (`--session-id` / `--resume`); Codex reports its thread id through `notify`,
    stored as `CliInstance.providerSessionId` (`codex resume <id>`).
  - **Latest in folder:** OpenCode, Kilo, Kimi, Qwen, Copilot, Gemini, Cursor,
    Goose, Aider and Antigravity continue the folder's most recent session —
    only when the agent is the folder's sole agent of that CLI, so two agents
    never attach to one conversation. Otherwise the agent starts fresh.
- A resume that fails immediately (the CLI no longer has that session) starts a
  fresh session once instead of showing an error.
- Crashes after 10 s are still recovered automatically (ADR 0013).
The "Agent stopped" overlay remains only for real dead ends: the CLI is missing,
the folder is gone, a crash loop, or the user quit the CLI themselves.

## Chat UI (Chat mode and Work agents alike)
- Pickers are separate pills again, taller (32 px) with clearer icons: effort is
  a level meter; the lock and gauge icons are gone.
- In a Work agent the CLI pill is not shown — the pane header already names it.
- The shield toggle became an explicit **Permissions** pill: *Read-only* (reads
  and answers) or *Full access* (edits files, runs commands).
- A new chat shows the CLI's logo centred with a line of guidance.
- The composer and thread measure their own width (container queries): labels
  collapse to icons in narrow panes; nothing overflows.
- Attachments: paste or drop images, video and files, or use the paperclip.
  Files from disk are sent by path; pasted data (screenshots) and text longer
  than 4,000 characters are saved by main as files first. Main accepts only
  paths it registered for that chat. CLIs get them natively where supported
  (Codex `--image`, OpenCode/Kilo `--file`, Claude `--add-dir`) and by path
  otherwise.
- The reading column is wider (1200 px) with slim gutters.
- Chats can be renamed: double-click or right-click in the Chat sidebar, or the
  pencil in the chat header.
