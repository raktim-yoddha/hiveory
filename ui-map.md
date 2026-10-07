# UI Map

## Global

```text
┌──────────────────────────────────────────────────────────────────┐
│                       Work | Bots | Chat                         │
├──────────────┬───────────────────────────────────────────────────┤
│              │                                                   │
│   Projects   │                 Current Screen                    │
│              │                                                   │
│   + Add      │                                                   │
│   Sort       │                                                   │
│              │                                                   │
│ ▾ Project A +│                                                   │
│     Main     │                                                   │
│     Amber    │                                                   │
│ ▸ Project B  │                                                   │
│   Project C  │                                                   │
│              │                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

Expanding a project in the sidebar lists its Workspaces for navigation (ADR 0010).

### Bots mode (ADR 0022)

```text
┌ BOTS        + ┐┌ [RN] Release notes editor          ● ⚙ ┐
│ [RN] Release… CHIEF ││ Chief of Staff · Powered by Codex     │
│ [S]  Scout       ● ││ [New chat] [From Chief: …] [+]        │
│                │││          What should we work on?       │
│                │││ ┌ Message Release notes editor…      ┐ │
│                │││ │ 📎 Codex ▾  Model ▾  Effort  Read-only ↑│ │
└────────────────┘└──────────────────────────────────────────┘
```

- Sidebar: the team, Chief of Staff first, then pinned, then by name. Right-click: Edit, Make
  Chief of Staff, Pin, Delete. Double-click edits. A working dot shows running threads.
- Header: avatar, name, role and engine, status, Computer and browser (opens the bot panel), settings (opens the bot editor).
- Thread tabs: one per conversation, newest first; right-click deletes; "+" starts one. A bot's
  first thread opens on its own.
- Bot editor: Name, Brief, Engine, Full access, Chief of Staff, Team messaging, Memory (edit mode).
- Bot panel (the right column in Bots mode, resized like the Work side panel and sharing its width; tabs: Computer · Browser):
  - **Computer**: its Linux computer's screen (refreshed every 2 s while it runs and the window is
    shown) with Start/Stop and Take control; **Works on** cards: Auto · Linux computer · Server
    computer (SSH host field) · This computer · Browser · Off; a "Can use … now" line and, when a
    Settings switch blocks the choice, the reason with Open settings.
  - **Browser**: the pages all the bot's threads share, as tabs with close and "+"; the built-in
    browser pane below. Pages open in the bot's own profile ("Bot · <name>", made on first use), so
    the user can sign in to sites for the bot here and its logins stay apart from theirs. A note
    says when the bot can't use the browser right now (Works on, or Settings › Browser use).

### Queen Bee (ADR 0019)

```text
┌──────────────┬───────────────────────────────────────────────────┐
│   Projects   │                 Current Screen                    │
│              │            (lifts to make room)                   │
│              │ ┌───────────────────────────────────────────────┐ │
│              │ │ Reply card: answer, report rows, receipts, Undo│ │
│              │ └───────────────────────────────────────────────┘ │
│              │ [∿ Ada  Your instructions…  Win + Alt  ▁ ⋯]      │
└──────────────┴───────────────────────────────────────────────────┘
```

The reply card hovers over the panes (it never pushes them); only the bar takes room.

∿ is her waveform mark (still at rest, moving while you or she speaks). The shortcut chip
opens Settings › Queen Bee › Voice until a speech pack is installed. ▁ switches docked ↔
floating. ⋯ holds Personality, Talk back and Configure….

Floating: the same bar at a fixed width, centred over the bottom of the main area, always
there; the panes don't lift for it.

Settings › Queen Bee has tabs: Personality · Providers · Voice · Bar & shortcut.
- Personality: four cards (Ada, Sunny, Frankie, custom), the custom name/style/sliders,
  how she talks to you, and "Things she's learned" (edit, remove, add notes).
- Providers: ordered accounts; "Add provider" includes the Codex and Claude Code CLIs.
- Voice: guide, speech packs, Talkback (answer out loud, updates from agents, sound cues),
  "Her voice" picker with Preview, speed.
- Bar & shortcut: recorder and presets, "Also in other apps" toggle with its status,
  placement.

### Side panel browser tab (ADR 0015)

```text
┌ [Terminal] [Milo · GitHub ×] [New tab ×] [+] ───────────── ⤢ ┐
│ ← → ⟳ ( github.com/acme/app       [Work] [375×667] )  ⌖ ✎ ▭ </> ⋯ │
│ Milo is using this page                                       │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │                  native page view                         │ │
│ └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

