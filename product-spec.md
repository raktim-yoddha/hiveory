# Product Specification

## Product Modes

Exactly three, in this order (ADR 0012, ADR 0022):

```text
Workspace (Work)
Bots
Chatspace (Chat)
```

Bots (ADR 0022): a roster of global teammates. Each bot has a name, a brief, a default engine,
model and permission, and a memory it carries into every new conversation. Its conversations are
threads: tabs under the bot, each running on the chat engine in the bot's own folder, and they
keep running while the user is elsewhere. Bots are grouped into **teams** (General always exists;
ADR 0028), and each team has one **Chief of Staff**: the user's main contact for that team, who
hands work to its bots (their results come back into its thread and wake it) and consults them.
Chiefs reach General's Chief, so work crosses teams Chief to Chief. Bots that allow messaging may
consult each other in any team. Delegation is bounded (only Chiefs delegate, at most two levels
deep, 20 handoffs an hour per thread). The team map shows each team and the work bots are handing
each other; dragging a bot onto another team moves it there. The **work board** lists what the team owes: handoffs
and routine and trigger runs, as Working, Didn't finish or Done, by their real state; finished work
stays a day (Bots-only, capped history, ADR 0028). A bot **asks before acting in your apps** (ADR
0029): by default before it sends or posts as you, or before any change, or never, per bot; reading is
never asked. The request waits in its thread and on the work board for Allow or Decline, and is
declined after 15 minutes. A trigger's read-only run can't change or send anything in apps.
Routines can also run **without a bot** (ADR 0030): as a new chat in Chat mode ("Schedule a chat") or as
a new agent in a Work worktree (a worktree's "Schedule a routine…"), whose card then moves on the
Kanban by its real state like any agent.
While a chat or bot is answering, the user can type the **next message**: it waits above the box and
goes in when the reply ends (Stop drops it). **Saved prompts** (the bookmark in every message box) are
reusable text the user inserts, saves or removes (ADR 0031). Bots never appear on a
workspace's Kanban. A bot may have its own Linux computer (a sandboxed Docker desktop with a
terminal and Chromium, on this computer or on an SSH host): it works there with desktop tools,
and the user can take control from the bot panel. Each bot's **Works on** choice decides which
computers its threads may use: Auto (the browser, plus its Linux computer when one is set up;
never the user's screen), its Linux computer, this computer (the user's screen, chosen on purpose),
the browser only, or none. Settings' Browser use and Computer use still switch those off for every
agent. A bot's threads share one set of browser pages in the bot's own browser profile; the user
signs in to sites for it in the bot panel's Browser tab, never by putting a password in a chat.
A bot the user allows to run on a schedule can have **routines** (ADR 0028): instructions run in a
fresh thread once, every few minutes, or on a calendar rule in a chosen timezone. They run while
Hiveory (or the user's Hiveory server) is running; a run missed by less than 12 hours still happens
when it is back, and every run is kept in a run log. A bot can save routines for itself when asked
("send me this every morning"); they arrive paused until the user switches them on. When a run ends
or is missed while the user is elsewhere, a desktop notification opens its thread. Each bot's
Overview says in plain words what it does, what it can reach and what it won't do, shows the exact
prompt it starts from, and lists its own skills; notifications can be turned off per bot.
**Triggers** start a bot's work when something happens in a connected app (a new email, a GitHub
issue…): Composio delivers the event over a public link that Tailscale Funnel gives one random path of
this computer. Every event is signature-checked, and its run is read-only, treating the event as data,
never as orders.

Chat: pick a detected CLI (Antigravity excluded), then a model (searchable),
then an effort level when that model supports one. The CLI locks after the
first message. Chats keep running while the user is in Work.

## Workspace Lifecycle

Add workspace (ADR 0020) is one dialog: a name, Local (Remote is listed but not available yet), and
Pick directory · New repository (optionally also on GitHub) · Clone repository · Restore previous.
Removing a workspace archives it: adding the folder again, or Restore previous, brings back its
worktrees and agents. Worktree folders left on disk come back as worktrees.

```text
Open/Create Workspace
        │
        ▼
    Workspace Page
        │
        ├── Tasks / Kanban
        ├── Pull Requests
        ├── Worktrees
        └── Settings
```

