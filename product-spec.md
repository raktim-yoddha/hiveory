# Product Specification

## Product Modes

Exactly two (labelled Work and Chat in the UI, ADR 0012):

```text
Workspace (Work)
Chatspace (Chat)
```

Chat: pick a detected CLI (Antigravity excluded), then a model (searchable),
then an effort level when that model supports one. The CLI locks after the
first message. Chats keep running while the user is in Work.

## Project Lifecycle

```text
Open/Create Project
        │
        ▼
    Project Page
        │
        ├── Tasks / Kanban
        ├── Pull Requests
        ├── Workspaces
        └── Settings
```

Opening a Project does not create a Workspace.

## Workspace Lifecycle

```text
Project
   │
   ├── Main Workspace
   │
   └── Create Workspace
          │
          ├── Create empty
          │
          └── Configure CLIs
                   │
                   ▼
              Workspace
```

## Empty Workspace

```text
Workspace exists
      │
      └── zero CLI instances
              │
              ├── Open agent
              └── Load preset
```

## Workspace Creation Configuration

The configuration surface supports:

```text
Workspace name
Issue / PR association
CLI selection
Add all CLIs
CLI instance count
Auto-approve permissions
Preset
Create empty Workspace
```

## CLI Configuration

Example:

```text
Claude Code       [-] 2 [+]
Codex             [-] 1 [+]
Gemini            [-] 1 [+]
```

Launching the Workspace starts the requested number of independent instances.

If count = 2:

```text
Claude logo   Milo
Claude logo   Luna
```

## Project Kanban

The Project Tasks view is:

```text
┌──────────────────────────────────────────────────────────────┐
│ Idle             │ Working          │ Waiting for You       │
├──────────────────┼──────────────────┼───────────────────────┤
│ Workspace 1      │ Workspace 2      │ Workspace 1           │
│ [CLI logo] Milo  │ [CLI logo] Luna  │ [CLI logo] Kai        │
│                  │                  │                       │
│ Workspace 3      │ Workspace 1      │ Workspace 4           │
│ [CLI logo] Ruby  │ [CLI logo] Max   │ [CLI logo] Nova       │
└──────────────────┴──────────────────┴───────────────────────┘
```

Every card represents a real CLI instance.

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

## Workspace Pane Behavior

Each CLI has a pane.

Panes:

- have visible gutters
- can split right
- can split bottom
- can be rearranged
- can be swapped using Space-drag

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

Selecting a preset replaces the current CLI configuration when the Workspace is in the appropriate empty/configuration state.

## Main Workspace

Main Workspace:

- is created by the user ("Create workspace" → "Project folder"), at most one per Project (ADR 0011)
- maps to the original project folder
- is never deleted from disk; it can be removed from Hiveory (agents close, folder untouched) and created again (ADR 0013)
- can run CLI instances
- participates in the same Kanban as isolated Workspaces

## Isolated Workspace

Isolated Workspace:

- uses a linked worktree
- uses a local branch
- can run multiple CLI instances
- can be deleted according to workspace lifecycle rules

## Built-in Browser

The side panel's Browser tab is a real browser (ADR 0015):

- toolbar: back, forward, reload, address bar (bare hosts and searches work), pick element, annotate element, viewport sizes, developer tools, and a menu with profiles, cookie import/export/clear and Browser settings
- agents drive it through `browser_*` MCP tools with a visible cursor; it is on by default and works while the panel is closed
- pages an agent opens appear as tabs in its workspace's side panel, named after the agent
- profiles keep separate cookies and logins; viewports emulate phones, tablets and desktops
- Settings › Browser: browser use, agent cursor, home page, default profile, profiles, custom viewport sizes
- device mode: a toolbar above the page with 22 devices, editable width × height, pixel ratio, rotate and drag handles (ADR 0016); agents use the same
- "is using this page" shows only while an agent is acting

## Computer Use

Off by default (Settings › Agents). When on, agents operate this computer through `computer_*` tools: app elements as text with refs, real mouse and keyboard, windows and screenshots (Windows for now; ADR 0016).

## Plugins, MCP servers and skills

Settings › Skills, MCP & Plugins has three tabs (ADR 0017):

- **Skills** — every Agent Skill across the skills folders, with the CLIs that load it; light a folder to copy the skill there; create a skill or import a skill folder; remove a copy (to the trash)
- **MCP servers** — servers Hiveory runs for every agent (add by command or URL, with env vars/headers) and the servers each CLI configures, which can be added to every agent in one click
- **Plugins** — 30 apps (GitHub, Linear, Notion, Slack, Stripe, Supabase…) set up with the user's own keys: no OAuth, nothing hosted; every agent — terminal and chat — gets their tools

## Appearance

Six flat themes, three per row. A background wallpaper (any image the user adds) with transparency (0–100%, applied to every surface), blur and dim. Dragging a sidebar past its minimum width hides it (ADR 0017, 0018).

## Terminals, Explorer and editor panes (ADR 0018)

- A pane's "+" opens terminals (PowerShell, Command Prompt, Git Bash) or agents, with search; Right and Bottom side by side
- Terminal panes are not agents: no Kanban card
- The side panel holds browsers and one Explorer per folder: file tree with search, new file/folder, rename, cut/copy/paste, delete (to trash), copy path
- Double-clicking a file opens it as an editable pane (Ctrl+S saves); it reloads when an agent changes it on disk

## Queen Bee (ADR 0019)

- A bar docked under the main area (Work, Chat and Settings) or floating anywhere.
- Her shortcut (default Win+Alt, ⌘⌥ on macOS, any 2–3 keys in Settings) taps to focus
  her and holds to talk.
- Typed commands run app actions: open N agents of a CLI (optionally "in <workspace>"),
  close agents (always after a yes), restart, jump to an agent, load a preset, switch
  Work/Chat, open Home, a project, a workspace or a Settings section, show or hide the
  side panel, and open a browser or the Explorer.
- Reports ("what's left?", "who's waiting?") list agents by status with wait times, from
  live state. The current project, or every project from Home.
- She asks instead of guessing (unknown or ambiguous names), runs nothing if any part of
  a command is unclear, and offers Undo for opens and navigation.
- Personalities Ada, Sunny and Frankie change wording only. Settings › Queen Bee holds:
  - personality and what she calls you;
  - reply length;
  - one extra per personality: Ada's honorific, Sunny's energy, Frankie's nudge time;
  - placement.
- "Tell <agent> to …" types your exact words into that agent and submits them.
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
- Later phases add the system-wide hotkey, learned memory and a custom personality.

## Important Non-Features

Initial version does not include:

- agent-to-agent communication
- remote collaboration
- global Kanban across projects
- task history
- Done Kanban column
- user-controlled manual Kanban status
- multiple user-facing Tasks inside a Workspace
- Agent top-level mode
