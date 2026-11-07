# Product Specification

## Product Shape

One mode: Work (ADR 0056; Bots and Chat, ADR 0012 and 0022, are removed). There is no mode switch and
no title bar: the sidebar (Workspaces), the open Worktree and its side panel all start at the top of
the window, and the window's buttons (sidebar, Settings) live in the sidebar, or
in its icon rail while it is hidden; the side panel's button sits at the top right.

Everything the removed modes did, Work does: an agent runs in a terminal or a **chat view** (the same
message box: attachments, model and effort, queued next messages, the usage limits button, ADR 0031,
0055), with apps, the browser and computer use. **Schedules** (ADR 0028, 0040) start a new agent of a
CLI in a Worktree with the schedule's instructions, once, every few minutes or on a calendar rule in
a timezone; its card moves on the Kanban by its real state. They are made and listed in the side
panel's Schedules tab (or a worktree's "New schedule…"), by day, week, list or run log. They run while
Hiveory (or the user's Hiveory server) is running; a run missed by less than 12 hours still happens
when it is back, and every run is kept in a run log. A run that ends or is missed while the user is
elsewhere shows a desktop notification.

## Workspace Lifecycle

Add workspace (ADR 0020) is one dialog: a name, Local (Remote is listed but not available yet), and
Pick directory · New repository (optionally also on GitHub) · Clone repository.
Removing a workspace archives it: adding the folder again brings back its worktrees and agents.

Worktrees follow Git (ADR 0038):
- A workspace always has its Primary worktree (its own folder).
- Every linked worktree Git knows for the repository appears in it, wherever its folder is, at
  startup, when Hiveory comes back to the front and every half minute. A folder is never shown twice:
  adding a folder inside a linked worktree opens the repository's workspace instead.
- A worktree whose folder was deleted outside Hiveory is removed with its agents (a notice says so).
- A workspace whose folder is gone stays in the sidebar, marked missing, until the user removes it.
- Removing the Primary removes the workspace.

```text
Open/Create Workspace
        │
        ▼
  Its last Worktree (Primary at first)
        │
        └── Side panel › Dashboard (ADR 0038, 0039)
                ├── Tasks / Kanban (All | Here)
                ├── Worktrees (and their pull / merge requests)
                ├── Issues
                ├── Schedules
                └── Settings
```

Opening a Workspace creates no new worktree, branch or agent; it shows the Primary and the
worktrees Git already has.

The Workspaces sidebar's "Recent activity" order moves a workspace up only for real work there:
an agent starting a turn, an agent opening, a worktree being created (ADR 0024). Clicking a
workspace to look at it does not move it.

## Worktree Lifecycle

```text
Workspace
   │
   ├── Primary Worktree
   │
   └── Create Worktree
          │
          ├── Create empty
          │
          └── Configure CLIs
                   │
                   ▼
              Worktree
```

## Empty Worktree

```text
Worktree exists
      │
      └── zero CLI instances
              │
              ├── Open agent
              └── Load preset
```

## Worktree Creation Configuration

The configuration surface supports:

```text
Worktree name
Issue / PR association
CLI selection
Add all CLIs
CLI instance count
Skip permissions (YOLO)
Preset
Create empty Worktree
```

Settings › Agents › Skip permissions (YOLO) is global (ADR 0049): while it is on, every agent
starts with permissions skipped (YOLO) in every Workspace and Worktree, the Primary included,
whatever the Worktree or preset chose. While it is off, the Worktree's or preset's own choice applies.

## CLI Configuration

Example:

```text
Claude Code       [-] 2 [+]
Codex             [-] 1 [+]
Gemini            [-] 1 [+]
```

Launching the Worktree starts the requested number of independent instances.

If count = 2:

```text
Claude logo   Milo
Claude logo   Luna
```

## Workspace Kanban

The Workspace Tasks view is:

```text
┌──────────────────────────────────────────────────────────────┐
│ Idle             │ Working          │ Needs You             │
├──────────────────┼──────────────────┼───────────────────────┤
│ Worktree 1       │ Worktree 2       │ Worktree 1            │
│ [CLI logo] Milo  │ [CLI logo] Luna  │ [CLI logo] Kai        │
│                  │                  │                       │
│ Worktree 3       │ Worktree 1       │ Worktree 4            │
│ [CLI logo] Ruby  │ [CLI logo] Max   │ [CLI logo] Nova       │
└──────────────────┴──────────────────┴───────────────────────┘
```

Every card represents a real CLI instance.

Each running card also shows the model the agent is using right now (live: it follows
`/model`), read from the agent's own session file (Claude Code, Codex; ADR 0020).

Cards move automatically based on runtime state.

## Needs You

Examples:

```text
Needs your permission
Needs your answer
Needs you to confirm
```

These appear as card details.

## No Done Column

Completion means:

```text
Working → Idle
```

There is no history board.

## Worktree Pane Behavior

Each CLI has a pane.

Panes:

- have visible gutters
- can split right
- can split bottom
- can be rearranged
- can be swapped using Space-drag
- Focus arrangement: the dragged pane takes half; the rest share the other half, stacked
  up to four in a column, in side-by-side columns of up to four beyond that (5 → 3 + 2,
  8 → 4 + 4, 9 → 3 + 3 + 3)

## Pane Add

The pane header has `+`.

It opens:

```text
Placement:  Right | Bottom   (one line)
Search
Terminals
├── PowerShell / Command Prompt / Git Bash (when installed)
Agents
├── detected CLI
└── ...
```

## Preset Behavior

Presets store:

```text
CLI counts
Skip permissions (YOLO)
```

Presets do not store layout.

Selecting a preset replaces the current CLI configuration when the Worktree is in the appropriate empty/configuration state.

## Primary Worktree

Primary Worktree:

- exists as soon as the Workspace is added; it is not offered in Create worktree (ADR 0038)
- one checkout hosts one worktree app-wide: if two workspaces share a repository (root and subfolder, or a linked worktree opened as a workspace), only one of them can have the Primary worktree (ADR 0021)
- maps to the original workspace folder
- is never deleted from disk; removing it removes the whole Workspace from Hiveory (archived, folder untouched; ADR 0038)
- can run CLI instances
- participates in the same Kanban as isolated Worktrees

## Isolated Worktree

Isolated Worktree:

- uses a linked worktree
- uses a local branch
- can run multiple CLI instances
- can be deleted according to worktree lifecycle rules

## Built-in Browser

The browser is a real browser (ADR 0015), opened as a pane among the agents from a pane's "+" › Browser (ADR 0042); pages an agent opens appear as panes of its worktree:

- toolbar: back, forward, reload, address bar (bare hosts and searches work), pick element, annotate element, viewport sizes, developer tools, and a menu with profiles, cookie import/export/clear and Browser settings
- agents drive it through `browser_*` MCP tools with a visible cursor; it is on by default and works while the panel is closed
- pages an agent opens appear as a tab in that agent's area, named after it (ADR 0043)
- profiles keep separate cookies and logins; viewports emulate phones, tablets and desktops
- Settings › Browser: browser use, agent cursor, home page, default profile, profiles, custom viewport sizes
- device mode: a toolbar above the page with 22 devices, editable width × height, pixel ratio, rotate and drag handles (ADR 0016); agents use the same
- "is using this page" shows only while an agent is acting

## Computer Use

Off by default (Settings › Agents). When on, agents operate this computer through `computer_*` tools: app elements as text with refs, real mouse and keyboard, windows and screenshots (Windows for now; ADR 0016).

## Apps, MCP servers and skills

Settings › Skills, MCPs & Apps has three tabs (ADR 0017, 0023):

- **Skills** — every Agent Skill across the skills folders, with the CLIs that load it; light a folder to copy the skill there; create a skill or import a skill folder; remove a copy (to the trash). The folders come from the CLI registry: the shared `.agents/skills` plus each CLI's own (Claude, Codex, Gemini, Copilot, Cursor, OpenCode, Qwen, Goose, Kiro, Droid, Kilo, Junie and more); chips show the folders an installed CLI reads (ADR 0020) **skills.sh** (ADR 0041): search the open skills directory, read a skill's security audits, and install it into the folders that reach every installed CLI (preselected)
- **MCP servers** — servers Hiveory runs for every agent (add by command or URL, with env vars/headers) and the servers each CLI configures, which can be added to every agent in one click. **MCP Registry** (ADR 0041): search the official registry and add a server (npx, uvx, Docker or hosted, filling in the values it needs) so every agent gets it
- **Apps** — paste the user's own Composio project API key once (free or paid). On any app card (Gmail, Google Drive, Slack, GitHub, Notion, Linear, Stripe…), Connect — or Add account for another one — first asks for the account's name (work, personal…), then goes straight to that app's sign-in: no Composio login, no app keys. Each account lists its name, id and status with Disconnect. Every app shows its real brand mark. Every agent — terminal, chat and bots — gets the connected apps, and can connect any of Composio's 1,000+ apps on request (ADR 0023)

## Code hosts and issue trackers (ADR 0040)

Settings › Integrations shows the code hosts this computer is signed in to (GitHub through `gh`,
GitLab through `glab`; no tokens kept) and connects Jira Cloud (site, email, API token) and Linear
(API key). Keys are checked before they are kept, stay encrypted on this computer and go only to
that service. Each Workspace picks its code host (Automatic from the origin address, GitHub, GitLab
or Off) and where its issues come from (the code host, a Jira project, a Linear team or nowhere).
Its Dashboard shows each worktree's pull or merge request, Create PR/MR for any branch but the
default one, every open one, and the open issues, where Start worktree makes a worktree named after
the issue.

## Keyboard (ADR 0047)

- Settings › Keyboard (ADR 0047) lists every shortcut with its platform's standard keys (⌘ on macOS,
  Ctrl on Windows and Linux, never the Windows/Super key): Settings, the sidebar, the side
  panel, Schedules, worktrees, panes and tabs. Each can be changed, removed or reset; fixed terminal,
  editor and pane keys are listed read-only.

