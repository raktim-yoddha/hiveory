# ADR 0028 — Bots automation: routines, triggers, teams

Builds on ADR 0022 (Bots mode). Research and plans: `docs/plans/bots-automation.md`,
`docs/plans/bots-feature-scope.md`, `docs/plans/bots-ui-wiring.md` (OpenMausBot, BridgeMind, Grok
Bot, OpenAI dots, Claude Cowork, OpenClaw, Hermes Agent, Lindy).

## Decisions (product owner, 2026-10-07)

1. **History in Bots only, capped.** Run logs (and later usage and change journals) are allowed in
   Bots mode, bounded. Rule 9 and the "task history" non-feature still hold for Work's Kanban.
2. **Triggers arrive through Composio**, delivered to a **public link over Tailscale Funnel** (decided
   2026-10-08, after finding that Composio supports only HTTPS webhook delivery; its no-URL stream is
   prototype-only). Trigger runs are read-only and treat their payload as untrusted data.
3. **Real teams** (one Chief per team) replace ADR 0022's single Chief, with a team map of team cards.
4. **Bots first.** Workspace routines (Work) and scheduled chats (Chat) follow on the same scheduler.
5. **`croner`** is the one date engine, for the editor's preview and the scheduler.
6. **Auto never reaches the user's screen** (ADR 0022 amendment, "Works on").

## Routines (built: phase A1)

- **Model** (`src/shared/domain/routine.ts`): name, bot, instructions, schedule, start, IANA
  timezone, optional end and time limit, enabled, and `checkedThrough` (occurrences up to it are
  handled). Schedules are `once`, `interval` (5–1440 minutes from the start) or five-field `cron`;
  the editor's presets (daily, weekdays, weekly, selected days, monthly, last day of the month,
  yearly) compile to cron at the start's wall-clock time (`routine-schedule.ts`). No seconds,
  years, @macros or shell. At most 50 routines per bot.
- **Permission:** `Bot.routines`, off by default. Creating a routine for a bot needs it; a bot that
  loses it skips its scheduled runs with a reason. "Run now" is the user's own action and works anyway.
- **Scheduler** (`RoutineService`): one timer for the next due run, sleeping at most 5 minutes, and
  re-checked on resume and on mains-power changes. Each run opens a fresh thread on the bot
  (`BotService.newThread`) and sends the instructions after a line saying it is a scheduled run.
  The run ends with the thread's turn: `completed`, or `failed` with the engine's error.
- **Rules (from OpenMausBot):** a run missed while Hiveory was closed or asleep still happens if it
  is less than 12 hours late; older ones become a `missed` receipt; a series never replays every
  occurrence it slept through. A run due while the previous run of the same routine is going is
  `skipped`. A time limit stops the turn. A changed schedule, or switching a routine back on, starts
  from now. Runs a closed app left going are marked failed at the next start. `once` switches itself off.
- **Run log:** `PersistedState.routineRuns`, newest first, at most 500. A run snapshots the routine's
  name and instructions, so edits and deletes never rewrite history. Deleting a bot deletes its
  routines; the log stays.
- **Keep awake:** `keepAwakeForRoutines` (on by default). While plugged in, Electron's
  `powerSaveBlocker` holds the computer awake for the hour before the next run and while one runs.
  A closed lid still sleeps and nothing wakes a computer: for 24/7, run Hiveory as a server.
- **Where it runs:** wherever the services run. A desktop paired with a Hiveory server runs no
  services, so routines run once, on the server.
- **IPC:** `routines.list | create | update | delete | runNow | runs` (all remote-allowed), and
  `state.changed` with topic `routines`.

## Routines UI and results (built: phase A2)

- **Results:** a routine posts a dated summary of each finished run (its last reply, cut at 6,000
  characters, or why it failed) into a results thread: a dedicated "<name> · results" thread made on
  the first result, or a bot thread the user picks; or nowhere ("only each run's own thread").
  `ChatService.note()` adds the message without starting a turn, so posting never wakes the bot.
- **Editor:** times are this computer's timezone; a routine saved in another zone moves to this one
  when it is saved (zones are compared by their current offset, so aliases such as Asia/Calcutta and
  Asia/Kolkata count as the same). Presets compile to cron at the chosen time; a preset rule's own
  hour and minute are what the editor shows and what runs.
