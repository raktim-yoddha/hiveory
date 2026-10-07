# Bots feature scope: OpenMausBot and the market, mapped to Hiveory

Companion to `docs/plans/bots-automation.md` (routines, triggers, tasks, team map; decided
2026-10-07). This file covers **everything else** in OpenMausBot's bot settings, plus ideas from
the wider market, and says for each one: what Hiveory has today, what to build, the size, and any
rule it touches.

Status: **analysis**. Every new behavior still needs an ADR (rule 22).

Size: **S** ≤ 1 day · **M** 2–5 days · **L** > 1 week. Status: ✔ have · ◐ partial · ✗ missing.

---

## 1. Market map (October 2026)

| Product | Shape | What stands out |
|---|---|---|
| **OpenMausBot** (open source, Apache-2.0) | A roster of bots in a chat app, using local `claude` / `codex` / `grok` CLIs | Chief of Staff, routines calendar, webhooks, team map, rooms, team packages, voice calls, MCP server, phone |
| **Grok Bot** (xAI, Aug 2026) | Named bots sharing **one** cloud computer | Group chats of 2–6 bots that pass ownership; teach once → skill → routine (up to 50 per bot) |
| **OpenAI dots** (29 Sep 2026) | Always-on agent inside ChatGPT, with its own cloud computer | Keeps working between conversations; 4,000+ app plugins; pauses itself when it detects malicious instructions |
| **Claude Cowork** (GA Apr 2026) | A desktop agent on your files | Dispatch from the phone, scheduled tasks (`/schedule` or a form), live artifacts that refresh from connectors |
| **BridgeMind One** | Agent / Code / Chat modes | Per-agent permissions for routines, messaging and plugins; Tasks board; saved prompts; phone approvals |
| **OpenClaw** (open source, MIT) | A personal agent behind messaging apps | **Heartbeat**: every N minutes it reads `HEARTBEAT.md` and replies `HEARTBEAT_OK` when there is nothing to do; ClawHub skill registry; Telegram, WhatsApp and Slack channels |
| **Hermes Agent** (Nous Research) | A self-improving agent | Writes skills from what worked, refines them, searches past sessions; cron delivered to any channel |
| **Lindy** | No-code agents, 3,000+ integrations | Agents defined by outcome ("qualify leads"), phone and voice agents, credit pricing |

**What everyone converges on:** a persistent identity separate from the engine · memory you can
edit · skills · connected apps · its own computer · schedules · approvals · the phone. Hiveory
already has identity, engines, a Docker computer, Composio, the phone and a server. **The gaps are
automation, governance and visibility**, not the core.

**Where Hiveory can win:** it is the only one that is also a real development environment (Work
mode: worktrees, panes, Kanban) and the only one with SSH and Docker hosts for both coding and bots.
Bots that can **open a workspace and ship code** are a story none of the others can tell.

---

## 2. OpenMausBot bot settings, panel by panel

### 2.1 Overview

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| **Setup ideas** checklist (name/role, instructions, folder, schedule/trigger) | ✗ | Checklist derived from the bot's fields; each row jumps to its section | S |
| **Set up with the bot** (the bot interviews you, then proposes a profile) | ✗ | A thread with a setup prompt; the bot calls `propose_profile` → a confirm card (same pattern as `schedule_routine`) | M |
| **Does / Can reach / Won't** summary | ✗ | Plain sentences derived from config: schedules, folders, apps, computer, approval level, "won't act on a schedule". Pure function, unit-tested | S |
| **Prompt preview** (bytes ≈ tokens) | ✗ | `BotService.preamble()` already builds it; expose it read-only with a size | S |
| **Recent changes** (who changed what, with undo) | ✗ | A profile change journal (user, bot or Chief), last N, revert one | M |

### 2.2 Identity

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| Avatar: mascot, shape, expression, colour, body | ◐ `BotAvatar` tiles from tokens | Let the user pick colour and shape from token palettes. No new art system | S |
| Upload an image (PNG/JPEG/GIF/WebP, ≤ 10 MB) | ✗ | Copy into the bot folder through main, re-encode and cap the size | S |
| Generate an avatar with AI (OpenAI image key) | ✗ | **Skip**: a paid key for a cosmetic feature | — |
| **Title** + **Blurb** (shown in the roster, on the phone and to other bots) | ✗ | Two fields. The blurb goes into `list_bots`, so the Chief routes work better. High value, tiny | S |