⌖ pick element (copies it), ✎ annotate (note for agents), ▭ device mode (toolbar
above the page: device · width × height · DPR · zoom · rotate · close, with
drag handles on the emulated screen),
</> developer tools; ⋯ holds profiles, cookies and Browser settings. Narrow
panels fold ⌖ ✎ </> into ⋯.

### Side panel areas and Sessions (ADR 0020)

```text
┌ [Explorer ×] [Sessions ×] [+] ─────────────────── ⤢ ┐
│ Agent sessions                                    ⟳ │
│ ( Workspace | Project | All )                       │
│ ( Search sessions                                 ) │
│ 207 sessions                          Last updated  │
│ ▾ hiveory                                       12  │
│   Light theme with theme switcher               ⋯   │
│   Agent: I've changed the calendar embed…           │
│   [logo] Claude Code · 2d ago · claude-sonnet-5-5   │
└─────────────────────────────────────────────────────┘
            ═══ divider (drag) ═══
┌ [GitHub ×] [+] ─────────────────────────────────────┐
│  bottom area: its own tabs                          │
└─────────────────────────────────────────────────────┘
```

Drag a tab into the lower half to open the bottom area ("Show below" preview); the browser page
steps aside while a tab is dragged. ⋯ on a session: Resume in <workspace>, Copy session ID.

### Settings › Skills, MCP & Apps (ADR 0017, 0023)

```text
┌ Skills, MCP & Apps ──────────────────────────────────────────┐
│ ( Skills 12 | MCP servers 3 | Apps 2 )                   ⟳   │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ [C] Composio        ● Key saved  ⟳  [Change key] [Remove] │ │
│ │     (no key: [•••• Composio API key] [Save key] · Get ↗) │ │
│ └──────────────────────────────────────────────────────────┘ │
│ [ Search apps                                      ]         │
│ (All) (Connected) (Work) (Code) (Data) (Business) (Search) … │
│ ┌────────────────────────┐ ┌────────────────────────┐        │
│ │ [■] Gmail              │ │ [■] GitHub             │        │
│ │ Read, send…            │ │ Repos, PRs…            │        │
│ │ ✓ Connected [+ Add acc]│ │            [Connect]   │        │
│ │ ┌ Work  ca_… · active ┐│ └────────────────────────┘        │
│ │ └─────── [Disconnect] ┘│                                   │
│ │ [Account name…] [Cont.]│                                   │
│ └────────────────────────┘                                   │
└──────────────────────────────────────────────────────────────┘
```

Apps: Connect is disabled until a key is saved. Connect and Add account both ask
for the account's name first, then open the app's own sign-in in the browser.
Accounts refresh when the window regains focus.

Skills rows: name and description; on the right a stacked logo group of the installed CLIs that
load it (first three, then "+N"), one folders button ("Shared (.agents) ▾" or "2 folders ▾") and
open folder. The folders button opens a checklist of every skills folder from the CLI registry —
label, path and the CLIs that read it, filterable — so a row never grows with the number of CLIs.
New skill uses the same checklist. MCP: "In Hiveory · every agent"
(toggle, reconnect, edit, remove) and "In your CLIs" ("Every agent").

### Settings › Appearance

Theme cards three per row; Background: None, six presets, added images, Add
image; Transparency · Blur · Dim sliders when a wallpaper is set.

### Side panel Explorer (ADR 0018)

```text
┌ [GitHub ×] [Explorer ×] [+] ─────────────── ⤢ ┐
│ DEMO-APP                     ＋file ＋dir ⟳ ⇤ │
│ ( Search files                              ) │
│ ▾ src                                        │
│     index.ts                                 │
│   README.md                                  │
└───────────────────────────────────────────────┘
```

Double-click a file: it opens as a pane `[file] index.ts  src  · ⤢ ×` beside the
agents. Pane "+": `( → Right | ↓ Bottom )`, search, Terminals, Agents.

## Add project (ADR 0020)

```text
┌ Add project ───────────────────────────────────────── × ┐
│  Project name                              [ Local ▾ ]  │
│ [Pick directory] [New repository] [Clone] [Restore prev]│
│ Directory                                                │
│ [📁 ~/code/app                              ( Choose )] │
├──────────────────────────────────────────────────────────┤
│                                     [ Add project Ctrl⏎ ]│
└──────────────────────────────────────────────────────────┘
```

New repository: name, "Also create it on GitHub" (owner, visibility), project directory.
Clone: repository URL, project directory. Restore previous: removed projects (workspaces,
agents, "Removed 2 days ago") and workspace folders found on disk ("Open now" adds them to
the open project).

## Project