Opening a Workspace does not create a Worktree.

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
Auto-approve permissions
Preset
Create empty Worktree
```

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
│ Idle             │ Working          │ Waiting for You       │
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

## Waiting for You

Examples:

```text
Waiting for permission
Waiting for input
Waiting for confirmation
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
Auto-approve
```

Presets do not store layout.

Selecting a preset replaces the current CLI configuration when the Worktree is in the appropriate empty/configuration state.

## Primary Worktree

Primary Worktree:

- is created by the user ("Create worktree" → "Workspace folder"), at most one per Workspace (ADR 0011)
- one checkout hosts one worktree app-wide: if two workspaces share a repository (root and subfolder, or a linked worktree opened as a workspace), only one of them can have the Primary worktree (ADR 0021)
- maps to the original workspace folder
- is never deleted from disk; it can be removed from Hiveory (agents close, folder untouched) and created again (ADR 0013)
- can run CLI instances
- participates in the same Kanban as isolated Worktrees

## Isolated Worktree

Isolated Worktree:

- uses a linked worktree
- uses a local branch
- can run multiple CLI instances
- can be deleted according to worktree lifecycle rules

## Built-in Browser

The side panel's Browser tab is a real browser (ADR 0015):

- toolbar: back, forward, reload, address bar (bare hosts and searches work), pick element, annotate element, viewport sizes, developer tools, and a menu with profiles, cookie import/export/clear and Browser settings
- agents drive it through `browser_*` MCP tools with a visible cursor; it is on by default and works while the panel is closed
- pages an agent opens appear as tabs in its worktree's side panel, named after the agent
- profiles keep separate cookies and logins; viewports emulate phones, tablets and desktops
- Settings › Browser: browser use, agent cursor, home page, default profile, profiles, custom viewport sizes
- device mode: a toolbar above the page with 22 devices, editable width × height, pixel ratio, rotate and drag handles (ADR 0016); agents use the same
- "is using this page" shows only while an agent is acting

## Computer Use

Off by default (Settings › Agents). When on, agents operate this computer through `computer_*` tools: app elements as text with refs, real mouse and keyboard, windows and screenshots (Windows for now; ADR 0016).

## Apps, MCP servers and skills

Settings › Skills, MCP & Apps has three tabs (ADR 0017, 0023):

- **Skills** — every Agent Skill across the skills folders, with the CLIs that load it; light a folder to copy the skill there; create a skill or import a skill folder; remove a copy (to the trash). The folders come from the CLI registry: the shared `.agents/skills` plus each CLI's own (Claude, Codex, Gemini, Copilot, Cursor, OpenCode, Qwen, Goose, Kiro, Droid, Kilo, Junie and more); chips show the folders an installed CLI reads (ADR 0020)
- **MCP servers** — servers Hiveory runs for every agent (add by command or URL, with env vars/headers) and the servers each CLI configures, which can be added to every agent in one click
- **Apps** — paste the user's own Composio project API key once (free or paid). On any app card (Gmail, Google Drive, Slack, GitHub, Notion, Linear, Stripe…), Connect — or Add account for another one — first asks for the account's name (work, personal…), then goes straight to that app's sign-in: no Composio login, no app keys. Each account lists its name, id and status with Disconnect. Every app shows its real brand mark. Every agent — terminal, chat and bots — gets the connected apps, and can connect any of Composio's 1,000+ apps on request (ADR 0023)

## Appearance

Six flat themes, three per row. A background wallpaper (any image the user adds) with transparency (0–100%, applied to every surface), blur and dim. Dragging a sidebar past its minimum width hides it (ADR 0017, 0018).

VS Code color themes (ADR 0034): search the Open VSX catalog, install, apply. A VS Code theme recolors every panel, the terminals, the editor and the window chrome; the wallpaper, transparency, blur and dim still apply on top. Choosing a built-in theme switches back.

## Terminals, Explorer and editor panes (ADR 0018)

- A pane's "+" opens terminals (PowerShell, Command Prompt, Git Bash) or agents, with search; Right and Bottom side by side; Terminal and Chat side by side, starting from the Workspace's "New agents open as" setting (ADR 0037)
- Terminal panes are not agents: no Kanban card
- The side panel exists only in worktrees (never Home, workspace pages, Chat or Settings; ADR 0021). It holds browsers and one Explorer per worktree: file tree with search, new file/folder, rename, cut/copy/paste, delete (to trash), copy path
- Double-clicking a file opens it as an editable pane (Ctrl+S saves); it reloads when an agent changes it on disk

## Side panel areas and Sessions (ADR 0020)

- Tabs drag to reorder. Dragging a tab into the panel's lower half splits the panel into a top
  and a bottom area, each with its own tabs and "+"; a divider sets their heights. Keyboard:
  Ctrl+Shift+← → reorders, Ctrl+Shift+↓ ↑ moves a tab between the areas.
- **Sessions** tab: every Claude Code, Codex and Gemini CLI conversation on this computer, read
  from the CLIs' own history (so it survives restarts and reboots). Worktree · Workspace · All,
  search, grouped by folder, newest first; title, last words, CLI, time and model. A session
  that ran in one of the workspace's worktrees resumes there as a new agent pane.

## Queen Bee (ADR 0019)

- A bar docked under the main area (Work, Chat and Settings), or floating: a fixed-size bar
  over the bottom of the window that never moves or resizes with the sidebars or side panel,
  always visible, taking no room.
- Floating has six modes: full or small (just her mark), at the left, middle or right. Hold her
  mark and drag to move the bar; it snaps to the third of the window it is let go in. Double-click
  the mark to shrink or open the bar; a single click on the small mark does nothing (Enter opens
  it, ← → move it; ⋯ also has Position and Shrink). Her shortcut opens a small bar. Her card keeps
  the full bar's width, lined up with the bar's side. The mode is remembered.
- Her shortcut (default Win+Alt, ⌘⌥ on macOS, any 2–3 keys in Settings) taps to focus
  her and holds to talk.
- Typed commands run app actions: open N agents of a CLI (optionally "in <worktree>"),
  close agents (always after a yes), restart, jump to an agent, load a preset, switch
  Work/Chat, open Home, a workspace, a worktree or a Settings section, show or hide the
  side panel, and open a browser or the Explorer. In Bots: open the work board, Routines,
  Triggers or the team map, and pause or resume a routine or trigger by its name ("pause
  Morning brief"; a model's plan asks first).
- Reports ("what's left?", "who's waiting?") list agents by status with wait times, from
  live state. The current workspace, or every workspace from Home.
- She asks instead of guessing (unknown or ambiguous names), runs nothing if any part of
  a command is unclear, and offers Undo for opens and navigation.
- Personalities Ada, Sunny, Frankie and a custom one change wording only. Settings › Queen Bee holds:
  - personality, what she calls you and how to say it aloud;
  - reply length;
  - per personality: Ada's honorific, Sunny's energy, Frankie's goal, intensity and nudge time;
  - a custom personality: her name (never an agent name), a style text and three sliders
    (formal↔casual, calm↔energetic, gentle↔direct);
  - her voice (any English Kokoro voice) and speed;
  - placement, and the system-wide shortcut (opt-in).
- Things she's learned: "remember that …" saves a note (shown as "Noted: …", undoable),
  "what do you know about me?" reads them back, "forget …" removes them. Notes are local,
  editable in Settings, and reach a model provider only as facts.
- "Tell <agent> to …" types your exact words into that agent and submits them.
- The rest of the app (ADR 0024):
  - settings on or off ("turn off browser use", "enable computer use");
  - a page in the side browser ("open localhost:3000"), a file in an editor
    ("open README.md");
  - the panes tidied ("tidy up the panes", "side by side");
  - the worktree's branch and changes ("what changed"), the workspace's open pull requests;
  - connected apps, a Hiveory update check;
  - the current agents saved as a preset ("save this as preset Backend");
  - a new chat with a CLI and a first message;
  - a message to a bot ("ask Scout to …");
  - a CLI's last conversation resumed;
  - a new workspace;
  - "restart all".
- Voice (Settings › Queen Bee › Voice): local speech packs downloaded on request and
  verified.
  - Parakeet for English, Spanish, Portuguese, German and French.
  - Whisper Turbo for Hindi/Hinglish.
  - Kokoro voices so she can answer out loud.
- Optional model (Settings › Queen Bee › Providers), with several accounts per provider
  tried in order and models listed from the provider: any OpenAI-compatible provider,
  Anthropic or Gemini (AI Studio key), or a local server. It handles only what the rules
  don't understand, can only choose Queen Bee's actions, and asks before closing or
  messaging agents. A Test button checks the key, the model and tool calling.
- Subscription providers: the user's own Codex CLI (ChatGPT plan) or Claude Code CLI
  (Claude plan), run headless with no tools; no key, slower (5–20 s).
- The shortcut can also work while another app is focused (opt-in): a tap brings Hiveory
  forward, a hold talks from anywhere.
- Talkback: she answers out loud by default (Kokoro, or the system voice without it), with
  short sound cues; "mute" and the ⋯ menu turn it off.
- Talk to agents by name: "codex run the tests", "Bruno, …", "everyone: …", "tell all
  claude to …", "open codex and send: …" (exact words, no model needed).
- "stop Bruno" interrupts without closing; "status of everything", "codex status", "what is
  Bruno doing", "take me to whoever needs me", "close idle agents", "jade theme", "create a
  worktree called …", "help", "again".
- Live updates: she tells you (and says) when an agent finishes, needs you or crashes,
  whether or not she started the work.
- Her reply card hovers above the panes; it never moves them.
- Her mark is a waveform that moves with your voice while you hold her shortcut and with hers
  while she answers. There is no mic button: the shortcut is how you talk.
- Small talk works with no model: greetings, thanks, "how are you", "who are you".
- "Go to primary" (or "main") means the current workspace's Primary; from Home, or for a name several workspaces
  share, she asks which workspace's ("primary of api" names it directly).

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
  and bots keep working while this computer is off. Settings › Remote › Use a Hiveory server pairs
  this window with it (SSH tunnel or an address, plus the one-time code it printed); Hiveory then
  restarts as that server's window. The server's dialogs, screen and installer are never reachable
  from a client. Disconnect returns to local mode.
- With Tailscale (ADR 0025), Settings › Remote › Your devices lists the user's tailnet devices.
  Devices sharing Hiveory show Connect. It takes one click on the user's own Tailscale login, and
  the sharing computer's code otherwise. Other online devices show Use over SSH. "Share this
  computer" (off by default) serves this desktop to them on its Tailscale address only, shows its
  pairing code and paired devices, and removing a device cuts it off at once. A headless server
  does the same with `hiveory --serve 7788 --tailscale`.

- Settings › Remote checks an SSH host (an alias from ~/.ssh/config or user@host) end to end and
  installs Hiveory's small host program in `~/.hiveory-host` there (with its own Node if needed).
- Hiveory uses the user's own SSH setup, never prompts for or stores passwords, and never accepts
  a host key on its own.
- Agent and shell terminals on this computer run in a separate host process; if it crashes,
  Hiveory keeps running, the affected terminals show as ended, and the next one starts a new host.

## Phone app (ADR 0027)

- Hiveory for phones (`mobile/`) uses the user's own computer over their own Tailscale network;
  no Hiveory server sits in between. Pairing: scan "Connect your phone" (Settings › Remote ›
  Share this computer), open its `hiveory://pair` link, or type the computer's Tailscale name.
  Same Tailscale account = no code.
