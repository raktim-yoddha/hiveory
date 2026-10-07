# Bots UI wiring: "+" menu, bot panel (Computer · Routines · Browser), routine editor

How OpenMausBot's screens map onto Hiveory's existing code. It extends
`bots-automation.md` (routines, decided) and `bots-feature-scope.md` (scope). Every row names the
component, store, IPC and service it uses, reusing before creating (rule 1).

Status: **design**. Nothing here is built yet.

---

## 0. What exists today (the seams)

| Piece | Where | Notes |
|---|---|---|
| Bots screen | `features/bots/BotsScreen.tsx` | header (avatar, name, StatusDot, `ComputerMenu`, edit), thread tabs, `ChatMessages`, `ChatComposer` |
| Sidebar | `features/bots/BotsSidebar.tsx` | roster; a `+` that opens `BotEditor` (a modal) |
| Bot's Docker computer | `bots/bot-computer.ts` → `bots.computer` IPC; tools `desktop_*` (`desktop-tools.ts`) | start, stop, take control (noVNC on loopback) |
| This computer | `computer/computer-service.ts` + `computer-tools.ts` (`computer_*`) | global setting `computerUse`, Windows helper |
| Built-in browser | `browser/browser-service.ts` + `browser-tools.ts` (`browser_*`); `features/browser/BrowserPane.tsx` | global setting `browserUse`; profiles (`browserProfiles`) keep separate logins |
| Tools a bot thread gets | `app/container.ts` MCP handler | `botTools` + (`desktopTools` if `bot.computer`) + (browser if `browserUse`) + `extraTools()` (computer if `computerUse`, apps gateway) |
| UI parts | `components/ui/`: `Tabs`, `Menu`, `Modal`, `Select`, `TextField`, `Toggle`, `EmptyState`, `StatusDot` | reuse; no new primitives needed except a date/time row |
| Attachments | `chat.attach` IPC, `AttachmentChips` | reused for routine attachments |
| Results posted back into a thread | `BotService.pending` + the `[Result from …]` message | reused for "post results to" |
| Navigation | `stores/navigation.ts` (`mode: 'bots'`, `view`) | add Bots views: `bot`, `routines`, `triggers`, `team-map`, `apps` |

---

## 1. The "+" menu (sidebar header)

Replace the single `+` IconButton in `BotsSidebar` with the shared `Menu`:

| Item | Wires to | Phase |
|---|---|---|
| **New Bot** · `Ctrl N` | `useBotEditor.open('new')` (exists). The shortcut is registered in the existing shortcut hook, only in Bots mode | now |
| **New group chat** | Rooms (B2). Hidden until rooms exist; no disabled teaser (rule 22: no product decision yet) | Tier 3 |
| **Create team** | Teams (M2, approved 2026-10-07): `teams.create { name }` → a `Modal` with name + optional Chief. See §7 | Tier 2 |
| **Templates** | Preset bots first (a list of New bot defaults); team packages later. Opens a `Modal` gallery | Tier 1 / 3 |

The sidebar footer gets **Routines · Triggers · Apps · Team map**. Each one sets
`view: { type: 'routines' | 'triggers' | 'apps' | 'team-map' }` in Bots mode. **Apps** reuses the
existing Composio settings screen, rendered in place.

---

## 2. Bot header

