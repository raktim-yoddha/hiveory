# UI Map

## Global

```text
┌──────────────────────────────────────────────────────────────────┐
│ (no title bar, ADR 0056: every column starts at the top)         │
├──────────────┬───────────────────────────────────────────────────┤
│◆ Hiveory  ◨◧ │                                                   │
│ 🗓 Schedules  │                                                   │
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

The sidebar (ADR 0038): Schedules sits above the Workspaces and opens the Schedules page in the main
area (ADR 0062). ◆ is the workspace's mark (icon and color from its Settings); clicking it
folds or unfolds its Worktrees. The workspace row does nothing while unfolded; folded, it shows the
last-opened Worktree's folder and branch and clicking it opens that Worktree. Right-click a
workspace for Workspace settings (Settings, on that workspace's page), Pin, Open folder, Copy path
and Remove. Each Worktree shows its
name and branch; the Primary shows the workspace folder's name with a Primary tag. "+" offers New
branch · Existing branch · Remote branch. A workspace whose folder is gone shows a warning mark.
Under each Worktree, its agents as one bar of chips (status dot + CLI logo, busiest first, +N, ›);
a click anywhere on the bar unfolds it into a list (each row opens its pane): "N agents", then dot · logo · pet name · status · time in that status
(ADR 0040). A loop spins at the end of a Worktree's row while any of its agents is working.

### Worktree bar and review (ADR 0064)

```text
┌ ⌂ app  demo-app  main  ⋯                    [▷ ▾] [</> VS Code ▾] [⟜ Commit ▾] ┐
│ [Review ×] [Milo ×] [+]                                                          │
│ Uncommitted ▾  +8 −2  3 files                                          ⇕  ⟳      │
│ ┌ ˅ README.md                    +4 −1  ✎ ┐                                       │
│ │ 1  1   # demo                          │                                       │
│ │ 3    − A small app.                    │                                       │
│ │    3 + A small app, now reviewed.      │                                       │
│ └────────────────────────────────────────┘                                       │
```

Run ▾: the Workspace script used last; the menu lists scripts and Edit scripts…. Open in ▾: installed editors with their own marks,
the system's file manager (File Explorer, Finder or Files, ADR 0065), Copy path. The git button shows the next step (Commit · Publish branch · Push · Create PR · Merge
PR); its menu: Commit…, Push, Create pull request, Create draft pull request, Pull request, Open on the code host,
Review changes. Review pane: the Changes tab's source menu, +/−, file count, collapse/expand all, refresh; each
file a card with a sticky header (chevron, name, folder, New/Deleted/Renamed, +/−, open) and a numbered diff.

Pull request tab (side panel): View on GitHub/GitLab ↗ · refresh; title #n; Open/Draft/Merged/Closed chip,
branch → base, author, review decision; checks card (headline, counts; unfolds into checks: state icon, name,
workflow, time, log); Merge pull request ▾ (Squash and merge · Create a merge commit · Rebase and merge) with a
confirmation. None yet: Create PR · Draft. Unavailable: the reason and Code host settings.

### Window chrome (ADR 0056)

No title bar and no modes. The sidebar's top bar: logo · Hiveory · DEV/SERVER chip, then the
sidebar toggle; it drags the window. The sidebar's footer: Settings.
Hidden, the sidebar is an icon rail: sidebar toggle at the top, Schedules, then every
Workspace's mark (click: open the Worktree last used there; double-click or →: its Worktrees as
two-letter initials, "MA" for main, "LP" for feature/login-page; click one to open it), Settings at
the bottom. The side panel toggle (in a worktree) sits at the top right, left of the window controls
(Windows, Linux); the top-right card's header leaves both room. Every top bar has one height.

```text
┌ ◆ Hiveory DEV    ∿ ◧ ┐┌ [Ada ×] [+] ──────────────┐┌ Dashboard ± ⟲ ⑂     ⤢  ◨ │ — □ × ┐
│ 🗓 Schedules          │                            │                               │
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
- Schedules page (main area, from the sidebar's Schedules, ADR 0062; every Workspace's): header (Schedules, ‹ › day or week, the range with a mini month, Today,
  Day · Week · List · Run logs, New schedule); the keep-awake switch; the calendar (Week first) (click an empty hour
  for a new schedule there, a run to edit its schedule); List: schedule rows; Run logs: status,
  schedule, who ("Claude Code · demo-app · main"), when, by you or the schedule, duration, why it failed.
- Message box (a Work agent in chat view, ADR 0058): above it, pills for the agent's tasks ("4/6
  tasks"), its subagents and the worktree's changes ("+1.9k −684", opens Changes); in it, `@` file and
  `/` command suggestions; toolbar "+" (files, picture of a window) · one agent picker (ADR 0064: a rail of
  CLIs with ★ starred models first · search, models with Ctrl+1–9, Show more · Reasoning levels · footer Standard |
  Fast, Plan mode, Read-only | Full access; the trigger shows CLI, model, effort and access) · context meter · usage
  limits (gauge and popover, ADR 0055) · send. A reply that changed files ends with "N files changed
  +a −d · View · Undo"; selected reply text offers Quote. While answering, the box stays open, a queue button sits beside Stop, and
  waiting messages list above the box ("Next" / "Then", each with ×) (ADR 0031).