### 2.3 Soul (standing instructions)

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| `SOUL.md`, always in context, 24 KB cap, mirrored to the bot's folder | ◐ `brief` field | Store the brief as `SOUL.md` in the bot home (`<data>/Bots/<id>`), editable in the app or any editor, capped. The preamble reads the file. Migrate `brief` once | S–M |

### 2.4 Skills

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| Per-bot skills | ◐ Skills subsystem for CLIs and projects | Put skills in the bot home's `.agents/skills` (and each CLI's own dir through the registry). Engines load them natively because the bot's cwd is its home. Reuse `SkillsPanel` scoped to a bot | S |
| Import from `owner/repo` or a GitHub `SKILL.md` URL | ✗ | Fetch in main, show a diff or preview, user approves, then write. Never auto-enable | M |
| Save a verified run as a skill (with review) | ✗ | The bot calls `propose_skill` → review card → written. This is the Hermes "learning loop" with a human gate | M |

### 2.5 Memory

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| Memory on/off per bot | ✗ (always on) | Toggle | S |
| `MEMORY.md` (first 200 lines / 24 KB load) + `memory/<topic>.md` on demand + daily logs | ◐ `memory: string[]`, at most 50 notes | Move to files in the bot home. Keep the `remember` / `forget` tools working on `MEMORY.md`. Topic files are read with file tools. Show a load gauge | M |
| Credential redaction before writing | ◐ prompt-only ("never store secrets") | Redact key, token and private-key patterns in main before writing. Cheap safety | S |
| Change journal with one-click undo | ✗ | Shares the journal from 2.1 | M |
| Open in Obsidian / Show in Explorer | ✗ | `shell.openPath` and `obsidian://open?path=` from main | S |

### 2.6 Routines → see `bots-automation.md` (A1–A3, decided)

Grok Bot's cap of **50 routines per bot** is a sensible limit to copy.

### 2.7 Access

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| Where it works (Auto / cloud / VPS / this computer) | ◐ Docker here or on SSH (ADR 0022) | Keep Docker. **Skip Boat** (a paid third party). Option: a **shared team computer** (Grok Bot's model: one container for many bots, one seat each) | M |
| **Working folder** (choose) | ✗ (bot home only) | "Places": folders the user approves, project folders included. This was planned in ADR 0022 and never built | M |
| Connected apps on/off per bot + **per-app tool grants** | ◐ every agent gets every Composio app | A per-bot allowlist of apps and tools. Composio sessions accept tool filters. Default: none for new bots? (decision) | M |
| MCP servers per bot | ◐ global `connections` | A per-bot allowlist over `McpGateway` | S–M |
| Tool selection (allow / exclude, `native:*`, `mcp:server:*`) | ✗ | Map to each CLI's flags (for example `--allowedTools` / `--disallowedTools`) **in the adapter** (rule 5). Mark adapters that can't do it | M |
| Browser: its own browser with its own logins | ◐ `BrowserService` + `browserProfiles` | One browser profile per bot (its own persist partition), plus browser tools for its threads | S–M |
| Webhooks wired to this bot | ✗ | List from T1/T2 | S |
| **Always allowed** (standing approvals) | ✗ | List and revoke what the engine remembered (where the CLI stores it), or Hiveory's own allowlist | M |

### 2.8 Model

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| Default model, effort | ✔ | — | — |
| **Backup models** (try the next engine only if the request provably never started) | ✗ | Key for unattended routines: a quota or sign-in failure before the turn starts → the thread switches to the next engine. Never replay work that may have run | M |

### 2.9 Permissions

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| Chief of Staff | ✔ | — | — |
| "Ask me before contacting other bots" | ◐ `messaging` on/off | Add a confirm-card mode alongside on/off | S |
| **Approval levels**: Ask · Auto-accept edits · Approve for me · Full | ◐ `autoApprove` boolean | Each CLI adapter declares the levels it supports and how to pass them (rule 15, no hardcoding). The UI shows only the supported ones. Reusable by Work and Chat | M |
| **Chief's level flows down** to the work it delegates | ✗ (the teammate's default) | Delegated threads start at the Chief thread's level, capped by the teammate's maximum | S |
| Command allowlist | ✗ | Per-bot list passed to adapters that support it | M |
| **Sending on your behalf**: ask every time, or a daily amount (emails, posts, invites, payments) | ✗ | A gate on **outbound** Composio tools (send, post, create invite, payment). Reads and drafts never count. Ask by default. A budget per day per bot. Applies even at Full. **The most important safety feature for automation** | M |