| Control | Wires to |
|---|---|
| Engine icon (the ✳ button) | the existing chat model picker for the active thread (engine, model, effort); the default stays in settings |
| Monitor icon | toggles the **bot panel** (§3); the `ComputerMenu` dropdown folds into the panel's Computer tab |
| `…` | `Menu`: Edit (opens the panel's settings), Duplicate, Mark unread, Pin, Make Chief, Delete (the sidebar items, one shared `botActions(bot)` list) |
| Pencil next to the name | `InlineEdit` → `bots.update { name }` |

---

## 3. Bot panel (right side, Bots mode)

A new `features/bots/BotPanel.tsx`: a resizable right column (`ResizeHandle`, the same width
tokens as `SidePanel`). Not the Work `SidePanel`, which is workspace-scoped (rule 11), but the
same parts. Header: ⚙ (settings) · `Tabs` [Computer · Routines · Browser] · close. Its state (open,
tab, width) lives in `stores/bots.ts`, per bot.

### 3.1 ⚙ Settings

`BotEditor` stops being a modal and becomes the panel's settings view: accordion sections
(Overview · Identity · Soul · Skills · Memory · Routines · Access · Model · Permissions · Voice &
alerts), built incrementally per `bots-feature-scope.md`. New bot still uses the same form in a
`Modal` (one form component, two hosts).

### 3.2 Computer tab: "Works on"

**Model change:** `Bot.computer` (today: an optional Docker spec) becomes a **preference** plus
the Docker spec it already has:

```ts
// src/shared/domain/bot.ts
type WorksOn = 'auto' | 'container' | 'this-computer' | 'browser' | 'off'
interface Bot {
  worksOn: WorksOn                 // migrate: computer ? 'container' : 'browser'
  computer?: BotComputer           // unchanged: Docker here, or on an SSH host
  browserProfileId?: string        // its own logins (created on first use)
}
```

| Card (screenshot) | Hiveory meaning | Tool families the thread gets | Availability check |
|---|---|---|---|
| **Auto** | whatever the task needs, cheapest first: browser → container. **Never this computer** (decided) | browser + `desktop_*` (if a container is configured) | each family listed only if available |
| **Cloud computer** (Boat) | **"Server computer"**: Docker on an SSH host (`computer.host`). No Boat | `desktop_*` | `hosts.check` on the host |
| **Local VM** | Docker on this computer (`hiveory-computer:1`) | `desktop_*` | `docker` reachable |
| **This computer** | the user's real screen | `computer_*` | `computer.supported` + Settings › Computer use on; every action asks, whatever the approval level |
| **Browser** | the built-in browser only | `browser_*` with the bot's profile | always |
| **Off** | chat and apps only | none of the three | — |

Wiring: the MCP handler in `container.ts` stops reading the global switches directly for bot
chats and calls one pure function, unit-tested:

```ts
// src/main/services/bots/bot-reach.ts
export function botFamilies(bot: Bot, avail: { docker: boolean; computer: boolean; browser: boolean }): Array<'desktop' | 'computer' | 'browser'>
```

The global settings still act as a master switch (Settings › Computer use off = no bot can use
this computer). The **Overview "Can reach"** card (feature scope §2.1) is derived from the same
function, so the UI and the tools can't disagree.

**Screen preview** ("Poppy's screen"):
- Container: poll `desktop_screenshot` through a new `bots.screen { botId }` IPC every 2 s while the
  tab is visible and the computer is running; "Take control" opens noVNC (exists).
- This computer: a frame only while a thread of this bot holds a computer lease (never an idle
  peek at the user's screen); otherwise the text "Shown while Poppy is using this computer".
- Browser / Off: no screen; a pointer to the Browser tab.
- Start, Stop and state come from the current `ComputerMenu`, moved into the tab header.

### 3.3 Routines tab

The bot-scoped version of the Routines page:
- Header: **Routines** (count) · **Create schedule** → `RoutineEditor` prefilled with this bot ·
  **Run logs** → `RunLog` filtered to `botId`.
- List: `RoutineRow` (name, next run, enabled toggle, Run now, `…` edit/delete).
- Empty: `EmptyState` "No schedules yet." · **Open schedules →** sets
  `view: { type: 'routines', botId }` (the calendar with the bot filter set).
- If `bot.routines` (the permission) is off, Create asks once, inline, to turn it on.
- Data: `useRoutines(botId?)` over `routines.list` / `routines.runs` and the
  `routines.changed` event. `RoutineRow`, `RunLog` and `RoutineEditor` are shared with the
  calendar page (rule 2).

### 3.4 Browser tab

- Bot threads use the browser scope **`bot-<botId>`** instead of `chat-<threadId>` (one line in the
  MCP handler's `caller`), so every thread of a bot shares its pages and this tab can list them.
- New pages open in `bot.browserProfileId`. The profile is created on first use as "Bot: <name>"
  through `BrowserService.createProfile`, so the bot's logins stay apart from the user's.
- The tab renders the existing `BrowserPane` for the selected page, with a page strip above it.
  The user can sign in for the bot here; that is how a bot gets logins without passwords in chat.

---

## 4. Routine editor ("New event")

`features/routines/RoutineEditor.tsx` in a `Modal`. Field → model → behavior:

| Field | Model | Notes |
|---|---|---|
| Colour square + **Add title** | `name`, `color` (a token name from the calendar palette, never a hex value) | |
| **Starts** date + time | `startsAt` (local, plus `timezone`, the system zone by default) | native `<input type="date">` and `<input type="time">`, styled with tokens |
| **Repeat** | `schedule` | see below |
| **Advanced** | `timeoutMinutes?` ("no run limit"), `endsAt?`, `overlap: 'skip'` | collapsed by default |
| **Assign a bot** | `botId` | bot chips (reuse `BotAvatar`); only bots with `routines` on are selectable, others show "allow schedules" |
| **Post results to** | `resultsTo: 'dedicated' \| 'thread' \| 'run'` (+ `threadId`) | see below |
| Instructions | `prompt` | required |
| **Add attachment** | `attachments[]` | `chat.attach` (exists); files copied into the routine's folder; never in team exports |
| Run on: *Bot's current setup* / *Cloud computer* | **one option only**: the bot's current setup | the second card is Boat; Hiveory's equivalent is the bot's Works-on preference. Dropped |
| Footer note | — | "Runs while Hiveory is open on this computer. A run missed by less than 12 hours still happens when Hiveory is back. For 24/7, use a Hiveory server." |
| **Schedule routine** | `routines.create` → enabled | disabled until the title, bot and instructions are set |

**Repeat options → one stored shape.** Every preset compiles to cron, so there is one date engine
(`croner`), one DST behavior and one preview:

```ts
type RoutineSchedule =
  | { kind: 'once' }                                           // runs at startsAt
  | { kind: 'interval'; everyMinutes: number }                 // 5–1440, anchored at startsAt
  | { kind: 'cron'; expr: string; preset: RepeatPreset }       // preset only drives the editor's label
type RepeatPreset = 'daily' | 'weekdays' | 'weekly' | 'selected-days' | 'monthly' | 'yearly' | 'custom'
```

| Option | Compiles to (startsAt = Wed 7 Oct, 23:00) |
|---|---|
| Does not repeat | `once` |
| Every X minutes | `interval` |
| Daily | `0 23 * * *` |
| Every weekday | `0 23 * * 1-5` |
| Weekly on Wed | `0 23 * * 3` (the label follows startsAt's weekday) |
| Selected weekdays | `0 23 * * 1,3,5` + day chips |
| Monthly | `0 23 7 * *` (plus "Last day" → `L`) |
| Yearly | `0 23 7 10 *` |
| Custom cron | the user's text, validated (5 fields, no seconds or macros) |

`routine-schedule.ts` (pure, tested): `compile(preset, startsAt)`, `nextRuns(schedule, tz, n = 3)`
(the editor shows the next three), `validateCron(expr)`.

**Post results to**, reusing the delegation result path:
- *Create a dedicated results thread* (default): on the first run, create a thread titled
  "<routine> · results". Each run still runs in **its own fresh thread** (clean context); when it
  ends, `BotService` posts a dated `[Result: <routine>, Wed 7 Oct 23:00]` message into the results
  thread, exactly as delegation results return today. The run log links to the full run thread.
- *An existing thread*: the same, into a thread the user picks.
- *Only the run's own thread*: no summary message.

The results thread is a normal bot thread, so it shows unread, notifies, and can be read on the phone.

---

## 5. Main-side wiring (from A1)

```text
RoutineEditor ──routines.create──▶ RoutineService (validate, persist) ──▶ RoutineScheduler (re-arm one timer)
                                                                               │ due
                                                                               ▼
                       BotService.newThread(botId, "<routine> · <date>")  +  start(thread, prompt + attachments)
                                                                               │ chats 'run' event (running/idle)
                                                                               ▼
                       RoutineRun status ─▶ routines.changed ─▶ useRoutines (panel, calendar, run log)
                                                                               │ ended
                                                                               ▼
                       post result to resultsTo thread (BotService pending/result path)
KeepAwake (powerSaveBlocker, on AC only): armed 60 min before the next due run, released when idle
```

New files: `shared/domain/routine.ts`, `main/services/routines/{routine-service,routine-scheduler,routine-schedule,keep-awake}.ts`
plus tests, `renderer/stores/routines.ts`, `renderer/features/routines/{RoutinesPage,RoutineEditor,RoutineRow,RunLog,WeekCalendar}.tsx`,
`renderer/features/bots/{BotPanel,ComputerTab,BrowserTab,RoutinesTab}.tsx`, `main/services/bots/bot-reach.ts`.
IPC: `routines.list | create | update | delete | runNow | runs`, `bots.screen`; event `routines.changed`.
Validation: zod in `contract.ts` (cron text bounded, minutes 5–1440, prompt ≤ 24 KB, at most 50
routines per bot).

## 6. Order

1. `bot-reach.ts` + `worksOn` migration + Computer tab (moves `ComputerMenu` in). Small, and it fixes
   today's coupling to global switches.
2. Bot panel shell (Tabs, resize, state) + Browser tab (scope `bot-<id>`, per-bot profile).
3. A1: the routine model, scheduler, keep-awake, IPC, tests.
4. RoutineEditor + Routines tab + run log; then the calendar page (A2).
5. "+" menu: New Bot + `Ctrl N`, Templates (preset bots). Group chat stays hidden until rooms exist.
6. Teams (§7) + the team map with team cards.

## 7. Teams (M2, approved 2026-10-07)

```ts
// src/shared/domain/bot.ts
interface Team { id: string; name: string; createdAt: string }   // PersistedState.teams; "General" always exists
interface Bot { teamId: string /* migrate: General */ }
```

- **One Chief per team**, replacing ADR 0022's "at most one Chief". Making a bot Chief clears the
  previous Chief *of that team* only. A file with two Chiefs in one team keeps the first.
- **Reach**: a Chief reaches the bots in its own team. Messaging bots still reach other messaging
  bots in any team, and the Chief of General may reach other teams' Chiefs (a hand-off between
  teams goes Chief to Chief). Same depth and hourly limits. `reachable()` is the one place this
  lives, and it is tested.
- **Sidebar**: bots grouped under team headings (collapsible, team order persisted), Chief first.
  The right-click menu gains "Move to team ▸".
- **Team map**: one card per team (the screenshot's "General" card), with the Chief at the top and
  live delegation edges inside and across cards. Drag a bot within a card to arrange it, or onto
  another card to move it (`bots.update { teamId }`). Positions are stored per team. These drags
  change membership only, never status (rule 7 is about CLI status, so it is not touched).
- **Team actions** (`…` on the card): rename, delete (bots move to General; refused while a team's
  bot is working, as OpenMausBot does), and later Share team (packages).
- **Routines and triggers** stay per bot. The calendar filter gains "Team".
- IPC: `teams.list | create | rename | delete`, plus `bots.update { teamId }`. ADR 0028 records the
  change to ADR 0022.

## Decisions (2026-10-07)

- **Create team**: real teams (M2), §7.
- **This computer under Auto**: never. Auto picks only the browser and the Docker computer; the
  user's real screen needs Works on = **This computer**, chosen explicitly.