## Agents that know Hiveory (ADR 0041)

Every agent can call `hiveory_about`: what Hiveory is and where everything lives, where
it runs (worktree, workspace, branch), which Hiveory tools and settings apply, and what MCP servers and
apps it has.

## Appearance

Appearance is in sections, one at a time: Theme, Background, Terminal font (ADR 0043, 0044). Panes are always tabs (each area holds several panes as tabs, like a browser) with air and rounded corners between sidebars, panes and panels; there is no setting for it and no first-run welcome (ADR 0042 amendment 2026-10-26).

Three flat themes (Dark, Bronze, Silver), with VS Code themes right under them in the same Theme section (ADR 0044). A background wallpaper (any image the user adds) with transparency (0–100%, applied to every surface), blur and dim. Dragging a sidebar past its minimum width hides it (ADR 0017, 0018).

VS Code color themes (ADR 0034): search the Open VSX catalog, install, apply. A VS Code theme recolors every panel, the terminals, the editor and the window chrome; the wallpaper, transparency, blur and dim still apply on top. Choosing a built-in theme switches back.

## Terminals, Explorer and editor panes (ADR 0018)

- A pane's "+" opens terminals (PowerShell, Command Prompt, Git Bash) or agents, with search; Right and Bottom side by side; Terminal and Chat side by side, starting from the Workspace's "New agents open as" setting (ADR 0037)
- Terminal panes are not agents: no Kanban card
- The side panel exists only in worktrees (never Home, Chat or Settings; ADR 0021). It starts with the Dashboard (the Workspace page; ADR 0038, 0039), Sessions and the Explorer, and "+" adds the Workspace's Schedules and Settings (ADR 0042). The Explorer: file tree with search, new file/folder, rename, cut/copy/paste, delete (to trash), copy path
- Double-clicking a file opens it as an editable pane (Ctrl+S saves); it reloads when an agent changes it on disk

