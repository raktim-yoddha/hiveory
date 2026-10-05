# UI Map

## Global

```text
┌──────────────────────────────────────────────────────────────────┐
│                         Workspace | Chatspace                    │
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
auto-hide. ⋯ holds Personality, Talk back and Configure….

Auto-hide: the same bar at a fixed width, centred over the bottom of the main area. It rests
below the edge and rises when the pointer reaches the bottom of the window, on her shortcut,
while either of you speaks and while her card is up.

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

### Settings › Skills, MCP & Plugins (ADR 0017)

```text
┌ Skills, MCP & Plugins ───────────────────────────────────────┐
│ ( Skills 12 | MCP servers 3 | Plugins 30 )               ⟳   │
│ [ Search plugins                                   ]         │
│ (All) (Connected) (Code) (Work) (Data) (Business) (Search) … │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│ │ [■] GitHub   │ │ [■] Linear   │ │ [■] Notion   │           │
│ │ Repos, PRs…  │ │ Issues…      │ │ Pages…       │           │
│ │ ● 41 tools   │ │ Set up →     │ │ Set up →     │           │
│ └──────────────┘ └──────────────┘ └──────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

Skills rows: name, description, folder toggles (Shared · Claude · Codex ·
Cursor), CLI logos that load it, open folder. MCP: "In Hiveory · every agent"
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