- **Screens:** the Routines page (Week · List · Run logs, bot filter, keep-awake switch), the bot
  panel's Routines tab, and the "Runs on a schedule" switch in the bot editor. Layout in `ui-map.md`.
- **Not yet:** attachments on a routine, the Day view, the mini month and dragging a bot onto the
  calendar.

## New bot menu (built)

The bots sidebar's "+" is a menu: New bot (Ctrl N / ⌘N, listened for only while the bots sidebar is
mounted, never inside an open dialog) and Templates. Templates are starter bots shipped in code
(`features/bots/bot-templates.ts`): a name, a brief that says what it owns and when it stops, its
Works on choice and whether it is meant for a schedule. Picking one opens the bot editor filled in;
nothing is created until the user saves. They name no real person or account (rule 27). Sharing and
importing whole teams comes later.

## Teams and the team map (built: phase M2)

- **Model:** `PersistedState.teams` (`Team { id, name, createdAt }`), General (`id: general`) always
  first and never deleted (it can be renamed). `Bot.teamId`; bots saved before teams, or of a missing
  team, load into General.
- **One Chief per team** (`oneChiefPerTeam`, used by the file loader and team deletion). The first bot
  in a team leads it; making a bot Chief clears only its own team's Chief; a bot that moves leads its
  new team only if that team has none (a Chief moving into a led team steps down).
- **Reach** (`BotService.reachable`): a Chief reaches its own team; Chiefs reach General's Chief and
  General's Chief reaches them, so work crosses teams Chief to Chief. A bot that allows messaging
  reaches other such bots in any team, and its own team's Chief. Delegation limits are unchanged.
  `list_bots` names each teammate's team, and a Chief's preamble names the team it leads.
- **Deleting a team** moves its bots to General (its Chief steps down if General has one), and is
  refused while any of its bots has a conversation running.
- **UI:** "+" › Create team; sidebar grouped by team (foldable headings when there is more than one
  team); a bot's right-click menu has "Move to <team>" (the keyboard way to move, on the map too);
  the bot editor has a Team choice; the team map (sidebar footer) shows a card per team, Chief
  first with engine and status, drag a bot onto another card to move it, rename or delete a team from
  its card, and a Handoffs list (delegated or consulted threads going now or in the last day; click
  to open). IPC: `teams.list | create | rename | delete`, `bots.handoffs`.
- **Not yet:** a free-form canvas with zoom, arranging bots inside a card, and drawn lines between bots.

## Bots schedule themselves; run notifications (built: phase A3)

- **Tools** (`RoutineTools`, only for a bot allowed to run on a schedule): `list_routines` and
  `schedule_routine` (name, instructions, first run as ISO 8601 with an offset, repeat as once /
  interval / a preset / cron, optional days and timezone, defaulting to this computer's). Presets
  compile with the editor's `compileRepeat`, so a bot's routine reads like one made by hand.
- **Always paused.** A routine a bot saves is created switched off, and the tool tells the bot to say
  so. The user turns it on in the Routines tab: a bot can never put itself on a schedule. This
  replaces the confirm card first planned: no new chat UI, same safety.
- **Notifications:** when a run ends (done or failed) or is missed while no Hiveory window is focused,
  a desktop notification names the routine and the bot (the user's own names, on their own screen;
  skipped runs stay quiet). Clicking it brings Hiveory forward, switches to Bots and opens the run's
  thread (`bots.open` event).
- **Fix:** croner's `startAt` left out a run at exactly the start time (the first run a user picks).
  The scheduler no longer passes it and applies the start itself.

## Overview, blurb, notifications and skills per bot (built)

- **Overview tab** (first in the bot panel): **Does** (team role, routines on or paused and the next
  run, memory), **Can reach** (from `botReach`, so it matches the tools; apps; its folder; who it can
  contact; full access) and **Won't** (no edits without approval, no schedule, not your screen, no
  messages), plus a **prompt preview** (`bots.preview`: the exact first-turn preamble, with its size)
  and the bot's **skills**.
- **Blurb** (`Bot.blurb`, at most 140 characters): one line shown in the sidebar and given to other bots
  by `list_bots` instead of the brief's first line. Templates fill it from their summary.