## Side panel areas and Sessions (ADR 0020)

- Tabs drag to reorder. Dragging a tab into the panel's lower half splits the panel into a top
  and a bottom area, each with its own tabs and "+"; a divider sets their heights. Keyboard:
  Ctrl+Shift+← → reorders, Ctrl+Shift+↓ ↑ moves a tab between the areas.
- **Sessions** tab: every Claude Code, Codex and Gemini CLI conversation on this computer, read
  from the CLIs' own history (so it survives restarts and reboots). A Workspace on an SSH host lists
  that host's sessions; All adds every connected host's (ADR 0043). Worktree · Workspace · All,
  search, grouped by folder, newest first; title, last words, CLI, time and model. A session
  that ran in one of the workspace's worktrees resumes there as a new agent pane.

## Remote hosts (ADR 0022)

- Add workspace › Remote (SSH): an SSH host and a folder there (typed, or browsed). The host is
  picked from the user's Tailscale devices and ~/.ssh/config hosts, or typed (ADR 0026). The
  workspace's files, git, worktrees and agents all stay on that machine; its sidebar row and page
  show the host with a live link dot. Agent menus list the CLIs installed on that machine. Remote
  worktrees use terminal view.
- When ssh needs a password, key passphrase, one-time code or the OK for a new host's fingerprint,
  Hiveory asks in a dialog. Passwords are kept in memory until quit, never on disk; a changed host
  key is always refused. A machine without Node 20+ gets Hiveory's own (checksum-pinned) Node.