### 2.10 Voice & alerts

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| Per-bot voice; ElevenLabs, Fish, Grok, Mac, local Chatterbox | ◐ Queen Bee's local voice (speech packs) | Reuse the local voice for **read replies aloud**. Cloud TTS later, behind one adapter | M |
| Voice notes, calls with spoken approvals | ✗ | Later (L) | L |
| **Notifications** when the bot finishes or needs input | ◐ phone push | A per-bot toggle plus a desktop notification on `waiting-for-you` and finished | S |

### 2.11 History and Usage

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| History (threads, archived, search) | ◐ thread tabs | Archive instead of delete; `session_search` over the bot's transcripts (as a tool too) | M |
| **Usage** (tokens and cost per bot and thread) | ✗ | Parse usage from CLI output in `parsers.ts` (Claude stream-json reports usage and cost; others report tokens). Totals per bot. **Budgets** (stop routines past $X a day) later | M |

---

## 3. OpenMausBot features outside the bot panel

| Feature | Hiveory | Scope | Size |
|---|---|---|---|
| **Rooms / group chats** (2–6 bots; @mention · lead · everyone · auto) | ✗ (planned as B2) | One transcript, several bots; responder: @mention and lead first. Grok Bot and OpenMausBot both have it | L |
| **Team incidents** → the Chief retries (`retry_thread`, at most 2) | ✗ | A failed or stalled run (20 min idle) wakes the Chief with a report marked "not from the person". 5 an hour → mute. No Chief → notify | M |
| **Team packages**: share or import a whole team as Markdown (no keys, history or memory; routines paused; Ask level) | ✗ | Export and import with a review screen. A growth lever (OpenMausBot has a marketplace, BotMRR). Rule 27: strip anything secret-like | M–L |
| **Preset bots** (New bot defaults) | ✗ | Template list in New bot | S |
| Duplicate / hide / mark unread on bots | ◐ pin, delete | Add duplicate and unread | S |
| **MCP server for outside clients** (Claude Desktop, Cursor drive the team: list, send, wait, interrupt; never approve, delete or touch credentials) | ✗ | Over the paired-device server: an allowlisted tool set and a pairing token | M |
| Decision model "Jev" for auto-routing | ✗ | **Skip**: a third-party key. Use the room lead instead | — |
| Goal mode (a room works toward one goal until done) | ✗ | Later, on top of rooms | L |

---

## 4. Ideas from the market that OpenMausBot does not have

| Idea | From | Hiveory fit | Size |
|---|---|---|---|
| **Heartbeat**: every N minutes the bot reads `HEARTBEAT.md`, stays silent with `HEARTBEAT_OK`, and acts or reports otherwise | OpenClaw | An interval routine plus a "silent unless something to say" flag. Proactive bots for almost free once A1 exists | S |
| **Self-written skills** with refinement | Hermes | §2.4 `propose_skill`, gated by review | M |
| **Messaging gateway** (talk to bots from Telegram, Slack, WhatsApp) | OpenClaw, Hermes | Composio Slack or Telegram trigger in, send tool out. Later | L |
| **Live artifacts** (a panel that refreshes from connectors) | Cowork | A routine whose output pins to a "board" card. Later | M |
| **Pause on malicious instructions** | dots | Fence every outside payload (email, webhook, web page) as data; trigger runs read-only; a "possible injection" chip when a run asks for outbound tools right after reading outside data | M |
| **Shared team computer** | Grok Bot | §2.7 | M |
| Outcome templates gallery | Lindy, BotMRR | Ship 5–8 team packages in-app (inbox triage, release notes, PR reviewer, competitor watch) | S each |
| **Bots that ship code** | none | A bot tool `open_workspace(project, task)` creates an isolated workspace, starts an agent and reports back. Its card shows on that project's Kanban by real status. **Hiveory's differentiator** | M–L |

