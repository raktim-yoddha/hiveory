# Bots automation: Routines, Triggers, Tasks, Team map

Research and integration plan. It follows `docs/plans/remote-and-bots.md` and ADR 0022, and
needs an ADR before it is built (rule 22): parts of it touch rule 9 ("no work history") and
product-spec's non-feature "task history".

Status: **proposal**. Nothing here is built yet.

---

## 1. What the reference products do (checked 2026-10-07)

### 1.1 OpenMausBot (mausbot.com, github.com/milind-soni/OpenMausBot, Apache-2.0)

The three screenshots in the request are OpenMausBot's **Triggers**, **Routines** and **Team map**.

**Routines** (`server/routines.ts`, `docs/routine-schedules.md`)
- A routine is `{ name, prompt, botId, enabled, schedule, timeoutMinutes?, continuity?, overlap }`.
- Schedules: `once { at }`, `daily { time, weekdays }`, `interval { everyMinutes, weekdays?, window?, endsAt? }`,
  `cron { expr, timezone }`. Cron uses Croner (5 fields, IANA zone required, no seconds, no macros,
  no shell). The preview and the scheduler use the same calculation.
- Every run opens a **fresh thread** on the bot, using the bot's current engine, model and computer.
- A run is a receipt: `{ routineId, prompt snapshot, trigger: schedule | manual | webhook,
  scheduledFor, status: queued | running | waiting | completed | failed | cancelled | missed }`.
  The snapshot means editing a routine never rewrites history.
- **Continuity** (optional): the previous run's report goes into the next run's prompt.
- **Overlap**: `skip` (default) or `queue` (at most one pending scheduled run).
- **Catch-up**: up to 12 hours late, one missed occurrence runs; older ones get a `missed` receipt.
  It never replays every missed minute.
- Runs only while the app is open. **Keep this computer awake for routines** (on by default):
  while plugged in, it blocks idle sleep for the hour before a due routine and while one runs.
  A closed lid still sleeps. For 24/7, run the app on a VPS.
- A bot can ask to schedule in plain language ("report at 9 am on the 1st, Asia/Kolkata"). It
  writes a cron rule, the app validates it, and a **confirmation card** shows the rule, its zone and
  the next three dates. Nothing is scheduled until the user confirms.
- UI: Day / Week / List calendar, a "My bots" rail (drag a bot onto a time to schedule it),
  **Run logs**, **Webhooks**, and a bot filter. Imported routines start paused.

**Triggers / webhooks** (`server/webhooks.ts`, `server/webhook-ingress.ts`, `TriggersPanel.tsx`)
- "When *source* → *bot* should *prompt*". Sources: *Another app sends a link request*, Typeform,
  Zapier, GitHub, Stripe, Custom. They are all the same private URL with a secret underneath; the
  source is only a label and a template.
- A delivery queues a routine run (`trigger: "webhook"`) with the payload attached.
- Hardening: the secret is stored only as a SHA-256 hash and compared in constant time, the body
  is capped at 256 KB, 10 requests a minute, at most 3 unfinished runs per webhook (429 after),
  idempotency by delivery id, a test delivery before it goes live, and the secret can be rotated.

**Tasks**
- In OpenMausBot, "tasks" are a bot's **separate contexts** (each keeps its own transcript and
  engine session). Hiveory already has this: bot **threads**.
- Their planned **delegation task board** (`docs/superpowers/plans/2026-08-31-07-delegation-task-board.md`)
  turns each `delegate_bot` handoff into a durable work item: `{ title, brief, fromBotId | user,
  ownerBotId, threadId, parentId, depth, status, dueAt?, artifacts[], reviewerBotId? }` with
  statuses `queued | running | blocked | done | failed | cancelled`, terminal states final. They
  wrote it because "the team map shows who talks to whom, not who owes what".

**Team map** (`TeamMapPage.tsx`, `TeamCanvas.tsx`, `lib/team-map.ts`)
- Bots grouped into **teams** (named sections; *General* by default; each team has at most one
  Chief). A canvas you can pan and zoom: drag within a team to arrange, drop on another team to move.
- **Edges** show bot-to-bot links, with state `connected | queued | running` and a reason. Clicking
  an edge opens that conversation.

### 1.2 BridgeMind One (docs.bridgemind.ai, bridgemind.ai/changelog)

