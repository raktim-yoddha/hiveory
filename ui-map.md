# UI Map

## Global

```text
┌──────────────────────────────────────────────────────────────────┐
│ (no title bar, ADR 0056: every column starts at the top)         │
├──────────────┬───────────────────────────────────────────────────┤
│◆ Hiveory  ◨◧ │                                                   │
│              │                                                   │
│  Workspaces  │                 Current Screen                    │
│              │                                                   │
│   + Add      │                                                   │
│   Sort       │                                                   │
│              │                                                   │
│◆ Workspace A+│                                                   │
│  ⌂ app Primary│                                                  │
│     main     │                                                   │
│  ⑂ Amber     │                                                   │
│     hiveory/a│                                                   │
│◆ Workspace B │                                                   │
│  ../amber ⑂ x│                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

The sidebar (ADR 0038): ◆ is the workspace's mark (icon and color from its Settings); clicking it
folds or unfolds its Worktrees. The workspace row does nothing while unfolded; folded, it shows the
last-opened Worktree's folder and branch and clicking it opens that Worktree. Each Worktree shows its
name and branch; the Primary shows the workspace folder's name with a Primary tag. "+" offers New
branch · Existing branch · Remote branch. A workspace whose folder is gone shows a warning mark.
Under each Worktree, its agents as one bar of chips (status dot + CLI logo, busiest first, +N, ›);
a click anywhere on the bar unfolds it into a list (each row opens its pane): "N agents", then dot · logo · pet name · status · time in that status
(ADR 0040). A loop spins at the end of a Worktree's row while any of its agents is working.

### Window chrome (ADR 0056)

No title bar and no modes. The sidebar's top bar: logo · Hiveory · DEV/SERVER chip, then Queen Bee's
mark (when put away) and the sidebar toggle; it drags the window. The sidebar's footer: Settings.
Hidden, the sidebar is an icon rail: sidebar toggle and Queen Bee's mark at the top, Settings at the
bottom. The side panel toggle (in a worktree) sits at the top right, left of the window controls
(Windows, Linux); the top-right card's header leaves both room. Every top bar has one height.

```text
┌ ◆ Hiveory DEV    ∿ ◧ ┐┌ [Ada ×] [+] ──────────────┐┌ Dashboard ⟲ ⑂ 🗓 ⚙  ⤢  ◨ │ — □ × ┐
│ WORKSPACES     ⇅ 📁 │                            │                               │
│ …                    │        panes               │       side panel              │
│ ⚙                    │                            │                               │
└──────────────────────┘└────────────────────────────┘└───────────────────────────────┘
```

- Schedule editor (modal): Title; Starts (date, time, this computer's timezone); Repeat (Does not
  repeat · Every X minutes · Daily · Every weekday · Weekly on <day> · Selected weekdays (day chips) ·
  Monthly on day N · Monthly on the last day · Yearly · Custom cron); the next three runs; when
  schedules run; Advanced (stop a run after N minutes, last day); Worktree and CLI; Instructions; the
  schedule's files. Editing adds Delete and Run now. Its title names the Workspace (ADR 0040).
- Schedules tab (side panel): header (Schedules, ‹ › day or week, the range with a mini month, Today,
  Day · Week · List · Run logs, New schedule); the keep-awake switch; the calendar (click an empty hour
  for a new schedule there, a run to edit its schedule); List: schedule rows; Run logs: status,
  schedule, who ("Claude Code · demo-app · main"), when, by you or the schedule, duration, why it failed.
- Message box (a Work agent in chat view): attach; model · effort · usage limits (gauge and popover,
  ADR 0055) · permissions. While answering, the box stays open, a queue button sits beside Stop, and
  waiting messages list above the box ("Next" / "Then", each with ×) (ADR 0031).

### Queen Bee (ADR 0019)

```text
┌──────────────┬───────────────────────────────────────────────────┐
│  Workspaces  │                 Current Screen                    │
│              │            (lifts to make room)                   │
│              │ ┌───────────────────────────────────────────────┐ │
│              │ │ Reply card: answer, report rows, receipts, Undo│ │
│              │ └───────────────────────────────────────────────┘ │
│              │ [∿ Ada  Your instructions…  🎙 ✉ ▁ ⋯]     │
└──────────────┴───────────────────────────────────────────────────┘
```

The reply card hovers over the panes (it never pushes them); only the bar takes room. Live
updates wait behind ✉ (a dot marks an unseen one); ✉ opens and closes the card (ADR 0038).

∿ is her waveform mark (still at rest, moving while you or she speaks). 🎙 talks by hand: tap
to listen, tap again to send (holding her shortcut still works); it opens Settings › Queen Bee ›
Voice until a speech pack is installed (ADR 0019 amendment). ▁ switches docked ↔
floating. ⋯ holds Personality, Talk back and Configure….

Floating: the same bar at a fixed width over the bottom of the window, always there; the panes
don't lift for it. Drag ∿ to the left, middle or right; double-click ∿ to shrink to just ∿ (or
open again). Six modes: full/small × left/middle/right.

```text
Full left    [∿ Ada  Your instructions…  🎙 ▁ ⋯]
Full middle                 [∿ Ada  Your instructions…  🎙 ▁ ⋯]
Full right                                [∿ Ada  Your instructions…  🎙 ▁ ⋯]
Small        [∿]            [∿]                                              [∿]
```

Sidebar only (ADR 0044, 0056): no bar; her mark ∿ sits in the sidebar's top bar before the layout
buttons (a dot for an unseen message). A click, her shortcut or a question drops the bar (and card)
down under it; Escape or a click elsewhere puts it away. ⋯ › "Put away in the sidebar" / "Show her bar
again" switch it, as does Settings › Queen Bee › Bar & shortcut › Where she sits.

```text
┌ ◆ Hiveory  ∿ ◨ ◧ ┐
[∿ Ada  Your instructions…  ✉ ⋯]
```

Settings › Queen Bee has tabs: Personality · Providers · Voice · Bar & shortcut.
- Personality: four cards (Ada, Sunny, Frankie, custom), the custom name/style/sliders,
  how she talks to you, and "Things she's learned" (edit, remove, add notes).
- Providers: ordered accounts; "Add provider" includes the Codex and Claude Code CLIs.
- Voice: guide, speech packs, Talkback (answer out loud, updates from agents, sound cues),
  "Her voice" picker with Preview, speed.
- Bar & shortcut: recorder and presets, "Also in other apps" toggle with its status,
  placement.

Settings › Keyboard (ADR 0047), after Queen Bee: Queen Bee (Call Queen Bee), General (Settings, shortcuts,
sidebar, side panel, maximize side panel, Schedules), Lists (New worktree, Next / Previous worktree), Panes and tabs (New tab, New terminal, Close, Next /
Previous tab, Next / Previous area, Maximize, Split right / down), Chat (Type in the message box): each row shows its keys
as a keycap with Change (press the new keys; Escape cancels), Remove and Reset; a clash or a reserved key
is named under it. Built in: the fixed keys, read-only. "Reset every shortcut" when any was changed.
The chrome buttons' tooltips show the keys ("Hide sidebar (Ctrl Shift B)").

### Browser pane (ADR 0015; a pane among the agents since ADR 0042, opened from a pane's "+" › Browser)

Annotate (ADR 0042): strip "N notes ready. Click another element, or send them below." [Done]; note bar
[note…] ( Change | Question ) [Add] [×]; numbered badges on the page; batch: "N notes" ˅ [Send ▾: running
agents · New agent: CLIs] [Copy] [🗑], rows (n, element, note, Change/Question, ×).

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

### Settings › Skills, MCPs & Apps (ADR 0017, 0023)

Skills: ( Installed | skills.sh ) beside the search box. skills.sh: before a search, "Top skills on
skills.sh" (1–50 by installs); search as you type; rows (rank, name, Installed, source ·
installs, open on skills.sh ↗, Install). Install: security audits (provider passed / warns / failed ·
risk), Where (everywhere / this workspace), Folders (preselected to reach every installed CLI),
"Reaches [logos] every installed CLI". MCP servers: ( In Hiveory | MCP Registry ). Registry: search on
Enter, rows (title, npx · uvx · Docker · Hosted, Added, description · version, repository ↗, Add),
Show more. Add: how it runs (when several), the command, its values (secret ones hidden), Add to
every agent (ADR 0041).

```text
┌ Skills, MCPs & Apps ──────────────────────────────────────────┐
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