- A phone may do everyday things only: watch every workspace and agent, open agents and presets,
  type in terminals, send messages, interrupt, restart and close agents, create worktrees, chat,
  answer the computer's SSH questions. Deleting, settings, accounts and resizing a desktop
  terminal stay on the computer (enforced by the server). Paired devices show as Phone or Desktop.
- Tabs: **Inbox** (agents that need you across workspaces, then those working; badge on the tab),
  **Workspaces** (each with live counts; a workspace's board one status at a time, most urgent first,
  and its worktrees), **Settings** (computers, notifications, theme, privacy).
- An agent screen shows its terminal exactly as on the computer (never resized), a bar that says
  why it waits with Esc and Enter, the keys a phone lacks, and a message box.
- Notifications (opt-in): "An agent needs you." through Expo push, at most once a minute per
  agent; only ids travel. Tapping opens that agent on the right computer.
- The phone wears the theme picked on the computer.

## Running in the background (ADR 0020)

- Closing the window keeps Hiveory in the system tray and every agent keeps working (Settings ›
  Agents › "Keep agents running in the background", on by default). The tray reopens the window
  and shows how many agents run; "Quit Hiveory" stops them.
- After a real quit or a reboot every terminal agent comes back on start-up, resuming its own
  conversation (ADR 0014); the CLIs keep their history on disk, listed in the Sessions tab.

## Important Non-Features

Initial version does not include:

- free-form agent-to-agent chat (Work agents coordinate through agent tools; bots through the Chief of Staff, ADR 0022)
- remote collaboration (planned as one host layer for Work and Bots, ADR 0022)
- global Kanban across workspaces
- task history in Work (Bots keeps a bounded run log for routines, ADR 0028)
- Done Kanban column
- user-controlled manual Kanban status
- multiple user-facing Tasks inside a Worktree
