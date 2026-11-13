# Feature gaps against other ADEs and native apps (November 2026)

What Paseo, Orca, T3 Code, Emdash, Superset/Paradev, Vibe Kanban, CodexMonitor, the Claude
desktop app (Code tab) and the Codex app (ChatGPT desktop) do that Hiveory does not do yet, or
does more thinly. Research notes only: nothing here is decided or built.

**How this was checked.** The open-source apps were cloned at their latest commit (13 Nov 2026)
and read from their own docs, changelogs and source: Paseo `CHANGELOG.md` and `docs/`, Orca
`docs/site/content/docs/**`, T3 Code `docs/user/**`, plus the READMEs of the others. Claude
desktop and Codex app features come from their official docs (code.claude.com/docs/en/desktop,
developers.openai.com/codex/app/*). Every "Hiveory today" line was checked against Hiveory's
source (`src/`), `product-spec.md`, `ui-map.md` and the ADRs. Items Hiveory already has (pane
tabs, browser with annotate and device mode, Schedules, Sessions tab, Changes tab, PR tab with
checks and merge, Find, scripts, prompt links, notifications, taskbar badge, phone app, SSH,
durable terminals, usage page, checkpoints with Undo, queued messages, Also ask, sent-prompt
recall with ↑, pasted text as attachment) are left out.

**Labels.** *Missing* = not in Hiveory. *Deepen* = there, but thinner than the others.
Effort: **S** about a day, **M** a few days, **L** a week or more. "Needs ADR" marks items rule 29
requires one for; "Needs decision" marks items that touch an existing rule or product decision.

---

## 1. Ranked shortlist (most value for the effort)

| # | Feature | Kind | Effort | Who has it |
|---|---|---|---|---|
| 1 | Approve / deny cards, question cards and plan approval in Chat UI | Missing | L | Claude desktop, Codex app, Paseo, T3, Orca |
| 2 | Line comments on diffs, sent to an agent as one batch | Missing | M | Orca, Claude desktop, Codex app, Paseo, Superset, Vibe Kanban |
| 3 | Worktree setup script + `.worktreeinclude` (copy `.env` etc.) | Missing | S | Codex app, Claude desktop, Orca, Paseo, Superset |
| 4 | Find in terminal scrollback (Ctrl+F) | Missing | S | Orca, Paseo |
| 5 | Steer a running chat turn (not only queue) | Missing | M | Paseo, T3, Codex app, CodexMonitor, Claude desktop |
| 6 | Send failing checks / PR comments to an agent; watch a PR and wake the agent | Missing | M | Claude desktop (Auto-fix), T3 (`watch_pull_request`), Orca, Codex app, Paseo |
| 7 | Stage / unstage / revert per file and per hunk | Missing | M | Codex app, Orca, CodexMonitor |
| 8 | Edit from an earlier message (rewind) and fork a conversation | Missing | M | T3, Paseo, Claude `/rewind` |
| 9 | Dev servers per worktree: detect ports, open in browser pane, stop | Missing | M | Claude desktop, Superset, T3 |
| 10 | Quick open files in Find (Ctrl+P) | Missing | S | Paseo, Orca, Codex app |
| 11 | Side chat (`/btw`) that reads the conversation without adding to it | Missing | M | Claude desktop, Codex app, T3 |
| 12 | Merge when ready (GitHub auto-merge) | Missing | S | Claude desktop, Orca, T3 |
| 13 | PR create dialog (title, body, base) instead of `--fill` | Deepen | S | Orca, Codex app, T3 |
| 14 | Markdown / image / PDF / CSV previews in the editor pane | Missing | M | Orca, T3, Claude desktop |
| 15 | Unread state per agent + "next agent that needs me" shortcut | Missing | S | Codex app, Orca, Paseo |

---

## 2. Chat UI

Hiveory today: each chat turn runs as a one-shot print-mode process
(`src/main/services/chat/providers.ts`: `claude -p … --output-format stream-json`, `codex exec
--json`, etc.). Access is only Read-only, Full access or Plan mode. A message part is `text`,
`thinking` or `tool` (`src/shared/domain/chat.ts`). `AskUserQuestion` and `ExitPlanMode` only
set the agent's status to Needs You (`src/main/services/cli/adapters/claude.ts:20`); the chat has
no card to answer them.

### 2.1 Approval cards, question cards, plan approval — Missing, L, Needs ADR
- **Others:** Claude desktop modes Manual / Accept edits / Plan / Auto / Bypass, with accept or
  reject per change. Codex app: Enter approves, Esc declines. T3 `permission-modes.md`:
  Supervised, Auto-accept edits, Full access; subagent approvals surface in the parent. Paseo:
  question cards with option previews, clickable links, Next / Submit; "Implement with Auto" on
  a plan approval. T3 `question-attachments.md`: files can be attached to an answer. Orca
  `native-chat.mdx`: AskUserQuestion renders as a card with Submit.
- **How they do it:** Paseo runs Claude through the Claude Agent SDK and answers
  `canUseTool` (`packages/server/src/server/agent/providers/claude/agent.ts:3777`). T3 runs Codex
  through `codex app-server` (`packages/effect-codex-app-server`), which sends approval requests.
- **For Hiveory:** two paths for Claude. (a) keep `claude -p` and add
  `--permission-prompt-tool mcp__hiveory__<tool>`, so permission requests, `AskUserQuestion`
  and `ExitPlanMode` arrive at Hiveory's own MCP server, which already runs per agent; or (b) move
  chat to the Agent SDK as Paseo does (a new dependency). Codex needs `app-server` instead of
  `exec`, which ADR 0058 already names as needed for fast mode and the context window. New
  `ChatPart` kinds: `approval`, `question`, `plan`. A new access level "Ask" next to Read-only and
  Full access.

### 2.2 Steer a running turn — Missing, M, Needs ADR
- **Others:** T3 "Follow-up behavior: Queue | Steer"; Ctrl+Enter does the opposite of the
  default; Ctrl+Shift+Enter sends the oldest queued message as a steer; Alt+↑ edits the last
  queued message. Codex app Settings › General › Follow-up behavior. Paseo "active-turn steering
  for Claude, Codex and OpenCode". Claude desktop: typing a correction and pressing Enter reaches
  Claude after the current action.
- **Hiveory today:** messages sent while answering are queued (ADR 0031); no steer.
- **For Hiveory:** needs a long-lived process per chat (Claude `--input-format stream-json`, or
  the Agent SDK's streaming input; Codex app-server). Same plumbing as 2.1, so build them together.

### 2.3 Edit from an earlier message (rewind) and fork — Missing, M
- **Others:** T3 "Edit from here" with **Revert and keep changes** or **Revert files too**; the
  prompt and attachments return to the composer. Paseo "Rewind chat or files from any user
  message", "fork from an earlier reply". Claude `/rewind`.
- **Hiveory today:** every chat turn has a checkpoint with View and Undo (ADR 0058); ADR 0058
  lists rewinding the conversation as left for later.
- **For Hiveory:** files: reuse `checkpoints.ts` (restore to the checkpoint before the chosen
  turn). Conversation: Paseo uses the SDK's `forkSession` (`providers/claude/rewind.ts`). For
  CLIs that can't fork, T3's "portable handoff" (`portable-handoffs.md`) replays a budgeted
  selection of messages into a new session — Hiveory already does this when switching CLI
  mid-conversation (ADR 0058), so that code is reusable.

### 2.4 Side chat (`/btw`) — Missing, M
- **Others:** Claude desktop Ctrl+; or `/btw`, reads everything so far, adds nothing back.
  Codex app "Open side chat" (⌘⌥S). T3 `/side` or `/btw`, opens as a right-panel tab, starts
  with the parent's model and permissions, and **Bring back** hands the side chat to the parent.
- **For Hiveory:** resume the parent session as a fork (`claude --resume <id> --fork-session`,
  read-only access) in a Chat UI tab in the side panel; "Bring back" sends its last reply to the
  parent as a quoted message.

### 2.5 How tool calls show — Deepen, S
- **Others:** Claude desktop view modes Normal / Thinking / Verbose (Ctrl+O). T3 **Tool calls in
  chat**: Show all / Hide successful / Hide all / Zen (only your message and the final reply);
  consecutive tool calls fold into one summary ("Ran 2 commands, edited 3 files"). Paseo
  "group tool calls" and "collapse completed turns".
- **Hiveory today:** every tool call is its own `<details>` row (`ChatMessages.tsx:139`).
- **For Hiveory:** a per-device setting and a grouping pass over consecutive `tool` parts.

### 2.6 File edits as diffs inside the chat — Missing, M
- **Others:** T3 activity log "Open diff" on a file change; Paseo shows each file of a Codex
  multi-file patch; Claude desktop opens a path from the chat.
- **Hiveory today:** tool rows show only text output; the turn's diff is behind View.
- **For Hiveory:** Edit/Write tool inputs already arrive in the stream; render them with the
  existing `DiffView`.

### 2.7 Message details — Deepen, S
- Timestamps and turn duration on every message (Paseo "Chat timestamps and turn durations").
- Cumulative estimated cost of the conversation (Paseo; Claude `result` events carry
  `total_cost_usd`).
- Copy button and syntax highlighting on code blocks (Paseo, T3). Hiveory's `Markdown.tsx` has
  neither; CodeMirror's `@codemirror/language-data` and `@lezer/highlight` are already installed
  and can highlight statically.
- Mermaid diagrams with fullscreen pan/zoom (Paseo, Orca); LaTeX math (T3 "Render math").
- Links for `#123` and `owner/repo#123` in replies (Paseo, for GitHub, GitLab, Gitea, Forgejo).

### 2.8 Visual (HTML) replies — Missing, M
- **Others:** T3 `html-renders.md`: the agent writes a self-contained HTML page (chart, table,
  mockup) shown above its reply in a sandboxed frame that follows the theme. ADR 0058 lists it as
  left for later.
- **For Hiveory:** an agent tool (`show_html`) on the existing Hiveory MCP server; render in a
  sandboxed `<iframe srcdoc>` with no Node access.

### 2.9 Composer extras — Missing, S each
- **Prompt stash** (T3): Ctrl+S saves the draft and attachments; Ctrl+S in an empty box restores.
- **Suggested next prompt** (Claude desktop, T3 Labs, Codex "Composer predictions"): gray text,
  Tab accepts. Costs one small request per turn; should be opt-in.
- **Quote with a comment** (T3 "Cite in composer"): Hiveory has Quote; T3 adds a comment on the
  quote and jumps back to the source when clicked.
- **Context chips** (T3): `#` picks a pull request, `@` another agent's conversation (read on
  demand), `@opus` names a model for delegation.
- **`/goal`** (T3, Codex app "Set a goal to keep pursuing"): pass-through of the CLI's own goal
  command, with a goal line above the box.
- **Send key choice** Enter vs Ctrl+Enter (Paseo, Codex app).
- **Long-press / Ctrl+click Send** to choose queue vs send now (Paseo, T3).

### 2.10 Chat ↔ terminal for the same conversation — Missing, M
- **Others:** Orca "Continue in Chat UI" on a terminal agent and "Continue with Terminal Agent" on
  a chat; shortcut to switch (Ctrl+Shift+F11 on Windows). Session history offers "Resume in New
  Chat" and "Resume in New Terminal".
- **Hiveory today:** Chat UI is its own entry (ADR 0059); the Sessions tab resumes only.
- **For Hiveory:** both views use the same CLI session id, so the other view resumes it
  (`--resume <id>`); Needs decision on whether this fits ADR 0059.

### 2.11 Context and limits — Deepen, S–M
- `/compact` pass-through and a **Compact** chip when a big conversation's cache has expired
  (T3 `providers-claude.md`).
- `/clear` starting a new session in the same chat with a "New session" marker (T3).
- **Restart agent session** after skills or MCP servers change (T3).
- **Usage limit reached:** a "Limited" state, **Resume at reset** (a one-off schedule at the
  reset time) and **Retry** (T3). Hiveory's Schedules engine can run the one-off continuation.

### 2.12 Background work above the box — Missing, M
- **Others:** Paseo 0.16 shows an agent's background shells and monitors above the composer with
  Stop for each (Claude, Codex, OpenCode). Claude desktop has a Background tasks pane.
- **Hiveory today:** pills for tasks, subagents and changes (ADR 0058), not background shells.

---

## 3. Review, Git and pull requests

### 3.1 Line comments on diffs → agent — Missing, M, Needs ADR
- **Others:** Orca "Annotate AI Diff": + in the gutter (or `c`), Markdown note, Ctrl+Enter
  saves, comments follow the line across edits, **Send to agent** opens a menu of the worktree's
  agents or a new one, Resolve collapses a thread. Claude desktop: + by the line number,
  Ctrl+Enter sends all. Codex app diff pane inline comments. Paseo "Send feedback" in the diff
  pane. Superset sends selected PR diff lines to an agent. Vibe Kanban inline comments.
- **Hiveory today:** the browser has Annotate with a send menu (`AnnotationBatch.tsx`); diffs
  have no comments.
- **For Hiveory:** reuse the annotation batch and its send menu on `DiffView`/`ReviewPane`; the
  batch becomes one message with `file:line` anchors, delivered with the existing
  `send_message` path.

### 3.2 Stage, unstage, revert per file and per hunk — Missing, M
- **Others:** Codex app "stage or revert individual chunks, stage or revert entire files". Orca
  Source Control panel with a primary button that moves Stage → Commit → Push/Pull/Sync.
  CodexMonitor staged/unstaged diffs with revert/stage.
- **Hiveory today:** commit everything, push, discard one file (ADR 0060).
- **For Hiveory:** `git apply --cached` with a one-hunk patch for staging, `git apply -R` for
  revert; Staged and Unstaged groups in the Changes tab.

### 3.3 More Git actions — Missing, S–M
- Pull, Sync, **Force push with lease** shown only after a rewrite, **Amend** (confirm when
  pushed), **Abort merge / rebase** (Orca `commit-push.mdx`).
- **Conflicts:** list conflicted files after a merge/rebase, **Review conflicts**, **Resolve with
  AI** (hand the conflict set to an agent) (Orca).
- **Compare against** any branch or commit (Claude desktop, Paseo "Change base", Orca). Hiveory's
  Branch source is fixed to the worktree's base (`useChangeSource.ts:39`).
- **Fix with AI** when a commit hook fails: start an agent with the hook output and staged files
  (Orca).
- **Auto-pull** the default branch when it can fast-forward and has no local changes (T3).

### 3.4 AI-written commit messages, PR titles and descriptions — Missing, M, Needs decision
- **Others:** Orca "Generate with AI" with per-repo **action recipes** (agent, CLI args, prompt
  template with `{stagedPatch}`, `{branch}`, `{linkedIssue}`). T3 text-generation model setting
  (also branch names and titles), "Repository conventions" mode. Paseo model setting for
  generated titles, branch names, commits and PR drafts. Vibe Kanban AI PR descriptions.
- **Needs decision:** rule 27 says a model call Hiveory makes itself never sees files. A diff is
  file content. Either amend rule 27, or run it as the user's own agent in the worktree (as
  Orca's recipes do: the action picks an agent and its CLI), which is the user's own agent call.

### 3.5 Create pull request dialog — Deepen, S
- **Others:** Orca and Codex app confirm base branch, title, description and draft before
  creating; Orca can stack the PR on another open PR.
- **Hiveory today:** `gh pr create --fill` / `glab mr create --fill` with no form
  (`github-service.ts:77`).

### 3.6 Pull request tab — Deepen, M–L
- **Others:** description; conversation and review threads with reply and reactions (Orca);
  changed files with **Mark as viewed** synced with GitHub (T3, Codex app); request reviewers,
  edit title/body, close/reopen, ready for review (T3, Orca); Submit review with Comment / Approve
  / Request changes (Codex app); GitLab child-pipeline jobs and inline job logs (Orca).
- **Hiveory today:** title, state, author, review decision, checks with log links, Merge
  (`GH_PR_FIELDS` in `pull-request-detail.ts:9`).

### 3.7 Hand failures and comments to an agent; watch a PR — Missing, M
- **Others:** Orca **Fix broken checks**; Codex app **Fix in Checks** (attaches failing checks to
  the draft, not sent); Paseo "Attach pull request comments, reviews, threads and failed check
  logs to chat". Claude desktop **Auto-fix** watches CI and new review comments and pushes fixes.
  T3 `watch_pull_request`: the server checks every two minutes and wakes the agent on a failed
  check or new review.
- **For Hiveory:** an "Attach to chat" action per check/comment; a watch that polls
  `gh pr view --json statusCheckRollup` and messages the worktree's agent through the agent
  tools.

### 3.8 Merge when ready — Missing, S
- `gh pr merge --auto --squash` (or the repository's method), disabled for drafts and conflicts;
  Disable auto-merge (Orca, Claude desktop, T3).

### 3.9 After merge — Missing, S
- Remove a worktree after its PR merges or closes, as a setting (Claude desktop "Auto-archive
  after PR merge or close", Paseo, T3 cleanup policies). Strip agent `Co-Authored-By` lines on
  squash merge (T3, off by default).

### 3.10 Review the code before committing — Missing, M
- **Others:** Codex `/review` (base branch or uncommitted), Claude desktop `/code-review` with a
  findings card: **Walk through in diff**, **Fix this one**, **Apply fixes**.
- **For Hiveory:** a Review action that opens an agent with a review prompt; findings rendered
  in the review pane at their lines.

### 3.11 Diff viewer details — Deepen, S–M
- Image diffs: side-by-side, swipe, onion-skin (Orca). Diff word wrap toggle; F7 / Shift+F7 next
  change; HTML file **Open preview to the side** (Orca).
- Load the file tree first and diffs in batches for large changes (Paseo 0.16).

---

## 4. Worktrees

### 4.1 Setup script on create — Missing, S, Needs ADR
- **Others:** Codex app local environments (per-OS setup scripts in `.codex`), Orca Settings ›
  Repository › Hooks and `orca.yaml`, Paseo `worktree.create.after`, Superset
  `V2_WORKSPACE_SETUP_SCRIPTS.md`, Emdash.
- **For Hiveory:** a "Run when a worktree is created" flag on an existing Workspace script
  (ADR 0061), run as a terminal tab before agents start.

### 4.2 Copy git-ignored files into new worktrees — Missing, S
- **Others:** `.worktreeinclude` at the repo root, literal paths or gitignore patterns, copied
  not linked (Codex app, Claude desktop, Orca, Paseo). Orca also links big rebuildable folders
  (`node_modules`) via `worktree.sharedDirectories`. Already #4 in `research-ade-landscape.md`.

### 4.3 Worktree location — Missing, S
- Where new worktrees go, per computer (Claude desktop, T3, Paseo "Choose where new worktrees
  are created").

### 4.4 Create from a pull request — Missing, S
- Check out a PR's head branch into a new worktree (Orca, T3 `pr=` links). Hiveory creates from
  issues and remote branches.

### 4.5 Move work between Primary and a worktree — Missing, M
- Codex app **Hand off**: moves a chat and its uncommitted work from the worktree to the local
  checkout and back, doing the Git steps (branches can only be checked out in one place).

### 4.6 Storage and cleanup — Missing, M
- Orca Resource Manager › Clean up workspaces: every worktree with size, last activity, Git state
  and linked PR; bulk remove; a **Review N branches** step for branches Git kept because of
  unmerged commits. T3 cleanup rules (after N idle days, after merge) with **Delete now** and
  results.

### 4.7 Agent hibernation — Missing, M
- Orca: an agent that finished, is not on screen, got no keys and has a resumable session is
  stopped after an idle window (default 30 min, 1 min–24 h) and resumed with its `--resume` flags
  when its tab is shown again. Hiveory already resumes agents after reboot (ADR 0014); the same
  resume path applies.

### 4.8 One prompt to several CLIs, each in its own worktree — Deepen, M
- T3: Shift+click several models, one prompt starts one worktree each. Orca orchestration fans
  work out. Hiveory's Also ask runs side by side in the same worktree (text only); "Create with
  N" starts agents without a shared prompt. Already #2 in `research-ade-landscape.md`.

### 4.9 Progress while a worktree is created — Deepen, S
- Orca closes the dialog at once and shows a progress row in the sidebar while `git fetch` and
  `git worktree add` run.

### 4.10 Status line set by agents — Missing, S, Needs decision
- Orca "worktree comment": a one-line status agents update from the CLI ("reproduced bug;
  testing fix"), shown on the card. Hiveory would add an agent tool; check against rule 10 (no
  separate Task entity) — it is a field on the worktree, not a task.

---

## 5. Terminal, editor and files

| Feature | Kind | Effort | Who | Notes for Hiveory |
|---|---|---|---|---|
| Find in scrollback (Ctrl+F, regex, case) | Missing | S | Orca, Paseo | `@xterm/addon-search`; no search addon today |
| Quick open files (Ctrl+P, filename first, ignored files second) | Missing | S | Paseo, Orca, Codex app | Find has no file search (`usePaletteItems.ts`); file list via `git ls-files` |
| Find in files (Ctrl+Shift+F, "Find in folder") | Missing | M | Orca | `git grep` on the worktree's host |
| Markdown rendered preview / rich editor | Missing | M | Orca, T3 | Editor pane is CodeMirror only; Hiveory's `Markdown` renderer can be reused for a Preview toggle |
| Image, PDF, CSV/TSV table, Mermaid `.mmd`, HTML preview | Missing | S–M | Orca, T3, Claude desktop | PDF and HTML can open in the existing browser pane |
| Copy terminal context / Select all output | Missing | S | Orca, T3 | |
| OSC 52 clipboard writes (tmux, Neovim over SSH) | Missing | S | Orca | xterm OSC handler |
| Floating terminal on a global chord | Missing | S–M | Orca | |
| WSL as a terminal choice | Missing | S | Orca | `wsl.exe --status` detection |
| Editor word wrap, minimap, autosave toggle, final newline | Deepen | S | Orca, Claude desktop | |
| Drag files from Explorer / Changes into the chat box | Missing | S | Paseo, Orca | |
| Drop OS files into the Explorer to copy them in | Missing | S | Orca | |
| Git status colors and Copy relative path in Explorer | Deepen | S | Orca | |
| Link routing setting (browser pane vs system browser) | Missing | S | Orca, Claude desktop | Ctrl+click always opens the pane today |

---

## 6. Browser pane

- **Dev servers** — Missing, M. Claude desktop's Browser pane has a Dev servers menu (start,
  stop, stop all) from `.claude/launch.json`; Superset detects ports per workspace; T3 lists the
  servers a conversation's terminals started, with Stop. Hiveory lists ports only for remote
  workspaces (`ports.list`, ADR 0025). For local worktrees: find listening ports owned by the
  worktree's terminal processes and offer Open in browser pane / Stop.
- **Small items** — Missing, S (Orca `browser/overview.mdx`): find in page, reopen closed tab,
  hard reload, downloads shelf (cancel, open, show in folder), `target=_blank` opening as a new
  tab in the same pane.

---

## 7. Attention and notifications

- **Unread per agent** — Missing, S. Codex app "Mark chat as unread", "Clear all unread"
  (Shift+Esc), "Next chat needing attention" (⌘⌥A). Orca "Mark unread", unread worktrees in bold.
  Paseo Mark as unread. Hiveory has the "New output" ring for terminal tabs only.
- **Notification sound** — Missing, S. Orca custom sound per category with volume; Superset
  completion chimes; CodexMonitor sound notifications. Hiveory alerts are silent; Settings has no
  sound option.
- **Keyboard shortcut overlay** — Missing, S. Ctrl+/ in Claude desktop and Codex app. Hiveory has
  Settings › Keyboard only.

---

## 8. Accounts and usage

- **Several accounts per CLI** — Missing, M, Needs ADR. Orca Settings › AI Provider Accounts:
  each Codex account in its own `CODEX_HOME`, Claude via `CLAUDE_CONFIG_DIR`, switch in one
  click; running terminals keep their account. T3 per-instance config folders. Hiveory already
  passes those variables through (`claude.ts:55`, `codex.ts:15`).
- **Estimated cost** — Deepen, S. T3 Usage: cost by model and token type, custom model prices,
  "Map to" another model. Orca Stats estimated cost. Hiveory's usage page is counts only
  (ADR 0060), so this Needs decision.
- **Limits** — Deepen, S. Orca: one popover with every CLI's windows, tightest first, warning at
  80%, Detailed/Compact. Paseo: pinned windows in the sidebar footer, exact reset times. Hiveory
  shows limits per chat in the usage limits button (ADR 0055).

---

## 9. Agent settings

- **Launch arguments and environment variables per CLI** — Missing, S. Orca Settings › Agents ›
  launch arguments with Reset; T3 per-instance env and launch args; Paseo
  `agents.providers.<id>.options`.
- **Custom instructions for every agent** — Missing, S. Paseo "custom system prompt that applies
  to every agent you start" (Claude `--append-system-prompt`). Must not carry personal data
  (rule 27).
- **Agent profiles** (CLI + model + effort + mode, one click) — Missing, S, Needs decision.
  Paseo host-wide agent profiles. Rule 14 limits presets to CLI counts and YOLO, so this would be
  a separate thing from presets.

---

## 10. Window and layout

- **Pop a pane out into its own window**, optionally always on top — Missing, M (Claude desktop,
  Codex app, Paseo multiple windows).
- **Undo** for closing a worktree tab, removing an agent or a workspace, with a toast and Ctrl+Z
  — Missing, S–M (Paseo "Undo workspace archive", T3, Codex app "Undo last app action").
- **Ctrl+Tab to the most recent tab**, next/previous tab of the same type — Missing, S (Orca).
- **UI font, UI text size, code text size, chat content width** — Missing, S (Paseo, Codex app).
  Hiveory sets only the terminal font.

---

## 11. Voice dictation — Missing, M–L, Needs ADR

- **Others:** Orca shortcut dictation into the prompt or terminal; Paseo local models (Parakeet,
  Whisper, SenseVoice) downloaded in Voice settings; T3 transcription on a chosen environment
  with a dictionary and optional cleanup; CodexMonitor hold-to-talk Whisper with a waveform.
  ADR 0058 lists it as left for later.
- **For Hiveory:** Chromium's Web Speech API does not work in Electron, so transcription has to be
  a local model (whisper.cpp binary or a WASM build) run by main or the terminal host. Audio stays
  on the computer.

---

## 12. Schedules

- **Same conversation each run** — Missing, S–M. T3 task destination: a new thread per run, or
  one thread continued (same conversation or fresh session). Hiveory starts a new agent per run.
- **Webhook trigger** — Missing, M, Needs decision. T3 "On webhook" with placeholders
  (`{{body.path}}`), GitHub signature check, filters, duplicate key and coalescing. A webhook
  needs an address the sender can reach; Hiveory listens on loopback, Tailscale or LAN only.
- **Event triggers by polling** (PR opened, check failed) — Missing, M. Superset automations "on
  an event". Can poll `gh` from the schedule runner, no public address needed.

---

## 13. Smaller items worth noting

- **Secret request card** (T3 `secrets.md`): an agent asks for a token in a private card; the
  value goes to the tool, never into the conversation. Fits rule 27. M.
- **Session history details** (Orca `session-history.mdx`): Copy resume command, Open / Reveal
  log, first prompt in full with Copy, filter by CLI, group by CLI or folder, sort by created,
  hide empty sessions. Hiveory has Resume and Copy session ID. S.
- **Restart chip** on an agent pane when its CLI exits (Orca). Hiveory restarts from the pane's
  right-click menu. S.
- **MCP Apps** rendered below a tool call (T3, Codex and Claude support it). L.
- **AI line attribution** in diffs (Orca): mark lines an agent wrote. L.
- **Interface languages** (Paseo ships six). L.

---

## 14. Seen in the others, but they clash with Hiveory's rules or decisions

- **Done column / review board with history** (Orca Agent Dashboard, T3 Settled/Snoozed
  shelves, Orca Agents activity feed) — rule 9 (no Done column, no history) and rule 7.
- **First-run welcome that imports projects from CLI history** (Paseo, T3) — ADR 0042 amendment
  (2026-10-26) removed the first-run welcome.
- **Thread sidebar with pin / reorder / snooze per conversation** (T3, Codex app) — Hiveory's unit
  is the Worktree (rule 10).
- **Cloud VMs, hosted relays, public artifact links, Hub** (Orca cloud, T3 Connect, Paseo relay,
  Superset cloud workspaces, Orca "Share as artifact") — need a hosted service; Hiveory is
  self-hosted only.
- **Third-party plugin system** (Paseo, Orca) — large, and a new trust boundary; not an easy add.
- **Chat as a separate mode** (Codex app Chat / Work / Codex switch) — ADR 0056 removed modes.

## Sources

- Paseo: <https://github.com/getpaseo/paseo> (`CHANGELOG.md`, `docs/`)
- Orca: <https://github.com/stablyai/orca> (`docs/site/content/docs/`)
- T3 Code: <https://github.com/pingdotgg/t3code> (`docs/user/`)
- Emdash: <https://github.com/generalaction/emdash>
- Superset / Paradev: <https://github.com/superset-sh/superset>
- Vibe Kanban: <https://github.com/BloopAI/vibe-kanban>
- CodexMonitor: <https://github.com/Dimillian/CodexMonitor>
- Claude desktop Code tab: <https://code.claude.com/docs/en/desktop>
- Codex app: <https://developers.openai.com/codex/app/commands>, `/settings`, `/review`,
  `/local-environments`, `/worktrees`