- Losing the connection keeps that machine's agents running there: Hiveory reconnects on its own
  for 5 minutes and the same terminals continue with what they printed meanwhile. Only after that
  do they stop (with a notice); opening them again reconnects.
- A remote workspace's Ports button lists what listens on that machine and forwards a port to this
  computer (same number when free) and opens it in the browser.
- Hiveory can run as a server (`hiveory --serve 7788`, no window, loopback only by default) so agents
  keep working while this computer is off. Settings › Remote › Use a Hiveory server pairs
  this window with it (SSH tunnel or an address, plus the one-time code it printed); Hiveory then
  restarts as that server's window. The server's dialogs, screen and installer are never reachable
  from a client. Disconnect returns to local mode.
- With Tailscale (ADR 0025), Settings › Remote › Your devices lists the user's tailnet devices.
  Devices sharing Hiveory show Connect. It takes one click on the user's own Tailscale login, and
  the sharing computer's code otherwise. Other online devices show Use over SSH. "Share this
  computer" (off by default) serves this desktop to them on its Tailscale address only, shows its
  pairing code and paired devices, and removing a device cuts it off at once. A headless server
  does the same with `hiveory --serve 7788 --tailscale`, and `--lan` on the local network.
- Without Tailscale (ADR 0052): a computer sharing "On this network" is listed on the other
  computers of the same Wi-Fi under Your devices › On this network, and connects with its pairing
  code. A paired computer or phone keeps every address of the computer it paired with (Tailscale
  name and IP, Wi-Fi) and uses whichever answers, so turning Tailscale off at home, or leaving the
  Wi-Fi, keeps it connected while one way is still there. A paired computer can do everything that
  runs on the server, including skills.

- Settings › Remote checks an SSH host (an alias from ~/.ssh/config or user@host) end to end and
  installs Hiveory's small host program in `~/.hiveory-host` there (with its own Node if needed).
- Hiveory uses the user's own SSH setup, never prompts for or stores passwords, and never accepts
  a host key on its own.
- Agent and shell terminals on this computer run in a separate host process; if it crashes,
  Hiveory keeps running, the affected terminals show as ended, and the next one starts a new host.

## Phone app (ADR 0027)

- Hiveory for phones (`mobile/`) uses the user's own computer over their own Tailscale network
  or the same Wi-Fi (ADR 0052); no Hiveory server sits in between. Pairing: scan "Connect your
  phone" (Settings › Remote › Share this computer), open its `hiveory://pair` link, or type the
  computer's Tailscale name or Wi-Fi address. Same Tailscale account = no code. The code carries
  every address of the computer, and the phone uses whichever answers.