A section bar like every Settings page's (ADR 0043, 0044): Theme · Background · Terminal font,
one shown at a time. Theme: Dark · Bronze · Silver cards, then VS Code themes. Panes are always Tabs
with spaced, rounded surfaces; there is no choice (ADR 0042 amendment 2026-10-26). Theme cards three per row; Background: None, six presets, added images, Add
image; Transparency · Blur · Dim sliders when a wallpaper is set. VS Code themes (ADR 0034):
each installed extension's themes as cards (Remove per extension), then a search field and the
Open VSX catalog (icon, name, publisher · installs, description, Install / Installed, Show more).
Installing applies the extension's first theme.

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
agents. Pane "+": `( → Right | ↓ Bottom )`, a dropdown `[Open as terminal ▾]` / chat (starts
from the Workspace's setting, else the Worktree's, else Settings › Agents › New agents open as;
ADR 0037, ADR 0038), search, Terminals, Agents.

## Add workspace (ADR 0020)

```text
┌ Add workspace ─────────────────────────────────────── × ┐
│  Workspace name                            [ Local ▾ ]  │
│ [Pick directory] [New repository] [Clone]               │
│ Directory                                                │
│ [📁 ~/code/app                              ( Choose )] │
├──────────────────────────────────────────────────────────┤
│                                   [ Add workspace Ctrl⏎ ]│
└──────────────────────────────────────────────────────────┘
```