---

## 5. Scope in Work and Chat modes

Reusable pieces (build once, use in all three modes; rule 1):

| Piece | Work | Chat |
|---|---|---|
| Approval levels through adapters | ✔ panes and presets | ✔ |
| Notifications on `waiting-for-you` / finished | ✔ per agent | ✔ |
| Usage per agent / chat | ✔ (agent pane header, not a Kanban column) | ✔ |
| Saved prompts (drag into any input) | ✔ | ✔ |
| Skills import from GitHub with review | ✔ project skills | ✔ |
| Scheduler targets | workspace routine (W1) | scheduled chat (W1) |
| Triggers | GitHub issue → isolated workspace (opt-in per project) | — |
| Read aloud | — | ✔ |
| Backup engines | — (interactive; the user sees it) | ✔ |

Not for Work: rooms, team packages, the bot memory model, a Tasks board (rules 7, 9, 10).

---

## 6. Rules this touches (for the ADR)

- **Rule 9 / "task history" non-feature**: run logs, usage, archived threads and the change journal
  are history. ADR 0028 already allows capped history **in Bots only**; extend it to usage and journals.
- **Rule 5 / 15**: approval levels, tool selection, backup engines and usage parsing live in the CLI
  adapters, never in components.
- **Rule 27**: team packages strip secrets, memory and history. The avatar image stays local. Queen
  Bee may learn "pause routine", "go to team map" and so on, but never sees bot output.
- **Rule 14**: preset bots are a Bots concept, separate from Work presets (which keep their four fields).
- **Rule 4**: skill import, image upload and Obsidian open all run in main through narrow IPC.

---

## 7. Recommended order

**Tier 1: automation core plus cheap trust wins (about 2–3 weeks)**
1. Routines A1–A2 (decided) + heartbeat flag
2. Overview card (Does / Can reach / Won't, prompt preview, setup checklist)
3. Title + blurb (into `list_bots`)
4. Approval levels via adapters + Chief level flow-down
5. Per-bot notifications
6. Per-bot skills folder

**Tier 2: governance for unattended work (about 3–4 weeks)**
7. **Sending on your behalf** gate (outbound tools, daily amount)
8. Per-bot app, tool and MCP allowlists; per-bot browser profile; Places
9. Memory as files (`MEMORY.md`, topics, redaction, journal + undo) + `SOUL.md`
10. Triggers T1 (Composio), team map M1, work board K1
11. Team incidents + backup engines
12. Usage per bot (then budgets)

**Tier 3: team scale and reach**
13. Rooms (group chats)
14. Bots that open workspaces (the differentiator)
15. Team packages + an in-app template gallery
16. MCP server for outside clients
17. Read aloud → voice calls; messaging gateway

**Skip:** AI avatar generation, Boat cloud computers, the Jev decision model, several paid TTS
vendors at once, and OpenMausBot's enterprise organization library.

## Sources

- OpenMausBot: <https://github.com/milind-soni/OpenMausBot> (`README.md`, `docs/approval-levels.md`,
  `docs/memory.md`, `docs/tool-selection.md`, `docs/team-incidents.md`, `docs/mcp-server.md`,
  `docs/team-sharing.md`) and the user's screenshots of its bot settings
- Grok Bot: <https://www.eesel.ai/blog/grok-bot>, <https://composio.dev/blog/guide-to-frok-bot>
- OpenAI dots: <https://www.datacamp.com/blog/openai-dots>, <https://techradar.com/pro/openai-launches-dots-its-always-on-ai-agents-that-are-always-watching>
- Claude Cowork: <https://fast.io/resources/claude-cowork-features-overview/>
- OpenClaw: <https://docs.openclaw.ai/automation>, <https://sparkco.ai/blog/how-openclaw-works-skills-heartbeat-memory-and-channels-explained>
- Hermes Agent: <https://hermes-agent.nousresearch.com/docs>
- Lindy: <https://automationatlas.io/answers/lindy-pricing-explained-2026/>
- BridgeMind: <https://docs.bridgemind.ai/docs/agent-mode>, <https://www.bridgemind.ai/changelog>