- **Routines**: pick the agent, a name, an instruction and a schedule (daily, weekly or interval),
  then save after seeing the next run time. Each run opens a fresh chat. Rows offer Run now,
  Pause/Resume, Edit, Open last and Delete; errors show on the row. Routines run only while the app
  is open, with no exact-time promise. **Routine scheduling is a per-agent permission**, separate
  from messaging and plugins. The guidance: routines should gather, analyze, draft and prepare,
  and keep irreversible actions behind approval.
- **Tasks board** (v0.3.3, 2 Oct 2026): To Do · In Progress · Review · Done. Drag a card onto an
  agent's terminal, a thread or an Agent chat to send it as the next prompt (To Do moves to In
  Progress once the agent has it), or use *Send to*, or *Dispatch* it to a saved coding agent
  that works on its own branch while a second session reviews it. Stopping the run returns the
  task to To Do.
- **Saved prompts** (v0.3.4): a Prompts tab. Drag a prompt into any agent's input.
- **BridgeAgent** (its earlier product) had "the agent map" and "scheduled responsibilities".

### 1.3 Where they agree

| Idea | OpenMausBot | BridgeMind | Hiveory today |
|---|---|---|---|
| Routine = prompt + schedule + bot; each run opens a fresh thread | ✔ | ✔ | — |
| Runs only while the app or its server is up, no exact-time promise | ✔ | ✔ | Hiveory server exists (S1–S2) |
| Per-bot permission to be scheduled | — | ✔ | — |
| Run now / pause / edit / last run / errors on the row | ✔ | ✔ | — |
| Webhook triggers | ✔ | — | — |
| Board of work owed between bots | planned | ✔ | delegations exist, not shown |
| Map of the team | ✔ | ✔ (BridgeAgent) | Chief + messaging flags only |

---

## 2. What Hiveory already has to build on

- **`BotService.newThread(botId, title)` + `start(thread, text)`** (`src/main/services/bots/bot-service.ts`).
  This is a routine run already. `delegate()` uses it today.
- **`ChatSession.delegation { fromChatId, fromBotId, depth }`**: every handoff is already recorded
  on its thread. These are the team map's live edges and the board's rows, with no new store.
- **Thread status** `idle | working | waiting-for-you` from `ChatService`. It maps a run to
  `running` / `waiting`, and back to idle when the run ends.
- **Hiveory server mode** (`src/main/app/server.ts`, ADR 0022 S1–S2): main services run on a
  server. A scheduler that lives in main runs 24/7 there for free.
- **Tailnet** (ADR 0025) and the paired-device HTTP server: a place to receive webhooks without
  opening a port to the internet.
- **Composio apps** (ADR 0023): the user's own Composio key. Composio also offers app *triggers*
  (new Gmail message, GitHub PR, …), which would avoid the need for a public URL.
- **Queen Bee** understands "go to bots"; "go to routines" and "pause routine X" fit her closed action set.

Missing: a scheduler, `croner` (or an equivalent), any keep-awake (`powerSaveBlocker` is not
used), any ingress for outside events, and a store for routines and runs.

---

## 3. Proposal for Bots mode

### 3.1 Routines (phase A1, the core)

```ts
// src/shared/domain/routine.ts
type RoutineSchedule =
  | { kind: 'once'; at: string }                                  // ISO
  | { kind: 'daily'; time: string; weekdays: number[] }            // "09:00", 0 = Sunday
  | { kind: 'interval'; everyMinutes: number; window?: { start: string; end: string } }
  | { kind: 'cron'; expr: string }                                 // 5 fields, validated
interface Routine {
  id: string; name: string; botId: string; prompt: string
  schedule: RoutineSchedule; timezone: string                       // IANA
  enabled: boolean                                                  // created from a bot or an import: false
  continuity: boolean                                               // feed the last report into the next run
  createdAt: string; updatedAt: string
}
type RunTrigger = 'schedule' | 'manual' | 'trigger'
type RunStatus = 'running' | 'waiting-for-you' | 'completed' | 'failed' | 'missed' | 'skipped'
interface RoutineRun {
  id: string; routineId: string; botId: string; trigger: RunTrigger
  prompt: string                                                    // snapshot
  scheduledFor: string; startedAt?: string; endedAt?: string
  threadId?: string; status: RunStatus; error?: string
}
```