### Settings › Keyboard (ADR 0047)

General (Find, Settings, shortcuts, sidebar, side panel, maximize side panel, Schedules), Lists (New worktree,
Next / Previous worktree), Panes and tabs (New tab, New terminal, Close, Next / Previous tab, Next /
Previous area, Maximize, Split right / down, Find in the terminal), Chat (Type in the message box): each row shows its keys
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
agents. Pane "+": `( → Right | ↓ Bottom )`, search, Browser, Chat (Chat UI: a chat on the CLI last
picked in a chat; its CLI and model change in the message box, ADR 0059), Terminals, Agents (each in
its terminal).

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

The Workspace page is the **Dashboard** tab of the side panel beside the open Worktree (ADR 0038, 0039). It has no
New worktree button.

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

Schedules (ADR 0040, 0055; in the main area since ADR 0062): every Workspace's schedules: Week · Day · List · Run
logs, the calendar, the keep-awake switch, New schedule (the editor asks for the Workspace, then its worktree and
CLI; an empty hour on the calendar starts one there).

Workspace settings (ADR 0037; in Settings since ADR 0062: a workspace's right-click › Workspace settings, or Settings'
Workspaces list under its sections): General (Name, Icon and color, Folder, Repository) · Agents (Announce agents) · Chat agents start with (model and
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
Tabs (one bar, the selected pill holds icon and label; ADR 0039, 0056) ─ Home ─ Work ─ Settings
Work › Workspace (its mark; header: Pull requests · Schedules · Settings; Worktrees (Primary tagged), + New: New | Existing | Remote branch; Needs you | Working | Idle tabs) › Worktree (branch and changes, Open an agent sheet with Terminal | Chat) › Agent
Workspace › Schedules (its Schedules, rule and last run, Run now, + New) › Schedule (name, instructions, Workspace · Worktree · CLI, repeat and time, On, Run now, Delete, recent runs)
Workspace › Pull requests (worktree branches with Create PR, open pull requests; GitLab's merge requests too) · Workspace › Settings (the computer's Settings tab, ADR 0037; Order: Pin to the top)
Worktree › branch row › Changes (Uncommitted | Branch; branch · totals · Push / Publish; Commit: message, Commit, Commit & push; Files: tap for its diff, undo to discard; ADR 0060)
Settings › Agents › Usage (Today | 7 | 30 | 90 days; Total, Output, From cache; tokens per day; By CLI; By model; ADR 0060)
Agent: header (CLI logo, pet name, status pill, ⋯ actions) · terminal or chat (markdown) · needs-you bar (Esc / Enter)
  terminal: a box typed straight into the CLI (keyboard Enter adds a line) · key row [/ Esc Tab ↑ ↓ ……… ⏎] (⏎ fixed right, sends)
  chat: queued messages and attached files · model and effort · message box (attach a file, saved prompts)
Welcome (3 steps) › Pair (QR scanner · or address + code)
App-wide: SSH question sheet · notices · notification taps
```

### Side panel Changes (ADR 0058)

Branch · refresh; source (Uncommitted, Branch, One turn, Commits ›) · totals · file count; the tree
(folders with summed counts, single-folder chains joined; files with +/−, a status mark, a pencil to
open in an editor pane; click to open its diff in place); Commits (collapsible, the branch's commits).
Uncommitted only: an undo button per file (Discard, confirmed) and the commit bar at the bottom: message
(Ctrl/⌘+Enter commits, +Shift also pushes) · Commit · Commit & push ……… Push N / Publish branch (ADR 0060).

### Find (ADR 0060)

Ctrl+Shift+P (⌘K) or the sidebar footer's search button (also on the rail): a dialog near the top, a
search box over titled sections (Open here, This worktree, Run script, Side panel, Go to, Commands, Lists,
Panes and tabs, Chat, Settings, ADR 0060 amendment); each row: section icon · name · short hint ……… keys, and ↵ on
the chosen row. Footer: ↑ ↓ choose · Enter open · Esc close.

### Settings › Usage (ADR 0060)

Period (Today | 7 days | 30 days | 90 days) · refresh; tiles: Total tokens (replies · conversations),
Input, Output, From cache (% of input); Tokens per day (a bar per day, hover or focus for its count);
By CLI and By model tables (input, output, cache read, cache write, replies). Empty: "No usage yet".

Sidebar: a Workspace's menu has Pin to top / Unpin; pinned Workspaces come first.

### Native desktop (ADR 0061)

Settings › Agents › Notifications: Desktop notifications (Needs you, finished, stopped | Only when an
agent needs you | Off). Workspace settings › Scripts: each script's name, command, every-new-worktree toggle (branch-plus), Run and Remove; a
name field, a command field and Add (problems shown under it). Pane "+": Browser · Chat UI · Scripts ·
Terminals · Agents. Find: Open here › Copy a link to this worktree; Run script › <name>. Phone: Open an
agent › Scripts; Workspace settings › Scripts (Add a script sheet: name, command; Edit: every new worktree on/off, Remove).