- A phone does what a paired desktop does in Work (ADR 0053, 0056): Workspaces (add by path or
  clone, set up Git, remove), worktrees (create, repair, delete, save their agents as a preset),
  agents (open, rename, restart, close, type in terminals; in chat view, files with a message,
  messages lined up while it answers, saved prompts), files (browse, find, read, edit, new, rename,
  delete), pull requests and issues; Schedules (make, edit, run, delete, recent runs: each run opens
  a new agent of the picked CLI in the picked worktree); and the computer's SSH questions. App
  settings, accounts and keys, folder pickers, pane layout and the built-in browser stay on the
  computer (enforced by the server). Paired devices show as Phone or Desktop.
- Tabs: **Home** (agents that need you across workspaces, then those working; badge on the tab),
  **Work** (each Workspace with live counts; a Workspace's board one status at a time, most urgent
  first, its worktrees, each with its Files, and its Schedules), **Settings** (computers,
  notifications, theme, privacy). There are no Bots or Chat tabs (ADR 0056).
- An agent screen shows its terminal sized to the phone while it is open there (the computer's
  pane gets its own size back when the phone leaves it, ADR 0048), a bar that says why it waits
  with Esc and Enter, and the keys a phone lacks right above the keyboard, which never covers
  them: Esc, Tab, Ctrl and Alt (held for the next key), the arrows, / and Enter.
- Notifications (opt-in): "An agent needs you." through Expo push, at most once a minute per
  agent, plus "A schedule finished." / "A schedule needs a look." (ADR 0053); only ids travel.
  Tapping opens that agent, or the Schedules, on the right computer.
- The phone wears the theme picked on the computer.

## Running in the background (ADR 0020)

- Closing the window keeps Hiveory in the system tray and every agent keeps working (Settings ›
  Agents › "Keep agents running in the background", on by default). The tray reopens the window
  and shows how many agents run; "Quit Hiveory" stops them.
- Quitting leaves agents and terminals running in Hiveory's terminal host (Settings › Agents ›
  "Keep agents running when Hiveory quits", on by default, ADR 0050). When Hiveory opens again,
  each pane takes its terminal back, with what it printed meanwhile. The tray menu then offers
  "Quit Hiveory (agents keep running)" and "Quit and stop agents". With the setting off, quitting
  stops them.
- While the link to the terminal host is down, an agent says "Reconnecting to its terminal…" rather
  than ended; if the host is gone for good, its terminals end and Hiveory says so.
- Quitting with agents running says so in a notification ("3 agents keep running"). Updates keep
  them too: the terminal host runs from its own copy of the app.
- Settings › Agents › Terminal host shows where terminals run (in the background since when, how
  many, which version), "Keep them for" (until they finish, 1 hour, 1 day, 7 days; the same rule on
  remote machines) and Restart terminal host, which ends every terminal after a confirmation;
  agents then resume their conversations.
- Server mode (`--serve`) uses the same terminal host, so switching a computer between desktop and
  server keeps its terminals.
- Chat replies keep streaming too (chat-view agents, ADR 0051): a reply
  that was streaming when Hiveory quit carries on in the terminal host and is finished, rebuilt in
  full, when Hiveory opens again. Schedules and triggers fire only while Hiveory (or its server mode)
  runs; what they start then outlives it.
- After a reboot, or a quit that stopped them, every terminal agent comes back on start-up, resuming
  its own conversation (ADR 0014); the CLIs keep their history on disk, listed in the Sessions tab.

## Important Non-Features

Initial version does not include:

- free-form agent-to-agent chat (Work agents coordinate through agent tools)
- remote collaboration (planned as one host layer for Work, ADR 0022)
- global Kanban across workspaces
- task history in Work (Schedules keep a bounded run log, ADR 0028)
- Done Kanban column
- user-controlled manual Kanban status
- multiple user-facing Tasks inside a Worktree