- `Bot` gains `routines: boolean`, **off by default** (BridgeMind's per-bot permission).
- `RoutineScheduler` (`src/main/services/automations/routine-scheduler.ts`): one timer armed for
  the next due run (never a polling loop), re-armed on change, on resume from sleep
  (`powerMonitor 'resume'`) and on clock change. A run calls `bots.newThread` + `start`.
- Rules (from OpenMausBot): overlap = skip; catch-up one missed run within 12 h, older ones become
  `missed`; DST gaps move forward; a repeated hour runs once; a missing bot or engine fails the run
  with the reason on the row.
- `croner` (zero dependencies) is the one date engine, shared by the preview and the scheduler.
  Writing DST-correct daily, weekday and cron maths by hand is how scheduled jobs end up firing twice.
- **Keep awake**: `powerSaveBlocker.start('prevent-app-suspension')` for the hour before a due
  run and while one runs, only when `!powerMonitor.isOnBatteryPower()`. A setting, on by default,
  with OpenMausBot's honest copy ("a closed lid still sleeps").
- Persistence: `PersistedState.routines`, plus runs in their own file capped at the last 500,
  each record validated on its own (as bots are).
- IPC: `routines.list | create | update | delete | runNow`, `routines.runs`, plus a change event.
- **Hiveory server**: the scheduler runs wherever main runs. "Run on: this computer / my Hiveory
  server" falls out of the existing server mode, with no second scheduler.

### 3.2 Routines UI (A2)

Matches the screenshot, built from shared tokens and components:
- **Routines** entry in the Bots sidebar footer (with Triggers and Team map).
- Calendar: Day / Week / List, a mini month, a now line, the timezone label, and a bot filter.
  "My bots" rail: drag a bot onto a slot to open the editor prefilled with that bot and time. A
  calendar drag only creates; editing a cron series goes through the editor (OpenMausBot's rule).
- Editor: bot, name, instruction, schedule (Once · Daily · Weekdays · Interval · Monthly · Custom
  cron), timezone, continuity, and a preview of the **next three runs**.
- Row and event actions: Run now, Pause/Resume, Edit, Open last run (the thread), Delete.
- **Run logs**: newest first, with status, trigger, duration and a link to the thread.
- Calendar and run log are presentational. A `useRoutines` hook owns the IPC.

### 3.3 Bots schedule themselves (A3)

A `schedule_routine` bot tool posts a **confirmation card** in the thread (rule, zone, next three
dates). The routine is created only when the user confirms, and only if the bot has `routines`
on. Queen Bee gains "go to routines" and "pause/resume <routine>" (app state only, rule 27).

### 3.4 Triggers (phase T1)

"When *source* → *bot* should *prompt*", as in the screenshot.

- Model: `Trigger { id, name, source, botId, prompt, enabled, secretHash, maxPending: 3 }`. A
  delivery creates a `RoutineRun` with `trigger: 'trigger'`, so there is one run log and one engine.
- **Ingress choices** (decision needed, see §6):
  1. **Composio triggers** (recommended first). They use the user's existing key: Gmail, GitHub,
     Slack, Linear, Stripe and others, with no public URL.
  2. **Link request** on the tailnet or the Hiveory server's existing HTTP server. Tailscale Funnel
     or a VPS server makes it reachable by Zapier, Typeform and GitHub.
  3. **Local polling** for GitHub through `gh` (no ingress at all).
- Hardening (OpenMausBot's numbers): hashed secret with a constant-time check, 256 KB body,
  10 requests a minute, idempotency by delivery id, a test delivery first, rotate secret.
- **Prompt injection.** The payload is outside data. It goes into the prompt fenced and labelled as
  untrusted data, and **trigger runs start read-only** (`autoApprove: false`) unless the user
  turns on full access for that trigger. A webhook that drives a full-access bot is remote code
  execution with extra steps.

### 3.5 Tasks (phase K1): work the team owes

Hiveory bots already have threads (OpenMausBot's "tasks"). What is missing is the **board of
owed work**, so the proposal is a derived **Work board**, not a new manual task system:
- Each row is a delegated thread (`ChatSession.delegation`), a routine or trigger run, or an
  `ask_bot` call: owner bot, from (user, Chief, routine, trigger), live status (`working` /
  `waiting-for-you` / `idle` with outcome), started time and a link to the thread.
- **Columns follow real state** (rule 7): Working · Needs you · Finished recently. There is no drag
  to change status. "Finished recently" is a run log with retention, not a Done column; the ADR
  must decide whether that is allowed under rule 9 for Bots (it is not a Work Kanban).
- Optional K2 (BridgeMind's model): a *queued request* you drag onto a bot to send as its next
  prompt. That is a saved prompt, which the user may want in all three modes.

### 3.6 Team map (phase M1)

- **M1, derived, with no new data**: the Chief in the centre, bots around it, edges for who can
  reach whom (Chief → everyone, messaging ↔ messaging) and **live edges** for open delegation
  threads (`queued` / `running` / `waiting-for-you`). Clicking a bot opens it; clicking a live
  edge opens the thread. Zoom and pan come from the existing pane or canvas code, if any; plain CSS
  transforms otherwise.
- **M2, teams** (only if wanted): `Bot.team?: string` with *General* as the default, one Chief per
  team, drag to move between teams. This changes ADR 0022's "at most one Chief", so it is a
  product decision.

---

## 4. Scope in Work mode

Rules 7, 9 and 10 (no manual workflow, no history, no Task entity) rule out copying BridgeMind's
Tasks board into Work. What fits:
- **Workspace routines**: "every night at 2:00, in workspace *main*, open Claude Code and run:
  *run the tests and fix any flake*". A run opens an agent in that workspace, and its card moves on
  the Kanban by real CLI state. No new column, no history; the agent returns to Idle. Same
  scheduler, with target `{ kind: 'workspace', workspaceId, cliId }`.
- **GitHub trigger → isolated workspace**: a new issue labelled `agent` (Composio or `gh` polling)
  creates an isolated workspace from the issue, reusing `IssuePicker`'s workspace-create flow, and
  starts the preset. Opt-in per project.
- Saved prompts (drag into any agent's input) are reusable across Work, Bots and Chat.

## 5. Scope in Chat mode

- **Scheduled chats**: a routine whose target is "a new chat" with an engine and model instead of
  a bot (as in Claude's scheduled tasks). Cheap once A1 exists: the target is `{ kind: 'chat', cliId, model }`.
- Saved prompts as above. Nothing else; Chat stays the one-off conversation.

---

## 6. Decisions needed (ADR 0028)

1. Run logs and the "Finished recently" lane in Bots: allowed under rule 9 (scoped to Bots,
   retention capped)? *Recommended: yes, Bots only.*
2. Trigger ingress order: Composio first, link request on tailnet or server second, `gh` polling
   third? *Recommended: yes.*
3. Team map: derived (M1) only, or real teams with one Chief each (M2)? *Recommended: M1 now.*
4. Work and Chat: workspace routines and scheduled chats now, or Bots only first? *Recommended:
   Bots first; the scheduler takes a `target` union so Work and Chat are small follow-ups.*
5. Add the `croner` dependency? *Recommended: yes.*

## 7. Phases

| Phase | Scope | Depends on |
|---|---|---|
| A1 | Routine model, scheduler, keep-awake, runs, IPC, `Bot.routines` permission, tests (schedule maths, catch-up, overlap, DST) | — |
| A2 | Routines calendar (Day/Week/List), editor with next-3 preview, run logs | A1 |
| A3 | `schedule_routine` confirm card; Queen Bee actions | A1 |
| M1 | Derived team map with live delegation edges | — |
| K1 | Work board (derived from delegation threads and runs) | A1 |
| T1 | Triggers: Composio source, read-only runs, untrusted-payload fencing | A1 |
| T2 | Link-request ingress on tailnet or server, secrets, rate and pending limits, test delivery | T1 |
| W1 | Workspace routines (Work) and scheduled chats (Chat) | A1 |
| M2 | Teams (optional) | M1 |

## Sources

- OpenMausBot: <https://mausbot.com>, <https://github.com/milind-soni/OpenMausBot> (`server/routines.ts`,
  `server/webhooks.ts`, `server/webhook-ingress.ts`, `docs/routine-schedules.md`,
  `src/components/TriggersPanel.tsx`, `src/components/TeamMapPage.tsx`,
  `docs/superpowers/plans/2026-08-31-07-delegation-task-board.md`)
- BridgeMind: <https://docs.bridgemind.ai/docs/routines>, <https://docs.bridgemind.ai/docs/agent-mode>,
  <https://www.bridgemind.ai/changelog>, <https://www.bridgemind.ai/changelog/bridgemind-one/v0-3-3>
