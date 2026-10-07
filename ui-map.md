# UI Map

## Global

```text
┌──────────────────────────────────────────────────────────────────┐
│                       Work | Bots | Chat                         │
├──────────────┬───────────────────────────────────────────────────┤
│              │                                                   │
│  Workspaces  │                 Current Screen                    │
│              │                                                   │
│   + Add      │                                                   │
│   Sort       │                                                   │
│              │                                                   │
│▾ Workspace A+│                                                   │
│   Primary    │                                                   │
│     Amber    │                                                   │
│ ▸ Workspace B│                                                   │
│   Workspace C│                                                   │
│              │                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

Expanding a workspace in the sidebar lists its Worktrees for navigation (ADR 0010).

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

- Sidebar: the bots, grouped by team when there is more than one (foldable headings with a count),
  Chief of Staff first, then pinned, then by name. Right-click: Edit, Make
  Chief of Staff, Pin, Move to <team>, Delete. Double-click edits. A working dot shows running threads.
- Header: avatar, name, role and engine, status, Computer and browser (opens the bot panel), settings (opens the bot editor).
- Thread tabs: one per conversation, newest first; right-click deletes; "+" starts one. A bot's
  first thread opens on its own.
- Bot editor: Name, Blurb, Brief, Engine, Full access, Chief of Staff, Team messaging, Runs on a schedule, Memory (edit mode).
- Sidebar "+": New bot (Ctrl N, ⌘N on Mac, while the bots sidebar is shown) and Templates: a
  gallery of starter bots (Inbox triager, Standup writer, Release notes editor, PR reviewer,
  Research scout, Competitor watch) with what each uses; picking one opens the bot editor filled in.
  Create team opens a name dialog. New group chat joins the menu when group chats are built.
- Sidebar footer: **Work board** opens the work board; **Routines** the Routines page; **Triggers** the Triggers page; **Team map** the team map (ADR 0028).
- Triggers page: the event link card (off / on with its address / needs attention, with the reason, a
  button to the page that fixes it, and "Use this project's webhook for Hiveory" when the Composio
  project's webhook goes elsewhere); then "⚡ When [app · account] [event] → [bot] should", the event's
  fields, "What it should do with each event", Create trigger; then YOUR TRIGGERS (name, app → bot,
  last event, instructions, delete, on/off). Without a Composio key or connected app: a pointer to Apps.
- Work board: four cards, Needs you (approval cards) · Working · Didn't finish · Done, each with a count; a row per handoff or
  routine/trigger run ("From → bot", title, since/when, the reason it failed), opening its thread.
  Finished work stays a day. Nothing is dragged.
- Routine editor's **Who does it** (ADR 0030): bots, then "A new chat (Chat mode)" and "A new agent in a
  Work worktree" (Workspace, Worktree, CLI). Below the instructions: the routine's files (chips) and "Add files
  for every run". Chat's sidebar header: Schedule a chat (calendar icon) beside
  New chat. A worktree's menu: Schedule a routine…
- Message box (Chat, bot threads, Work chat view): bookmark button (Saved prompts: insert · Save what is typed
  as a prompt · Remove); while answering, the box stays open, a queue button sits beside Stop, and waiting
  messages list above the box ("Next" / "Then", each with ×) (ADR 0031).
- Approval card (ADR 0029): in a bot's thread above the composer and on the work board: "<Bot> wants to
  send or post as you / change something in your apps", the tool, "What it will send" (the arguments
  as plain text), Decline, Allow. The bot's dot turns to waiting while one is open.
- Team map: header (bot and team count, Create team); a card per team (name, count, ⋯ Rename /
  Delete), its bots as tiles (avatar, name, crown for the Chief, role and engine, working dot);
  drag a tile onto another card to move the bot; right-click a tile for the bot's actions, "Move to
  <team>" included. Below: Handoffs, "From → To · thread · Working / Done · when", each opening its thread.
- Routines page: header (Routines, ‹ › week or day, the range ("October 5 – 11, 2026"; a button opening a
  mini month whose days with runs carry a dot; picking a day jumps there), Today, Day · Week · List · Run logs,
  bot filter, New routine); the keep-awake switch with its explanation; Week: Mon–Sun columns,
  hour rows (opening at 07:00), today shaded, a now line, past runs coloured by outcome and upcoming
  runs from each schedule (same-time runs side by side); click an empty hour for a new routine there,
  or drop a bot from the sidebar on it for a new routine for that bot at that hour; Day: the same for one day;
  click a run to edit its routine. List: routine rows. Run logs: status, routine, bot, when, by you
  or the schedule, duration, why it failed, and Open thread.
- Routine editor (modal): Title; Starts (date, time, this computer's timezone); Repeat (Does not
  repeat · Every X minutes · Daily · Every weekday · Weekly on <day> · Selected weekdays (day chips) ·
  Monthly on day N · Monthly on the last day · Yearly · Custom cron); the next three runs; when
  routines run; Advanced (stop a run after N minutes, last day); Assign a bot (with "allow it to run
  on a schedule" inline); Post results to (a dedicated results thread · one of the bot's threads ·
  only each run's own thread); Instructions. Editing adds Delete and Run now.
- Bot panel (the right column in Bots mode, resized like the Work side panel and sharing its width; tabs: Overview · Computer · Routines · Browser):
  - **Overview**: name and blurb; Does; Can reach; Won't; Notifications switch; Asks before (Sending as
    you · Any change · Never, ADR 0029); Prompt preview
    (bytes ≈ tokens, expands to the exact text); Skills (the shared Skills panel, scoped to the bot:
    its own skills marked "This bot").
  - **Computer**: its Linux computer's screen (refreshed every 2 s while it runs and the window is
    shown) with Start/Stop, Take control and Rebuild (confirmed; "older desktop image" note when due),
    and where it runs (this computer, the SSH host or "<bot>'s computer", Docker or Podman); **Works on**
    cards: Auto · Linux computer · Server computer (SSH host field) · Share a computer (Whose computer) ·
    This computer · Browser · Off; a "Can use … now" line and, when a
    Settings switch blocks the choice, the reason with Open settings.
  - **Routines**: count, "allow it to run on a schedule" when it can't yet, Run logs, Create
    schedule, the bot's routine rows (name, schedule in words, next run, last failure, Run now, Edit,
    on/off), and Open schedules → (the Routines page filtered to this bot).
  - **Browser**: the pages all the bot's threads share, as tabs with close and "+"; the built-in
    browser pane below. Pages open in the bot's own profile ("Bot · <name>", made on first use), so
    the user can sign in to sites for the bot here and its logins stay apart from theirs. A note
    says when the bot can't use the browser right now (Works on, or Settings › Browser use).

### Queen Bee (ADR 0019)

```text
┌──────────────┬───────────────────────────────────────────────────┐
│  Workspaces  │                 Current Screen                    │
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
│ ( Worktree | Workspace | All )                      │
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
steps aside while a tab is dragged. ⋯ on a session: Resume in <worktree>, Copy session ID.

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