```text
┌──────────────────────────────────────────────────────────────────┐
│ Project A                                                        │
├──────────────────────────────────────────────────────────────────┤
│ Tasks │ Pull Requests │ Workspaces │ Settings                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        Project content                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Project Kanban

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Tasks                                                                    │
├──────────────────────┬──────────────────────┬─────────────────────────────┤
│ Idle                 │ Working              │ Waiting for You             │
├──────────────────────┼──────────────────────┼─────────────────────────────┤
│ ┌──────────────────┐ │ ┌──────────────────┐ │ ┌─────────────────────────┐ │
│ │ [logo] Milo      │ │ │ [logo] Luna      │ │ │ [logo] Kai              │ │
│ │ Workspace 1      │ │ │ Workspace 2      │ │ │ Workspace 1             │ │
│ └──────────────────┘ │ └──────────────────┘ │ │                         │ │
│                      │                      │ └─────────────────────────┘ │
│ ┌──────────────────┐ │ ┌──────────────────┐ │                             │
│ │ [logo] Ruby      │ │ │ [logo] Max       │ │                             │
│ │ Workspace 3      │ │ │ Workspace 1      │ │                             │
│ └──────────────────┘ │ └──────────────────┘ │                             │
└──────────────────────┴──────────────────────┴─────────────────────────────┘
```

## Empty Workspace

```text
┌──────────────────────────────────────────────────────────────────┐
│ Workspace 1                                                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                         Empty Workspace                          │
│                                                                  │
│                    ┌──────────────────┐                          │
│                    │   Open agent     │                          │
│                    └──────────────────┘                          │
│                                                                  │
│                    ┌──────────────────┐                          │
│                    │   Load preset    │                          │
│                    └──────────────────┘                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Populated Workspace

No header bar: panes fill the area (ADR 0011). ⤢ = maximize / restore. Right-click a
pane's name for restart, move and close (ADR 0018).

```text
┌──────────────────────────────────────────────────────────────────┐
│ ┌───────────────────────┐      ┌──────────────────────────────┐ │
│ │ [logo] Milo ●    + ⤢ ×│      │ [logo] Luna ●      + ⤢ ×    │ │
│ ├───────────────────────┤      ├──────────────────────────────┤ │
│ │                       │      │                              │ │
│ │       CLI / PTY       │      │          CLI / PTY            │ │
│ │                       │      │                              │ │
│ │                       │      │                              │ │
│ └───────────────────────┘      └──────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Workspace Creation

```text
┌───────────────────────────────────────────────┐
│ Create Workspace                              │
├───────────────────────────────────────────────┤
│ ( Project folder )  ( New branch )            │
│ Workspace name              [Random name]     │
│                                               │
│ Issue / Pull Request       [optional]         │
│                                               │
│ Agents | Presets                              │
│                                               │
│ [✓] Claude logo     [-] 2 [+]                │
│ [✓] Codex logo      [-] 1 [+]                │
│ [ ] Other logo      [-] 0 [+]                │
│                                               │
│ [ Add all CLIs ]                              │
│                                               │
│ Auto-approve permissions              [ ON ]  │
│                                               │
│ [ Create empty ]             [ Create ]       │
└───────────────────────────────────────────────┘
```

## Pane Add Menu

```text
┌──────────────────────────────┐
│ ( → Right  |  ↓ Bottom )     │
│ [ Search terminals and agents ] │
│ TERMINALS                     │
│   [logo] PowerShell           │
│   [logo] Command Prompt       │
│   [logo] Git Bash             │
│ AGENTS                        │
│   [logo] CLI A                │
│   [logo] CLI B                │
└──────────────────────────────┘
```

## Pane Swap

```text
Normal drag:

┌─────────┐      ┌─────────┐
│ Pane A  │ ---> │         │
└─────────┘      │ Pane B  │
                 └─────────┘

             edge preview
                  ↓
             dock/move


Space + drag:

┌─────────┐      ┌─────────┐
│ Pane A  │ ---> │ Pane B  │
└─────────┘      └─────────┘
                       ↑
                  drop target

Result:

┌─────────┐      ┌─────────┐
│ Pane B  │      │ Pane A  │
└─────────┘      └─────────┘
```

## Phone app (ADR 0027)

```text
Tabs ─ Inbox (Needs you · Working)  ─ Projects ─ Settings
Projects › Project (Needs you | Working | Idle tabs, Workspaces, + New) › Workspace (Open an agent sheet) › Agent
Agent: header (pet name, status pill, ⋯ actions) · terminal · needs-you bar (Esc / Enter) · key row · message box
Welcome (3 steps) › Pair (QR scanner · or address + code)
App-wide: SSH question sheet · notices · notification taps
```
