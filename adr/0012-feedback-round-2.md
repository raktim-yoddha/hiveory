# ADR 0012 — Product Owner Feedback, Round 2

Decisions made directly by the product owner (or required to implement their
requests). They supersede conflicting statements in earlier docs.

## Shell
- Top-level modes are named **Work** and **Chat**. Both stay mounted; switching
  only hides one, and all agent/chat processes live in main, so neither sleeps
  (`backgroundThrottling: false` on the window).
- App **Settings** open from the gear in the title bar (Appearance, Agent tools,
  Skills & MCP, Updates, Guide, About). The project page no longer has a gear;
  its Settings tab stays for project-level settings.
- A **right side panel** (title-bar toggle) holds a real shell per Workspace
  (`ShellService`). Browser is shown but disabled ("Soon") until it is built.
- Development builds show an inverted **DEV** chip after the name.

## Themes
Two themes: **Bronze** (default) and **Silver**, implemented as token overrides
(`:root[data-theme='silver']`). Terminals and native window chrome follow.

## Panes
- Pane headers are shorter with their own tone; controls adapt to the pane's
  width via container queries. Close never hides; maximize hides first
  (double-click still maximizes).
- Dragging a pane to the top edge shows an arrange bar: **Equal**, **Focus**
  (dragged pane takes half, others stacked equally), **Columns**.
- Minimum pane size is enforced per subtree when resizing; a squeezed pane can
  grow but never shrink further. Splits that would not fit are disabled.
- Keyboard: dividers resize with arrow keys; ⋯ → Move left/right/up/down swaps.

## Terminal input
Clipboard goes through main (Electron clipboard), so paste/copy never depend on
browser permissions and dictation tools that paste (Wispr Flow) work. Ctrl+V
with an image forwards a raw Ctrl+V so the CLI reads the clipboard itself.
Shift+Enter sends ESC+CR (newline in agent prompts). The application menu is
removed on Windows/Linux so Alt shortcuts reach CLIs.

## CLI identity
Official marks for every CLI: LobeHub Icons (MIT) or the publisher's GitHub
organization avatar, generated into `icon-data.ts` by
`scripts/generate-cli-icons.mjs`. Antigravity CLI (`agy`) joins the Work
catalog; it is excluded from Chat.

## Agent tools (MCP)
Every supported agent (Claude Code, Codex, OpenCode, Kilo, Copilot) gets a
per-launch MCP server `hiveory` over loopback Streamable HTTP with a bearer
token (requests with an Origin header are refused). Tools: list_agents,
read_agent (rendered screen via a headless terminal mirror), send_message
(bracketed paste when supported), wait_for_agent, open_agent, close_agent,
arrange_panes, run_in_terminal, read_terminal. Tools are scoped to the caller's
project; enums list only installed CLIs; errors name the valid choices.
Browser tools will be added with the browser. Toggle in Settings → Agent tools.

## Chat
Chats run CLIs headless in main (`ChatService`) and parse their streaming
output (Claude/Grok/Cursor/Kimi stream-json, Codex exec --json, OpenCode/Kilo
run --format json, Gemini/Qwen stream-json, plain text). Order: CLI → model
(searchable, grouped; discovered from `codex debug models` and
`opencode models --verbose`) → effort, shown only when the chosen model lists
effort levels. The CLI locks after the first message; model/effort may change
per turn. CLIs that cannot resume get a bounded transcript replay. npm `.cmd`
shims are resolved to their real target so prompts never pass through cmd.exe.

## Git
Isolated workspaces: choose base branch and branch name (validated with
`git check-ref-format`), or check out an existing branch (never deleted by
Hiveory). Non-repositories get one-click "Initialize Git" (with first commit).
Workspace cards show live status (changes, ahead/behind). Missing folders can
be repaired from their branch. Pull requests via the GitHub CLI: list open PRs,
push a workspace branch and create a PR, pick issues for association.

## Updates & releases
electron-updater checks GitHub Releases manually or automatically (setting);
nothing downloads without a click; dev builds report "unsupported". Releases
follow SemVer and AGENTS.md rule 26 (`pnpm release X.Y.Z`).