New repository: name, "Also create it on GitHub" (owner, visibility), workspace directory.
Clone: repository URL, workspace directory. A workspace comes with its Primary and every worktree
Git knows (ADR 0038).

## Workspace

The Workspace page is the **Dashboard** tab of the side panel beside the open Worktree (ADR 0038, 0039), added from the
panel's "+" or from a workspace's right-click › Workspace settings. It has no New worktree button.

```text
┌ [▦ Dashboard ×] + ───────────────── ⤢ ┐
│ ◆ Workspace A                         │
│   ⌂ … › app  ⧉ 📁                     │
│ ▦ Tasks │ ⑂ Worktrees │ ◉ Issues   (icons only when narrow)
├────────────────────────────────────────┤
│ [ All | Here ]                         │
│ ● NEEDS YOU                         0  │
│ ● WORKING                           1  │
│ ● IDLE                              2  │
└────────────────────────────────────────┘
```

Tasks: All = every Worktree's agents; Here = only the open Worktree's. Narrow, the columns stack.

Worktrees tab (ADR 0040): worktree cards (branch, agents, changes, ahead/behind; their PR/MR link or
Create PR/MR), then "Pull requests · N" (or Merge requests) with refresh: title, #, branch, author,
review state, open on the host; without a code host, the reason and Code host settings.
Issues tab: "Issues · GitHub/GitLab/Jira/Linear", refresh, a filter past 8 issues, rows (title, key ·
state, Start worktree, open); without a source, the reason and Issue settings.

Schedules tab (ADR 0040; a side-panel tab of its own since ADR 0042, like Settings): the Schedules page for this
Workspace's schedules (ADR 0055): Day · Week · List · Run logs (Day first), the calendar, the keep-awake switch,
New schedule (for the open Worktree; an empty hour on the calendar starts one there).

Settings tab (ADR 0037): General (Name, Icon and color, Folder, Repository) · Agents (New agents open as:
Each worktree's choice | Terminal | Chat; Announce agents) · Chat agents start with (model and
effort per chat CLI) · New worktrees (Branch prefix, Start from) · Integrations (Code host: Automatic |
GitHub | GitLab | Off; Issues: The code host | Jira | Linear | Off; Project or Team) · Remove from Hiveory.

Settings › Integrations (ADR 0040): Code hosts (GitHub, GitLab: brand mark, signed-in user or how to
sign in, check again) · Issue trackers (Jira: site, email, API token; Linear: API key; Connect unfolds
the form with a link to create the key; connected: site · email, Disconnect).

## Workspace Kanban

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Tasks                                                                    │
├──────────────────────┬──────────────────────┬─────────────────────────────┤
│ Needs You            │ Working              │ Idle                        │
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
│ New worktree                                  │
├───────────────────────────────────────────────┤
│ Worktree name               [Random name]     │
│ Base branch [main ▾]   New branch [hiveory/x] │
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
│ Skip permissions (YOLO)               [ ON ]  │
│                                               │
│                 [ Create  /  Create with N ]  │
└───────────────────────────────────────────────┘
```

## Tabbed panes (ADR 0042)

```text
┌ [◉ Milo ● ×] [◉ Ivy ●] [⊕ notes.md] [+] ──────────┐  ┌ [◉ Rex ● ×] [+] ────────┐
│ (the chosen tab's terminal, chat, file or page)     │  │                          │
└─────────────────────────────────────────────────────┘  └──────────────────────────┘
```

Every area shows its panes as tabs (ADR 0042 amendment 2026-10-26). "+" (right after the last tab)
opens a tab, with no placement choice (ADR 0043). Tab: click shows; drag along the
strip reorders (a bar marks the spot), onto another strip places it there, into an area's middle adds it,
to an area's edge splits it out, Space swaps; middle-click closes; double-click maximizes; right-click:
Rename · Split right · Split down · Close; right-click twice renames.

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
Tabs (one bar, the selected pill holds icon and label; ADR 0039) ─ Home ─ Work ─ Bots ─ Chat ─ Settings
Work › Workspace (its mark; header: Pull requests · Settings; Worktrees (Primary tagged), + New: New | Existing | Remote branch; Needs you | Working | Idle tabs) › Worktree (branch and changes, Open an agent sheet with Terminal | Chat) › Agent
Bots › Bot (its threads, + New thread) › Thread (as a chat) · Chat › Chat (+ New chat: pick a CLI)
Workspace › Pull requests (worktree branches with Create PR, open pull requests; GitLab's merge requests too) · Workspace › Settings (the computer's Settings tab, ADR 0037)
Agent: header (CLI logo, pet name, status pill, ⋯ actions) · terminal or chat (markdown) · needs-you bar (Esc / Enter)
  terminal: a box typed straight into the CLI (keyboard Enter adds a line) · key row [/ Esc Tab ↑ ↓ ……… ⏎] (⏎ fixed right, sends)
  chat: model and effort · message box
Welcome (3 steps) › Pair (QR scanner · or address + code)
App-wide: SSH question sheet · notices · notification taps
```