## Add workspace (ADR 0020)

```text
┌ Add workspace ─────────────────────────────────────── × ┐
│  Workspace name                            [ Local ▾ ]  │
│ [Pick directory] [New repository] [Clone] [Restore prev]│
│ Directory                                                │
│ [📁 ~/code/app                              ( Choose )] │
├──────────────────────────────────────────────────────────┤
│                                   [ Add workspace Ctrl⏎ ]│
└──────────────────────────────────────────────────────────┘
```

New repository: name, "Also create it on GitHub" (owner, visibility), workspace directory.
Clone: repository URL, workspace directory. Restore previous: removed workspaces (worktrees,
agents, "Removed 2 days ago") and worktree folders found on disk ("Open now" adds them to
the open workspace).

## Workspace

```text
┌──────────────────────────────────────────────────────────────────┐
│ Workspace A                                                      │
├──────────────────────────────────────────────────────────────────┤
│ Tasks │ Pull Requests │ Worktrees │ Settings                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        Workspace content                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Workspace Kanban

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Tasks                                                                    │
├──────────────────────┬──────────────────────┬─────────────────────────────┤
│ Idle                 │ Working              │ Waiting for You             │
├──────────────────────┼──────────────────────┼─────────────────────────────┤
│ ┌──────────────────┐ │ ┌──────────────────┐ │ ┌─────────────────────────┐ │
│ │ [logo] Milo      │ │ │ [logo] Luna      │ │ │ [logo] Kai              │ │
│ │ Worktree 1       │ │ │ Worktree 2       │ │ │ Worktree 1              │ │
│ └──────────────────┘ │ └──────────────────┘ │ │                         │ │
│                      │                      │ └─────────────────────────┘ │
│ ┌──────────────────┐ │ ┌──────────────────┐ │                             │
│ │ [logo] Ruby      │ │ │ [logo] Max       │ │                             │
│ │ Worktree 3       │ │ │ Worktree 1       │ │                             │
│ └──────────────────┘ │ └──────────────────┘ │                             │
└──────────────────────┴──────────────────────┴─────────────────────────────┘
```

## Empty Worktree

```text
┌──────────────────────────────────────────────────────────────────┐
│ Worktree 1                                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                         Empty Worktree                           │
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

## Populated Worktree

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

## Worktree Creation

```text
┌───────────────────────────────────────────────┐
│ Create Worktree                               │
├───────────────────────────────────────────────┤
│ ( Workspace folder ) ( New branch )           │
│ Worktree name               [Random name]     │
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
Tabs ─ Inbox (Needs you · Working)  ─ Workspaces ─ Settings
Workspaces › Workspace (Needs you | Working | Idle tabs, Worktrees, + New) › Worktree (Open an agent sheet) › Agent
Agent: header (pet name, status pill, ⋯ actions) · terminal · needs-you bar (Esc / Enter) · key row · message box
Welcome (3 steps) › Pair (QR scanner · or address + code)
App-wide: SSH question sheet · notices · notification taps
```