- **Notifications** (`Bot.notify`, on by default): a desktop notification when the bot replies in a
  thread the user started, or when one of its routines ends or is missed, only while no Hiveory window
  is focused. Delegated threads report to the bot that asked, not to the user; routine run threads
  are announced once, as runs.
- **Skills:** a bot's folder is its engines' project, so its CLIs already load skills from there. The
  Skills panel takes a bot as its scope (`extensions.scan | createSkill | importSkill` accept `botId`);
  a new or imported skill goes into the bot's own folder unless the user picks "Everywhere".

## Triggers (built: phase T1)

- **Delivery:** Composio posts each event to the project's one webhook subscription. Hiveory points it
  at `https://<this computer>.ts.net/hiveory/<32 random hex>`, published with Tailscale Funnel to a
  listener on 127.0.0.1 only (`TriggerIngress`): POST to that path only, 256 KB at most, 60 a minute.
  The link is re-published at each start (new port) and taken down on quit.
- **Trust:** every delivery is checked against Composio's signature (HMAC-SHA256 over
  `id.timestamp.body` with the subscription secret, sealed at rest) and must be under five minutes
  old; repeats (by webhook id) are dropped; unknown or paused triggers are ignored.
- **The project's webhook is the user's.** Composio allows one subscription per project and shows its
  secret only at creation or rotation. Hiveory creates it when there is none; if the project already
  sends its webhook elsewhere, Hiveory stops and says so, and repoints it (rotating the secret) only
  when the user confirms.
- **A run:** `RoutineService.runEvent` opens a fresh, **read-only** thread on the trigger's bot (whatever
  its default access) with the event fenced in `<event>…</event>` as data it must never take orders
  from (cut at 8,000 characters; a closing tag inside is defused), then the user's instructions. At most
  three runs of one trigger at once; more are logged as skipped. Runs share the run log and the
  notifications with routines. A bot must be allowed to work on its own ("Runs on a schedule").
- **Triggers** (`PersistedState.triggers`): name, bot, instructions, app and account, Composio's event
  type and its settings (the type's config schema as simple fields), and its trigger instance; on/off and
  delete go to Composio too. A deleted bot's triggers are deleted.
- **UI:** the Triggers page (sidebar footer): the event link card (on, off, what is wrong and the page
  that fixes it, taking over the project webhook), "When [account] [event] → [bot] should [instructions]"
  with the event's fields, and the list. IPC `triggers.*`; publishing the link stays local (not a
  remote channel), and `triggers.openFix` opens only a tailscale.com page main chose.
- **Not verified live:** a real Funnel and a real Composio delivery (this machine has no Tailscale);
  covered by tests, including deliveries over a real loopback socket.

## Work board (built: phase K1)

- Derived, no new data (`features/bots/work-board.ts`): handoffs (`bots.handoffs`) and routine and
  trigger runs (`routines.runs`). Columns follow real state (rule 7): **Working** (a running handoff or
  run), **Didn't finish** (failed, missed or skipped, with the reason) and **Done**. Finished work
  stays 24 hours: Bots-only, capped history (decision 1), not a Done column on Work's Kanban.
- Each row: who asked (a bot, a routine or a trigger) → the bot, the title, when; it opens its thread.
- K2 (queued requests dropped on a bot) is not built.

## Queen Bee (built)

- `navigate {to: 'bots', page}` opens the work board, Routines, Triggers or the team map ("open the
  work board", "go to routines").
- `switch-automation {automationId, on}` pauses or resumes a routine or trigger by the user's own name
  ("pause Morning brief", "turn the New issue trigger back on"); a routine and a trigger with one name
  get a question, and an agent with that name wins ("stop Bruno"). Her context lists names, kinds and
  on/off only, never instructions (rule 27). A model's plan asks first; Undo flips it back. Main's own
  checks still apply (a past one-off can't be turned on).

## Next

The calendar's day view, mini month and drag-a-bot are built (Routines page). Deferred: routine attachments;
container gaps against OpenMausBot (Podman, a pinned image, accessibility-tree control, shared seats);
approval levels and the sending-on-your-behalf gate; K2 queued requests; Work and Chat routines.
