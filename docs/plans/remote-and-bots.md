# Plan: Bots mode, remote SSH, and VMs

Status: **decided and partly built** (October 2026, ADR 0022). Turning it into decisions means
an ADR per phase. It also means superseding two product-spec non-features: "Agent top-level
mode" and "remote collaboration".

This plan answers four questions:

1. What should a third top-level mode, **Bots**, be? (like Grok Bot, BridgeMind Agent mode and OpenMausBot)
2. How should **remote SSH** work in Work mode?
3. How should a **remote machine or VM** work in Bots mode?
4. How can **the whole app** run in a VM?

---

## 1. Research

### 1.1 Orca (stablyai/orca): parallel agents in worktrees, with SSH

Desktop app (Electron, `node-pty`, `ssh2`, `ws`). Read from the repository source and
`docs/reference/*`.

- **SSH worktrees.** A project can live on an SSH host. The rule (`ssh-execution-boundary.md`):
  *the execution host owns everything that touches execution* (PTYs, agent CLIs, git, files,
  watching, search, setup hooks, AI commit messages). The client owns the UI, the transport and
  orchestration state.
  - **No silent substitution.** A remote operation never falls back to running locally, because a
    local run could answer for the wrong repository.
  - **Three verdicts for a process: `live` / `unverifiable` / `exited`.** Losing contact is never
    evidence that a process exited. Only the owning host can prove `exited`. Separately, *host
    contact* has the states `live` / `unverifiable` / `refused` / `retired`.
- **Relay daemon.** On first connect Orca uploads a relay bundle over SFTP into a directory named
  by its content hash. It provides its own Node runtime (a "pinned runtime materializer") and starts
  the relay detached (`nohup … &`, ignores SIGHUP). PTYs are children of the relay, not of the SSH
  channel, so **work survives disconnects, laptop sleep and app quit** (quitting is a *detach*, not
  a dispose). One SSH exec channel carries a multiplexed frame protocol.
- **Reconnect** re-attaches to the live PTYs and replays a bounded tail (about 100 KB). Optional
  grace period: by default terminals stay alive until reset, or they can be killed after 60 s–7 d.
- **Lesson learned.** Namespacing the relay socket by *build hash* strands live terminals after
  every app update. Their newer `orcad` daemon namespaces by *semantic protocol version* and keeps
  a daemon that holds live sessions alive across updates. Copy that, not the first design.
- **Host keys** (`ssh-host-key-verification.md`). Read the user's `~/.ssh/known_hosts`, never write
  to it, and keep a separate trust store. Connections with ProxyJump/ProxyCommand go through system
  OpenSSH. Never auto-accept a key: an attacker in the middle could walk the user into password and
  passphrase prompts.
- **Headless runtime**: `orca serve` (Electron under Xvfb) or **`orcad`** (plain Node), with a
  separate terminal daemon that owns the PTYs. A WebSocket listener plus **E2EE pairing**
  (`orca://pair?code=…`, an X25519 key) lets the desktop or phone attach as a client. Supervised by
  systemd; the daemon lives in its own `systemd-run --user --scope` so restarting the service keeps
  the terminals. "**One host, one model**": a machine is either an SSH target or a paired peer
  runtime, never both.
- **Mobile relay**: phones and desktops each dial *out* to a relay cell, which splices the frames.
  There are push gateways for APNs/FCM.

### 1.2 OpenMausBot (milind-soni/OpenMausBot, openmausbot.com): open-source Grok Bot

Electron plus a **local harness server** (`127.0.0.1:8799`). The UI sends typed HTTP commands and
folds one **SSE event stream**. Drivers turn each CLI's native protocol (Claude stream-JSON, Codex
JSON-RPC, Grok ACP) into one canonical runtime event stream, logged per thread as NDJSON.

- **Bots are contacts.** Each bot has a name, avatar, personality/instructions, model, memory,
  skills, connected apps (Composio) and a **computer**. Right-click a bot to pin, mark unread,
  duplicate, hide or delete it.
- **Threads** (`docs/plans/2026-09-09-independent-threads.md`): one bot has many persistent
  threads. Each thread has its own model, effort, approval mode (Ask/Auto), run state, unread state
  and Stop. **Folders** only organize threads. By default 3 threads per bot run in parallel
  (configurable from 1 to 10); extra messages wait in a queue. Memory is shared across a bot's
  threads through a scoped `memory_update` tool.
- **Groups / rooms / channels**: several bots in one transcript, each with a responder mode
  (@mention, lead, everyone, Auto). Auto uses a fast *decision model* (Jev) to pick who answers.
  It fails open to the room's **lead**.
- **Head bot = "Chief of Staff"** (`server/chief-of-staff.ts`): the user's single contact for a
  team. Its tools are `list_bots`, `delegate_bot` (async: the result wakes the Chief in the same
  thread), `ask_bot` (short synchronous consult), `retry_thread`, and `propose_team_setup`
  (configures the team only after the user approves). A "Team incidents" thread receives failed or
  stalled runs from teammates. Prompt rules: never invent progress, report a handoff only after the
  tool accepted it, and retry at most twice.
- **Approvals**: a permission broker turns risky actions into Allow/Deny cards (Ask/Auto/Full levels).
- **Computers** (each bot chooses one: `auto | cloud | vm | local | browser | off`):
  - **Cloud**: Boat (boat.dev) API VMs with live screen preview and a "take control" button.
  - **Local VM**: really a **container** (Docker/Podman, or Apple `container`) from a digest-pinned
    `trycua/xfce-cua` desktop image with `cua-driver` inside. The workspace mounts at
    `/home/cua/workspace`. Modes are shared, per-bot, or a pool of seats; each desktop has a
    **lease** (one thread at a time, renewable TTL, other threads queue). Podman is the Windows path.
  - **BYO VPS** (`docs/byo-vps.md`): the agent stays on your machine; `docker -H ssh://alias` runs
    one hardened Cua container per bot on the VPS. It uses only the SSH alias from `~/.ssh/config`,
    with no public ports. noVNC goes over an SSH tunnel to a random loopback port. The user must
    accept the host key manually first, and the container filesystem is disposable.
  - **This computer**: `cua-driver` spawned from Electron main (so OS permission prompts name the app).
- **Whole app on a server** (`docs/deploy-vps.md`): `npx openmausbot serve` on a VPS runs every
  engine, chat, room, routine and connected app. It is reachable through a managed HTTPS tunnel,
  your own domain, or Tailscale only. Devices pair once with a short code (30-day renewing
  sessions, 180-day maximum).
- **Desktop companion mode** (`docs/desktop-companion.md`): any desktop build can be a **client**
  of another host. The renderer keeps using same-origin HTTP/SSE. An Electron loopback relay adds
  the bearer token. The host's companion API is **default-deny**, allowlists routes and scrubs
  responses. Interactive desktop access is a separate per-device permission that is off by default.
- Also: routines on a weekly calendar, webhooks, a stdio MCP server so outside clients can drive
  the team (bounded: no approvals, deletion or credentials), team files you can share as Markdown
  (never with secrets or history), and voice.

### 1.3 BridgeMind One (bridgemind.ai, docs.bridgemind.ai)

Three modes: **Agent**, **Code** and **Chat**, the same shape this plan proposes for Hiveory.

- **Agent mode**: persistent teammates. Each one has a **Name**, a **Brief** (job, standards,
  tone, when to stop), **Memory** (durable facts the user can inspect and edit), **Skills**,
  **Places** (folders the user explicitly approves) and **Chats** (threads with the same identity).
  The engine (Claude Code or Codex) powers the chats but does not define the teammate. "Create with
  AI" drafts the name and brief. Agent messaging is bounded and only between approved teammates;
  it can wake an idle teammate into a fresh chat. Messaging, routines and plugins are **separate
  permissions per agent**.
- **Routines**: each run is a fresh chat. They run only while the app is open.
- **Plugins**: app-managed OAuth, enabled per agent. Sensitive writes pause on an approval card.
- **Code mode**: workspace folders, panes (terminal, thread, files, browser, simulator), presets
  (Solo/Pair/Workbench/Swarm), and a command bar.
- **Remote** (from the changelog): pair a phone with a QR code that carries a one-time secret the
  relay never sees. The phone can approve tool requests for a limited time window (24 h), with a
  visible banner. There is a "Keep agents running while BridgeMind is closed" beta.

### 1.4 What all three agree on

| Idea | Orca | OpenMausBot | BridgeMind | For Hiveory |
|---|---|---|---|---|
| Execution host owns execution; never fall back to local | ✔ | ✔ (VPS never falls back) | — | **Adopt** |
| Work survives the client disconnecting | relay daemon | server | background beta | **Adopt** (daemon) |
| Persistent agent identity separate from the engine | — | bot | teammate | **Adopt** for Bots |
| Threads under one identity, each with its own model | — | ✔ | ✔ | **Adopt** |
| Head agent that delegates and consolidates | orchestration | Chief of Staff | messaging | **Adopt**, bounded |
| Approvals as cards | — | ✔ | ✔ | Reuse waiting-for-you |
| Pairing with E2E keys, default-deny remote API | ✔ | ✔ | ✔ | **Adopt** |
| SSH: read known_hosts, never auto-accept | ✔ | ✔ | — | **Adopt** |

---

## 2. What Hiveory already has to build on

- **Typed IPC contract** (`src/shared/ipc/contract.ts`, zod schemas for every request) plus
  handlers in main. A WebSocket transport can carry the same contract, so the renderer does not
  change between local and remote use.
- **Chat mode** (`ChatService`): spawns a CLI headlessly with no shell, parses stdout per provider
  (`parsers.ts`), persists chats and streams snapshots. **This is the engine for bot threads.**
- **Agent tools over MCP** (`HookServer /mcp/<instanceId>` → `AgentTools`): agents already read
  screens, send input and open panes. Bot delegation tools (`list_bots`, `delegate_bot`,
  `ask_bot`) fit here.
- **Status model** `idle | working | waiting-for-you`. It applies directly to bot threads, and a
  pending approval counts as `waiting-for-you`.
- **ConnectionService / McpGateway** (sealed keys, MCP servers started on demand): the
  "connected apps" layer for bots.
- **ComputerService** (Windows native helper) and **BrowserService** (WebContentsView + CDP): two
  computers a bot can use today ("this PC", "browser").
- **Queen Bee**: operates the app only. Under rule 27 she sees only app state, never files or
  output. She stays that way and is **not** the head bot.
- **PtySession** (spawn deferred until the size is known, coalesced output, bounded replay, a
  headless mirror). This is the piece a remote relay runs.
- Add project already shows a disabled **Local/Remote** select (ADR 0020).

---

## 3. Bots mode (the third mode)

### 3.1 Model

```text
Bot ── identity that outlives any engine
├── name, avatar (pet-name service for defaults), brief
├── engine default (any registry CLI that supports headless chat) + model
├── memory: short facts the user can see and edit; written only through a memory tool
├── skills (reuse the Skills subsystem), connections (per-bot allowlist over ConnectionService)
├── places: folders the user approves (none by default)
├── computer: off | browser | this-pc | container | vps   (§5)
├── permissions: messaging · routines · computer · each connection, all off by default
└── threads[]
     └── Thread: engine/model/effort/approval mode, status idle|working|waiting-for-you,
                 unread, transcript (ChatService session), queue of waiting messages
Group ── several bots plus one transcript; responder: @mention | lead | everyone
Lead bot ── optional per group, or a global one: delegates, consolidates, receives incidents
```

- **Thread = a ChatService session tagged with a bot id.** There is no second conversation system.
- **Parallel threads per bot**: default 3, with a queue. A thread waiting on an approval holds its slot.
- **Lead bot** (the "head bot"; name to be decided, see §8). It gets MCP tools `list_bots`,
  `delegate_bot` (async: the result comes back into the lead's thread and wakes it), `ask_bot`
  (short and synchronous) and `retry_thread`. It uses OpenMausBot's prompt rules: never invent
  progress, report a handoff only after the tool accepted it, retry at most twice. Team changes
  (create bot, change model) happen only through a proposal card the user approves.
- **Bot-to-bot messages are bounded**: only between bots that both have messaging on. A depth/hop
  limit and a per-hour budget stop loops. The exchange shows in both transcripts.
- **Approvals**: provider permission prompts become cards in the thread. While one is open the
  thread is `waiting-for-you`, and it shows in a "Needs you" inbox at the top of the bot list
  (as in the BridgeMind screenshot).
- **Routines** (later phase): each run is a fresh thread. They run only while Hiveory or its
  daemon is up, with no exact-time promise.

### 3.2 Screens (ui-map additions)

```text
┌ Bots ─────────────┐┌ Cold outreach operator · Claude Code ────────── ● Ready ⚙ ┐
│ Needs you (1)     ││ [Find leads ×] [Connect founders ×] [New chat] [+]       │
│ ★ Lead            ││                                                          │
│ ● X trend scout 1 ││               What should we work on?                    │
│ ◐ Release notes   ││     [Plan the next release] [Review code] [Draft…]       │
│ ○ Video strategist││                                                          │
│ Groups            ││ ┌ Message Cold outreach operator…                      ┐  │
│ # Launch team     ││ │ ✳ Claude ▾  Sonnet ▾  Ask ▾         🎙  ↑             │  │
│ [+ New bot]       ││ └──────────────────────────────────────────────────────┘  │
└───────────────────┘└──────────────────────────────────────────────────────────┘
Bot settings: Profile · Brief · Memory · Skills · Connections · Places · Computer · Permissions
```

- Bots are **not** scoped to a project. That keeps rule 8 safe: the Kanban stays project-scoped
  and never shows bots. A bot's **Places** may include project folders.
- Bot threads never become Kanban cards (they are not workspace agents).
- Reuse `ChatComposer`, `ChatMessages`, the model picker and `AttachmentChips` from Chat mode.
  Bots differ only in the identity header and the thread tabs.

### 3.3 Rule 27 (privacy) for Bots

Bots are the user's own engines running under the user's own logins, so they *do* see files in
approved Places. That is the point of a bot, unlike Queen Bee. What stays true:

- Hiveory adds no telemetry and ships no personal data.
- Secrets stay in main (`secret-box`) and are injected into the engine process only as env or MCP
  config. They never enter prompts or transcripts.
- Bot memory is plain text the user can edit and never holds credentials.
- Shared team files (if built) exclude history, memory and keys.

---

## 4. Remote SSH in Work mode

### 4.1 Shape: one execution-host seam

```text
Renderer ──IPC (unchanged)──▶ main services ──▶ ExecutionHost (by project.hostId)
                                                ├── LocalHost   (today: node-pty, fs, git, chokidar)
                                                └── SshHost ──ssh2 exec channel (framed, multiplexed)──▶ hiveoryd on remote
                                                                                                   ├── PtySession ×N (detached)
                                                                                                   ├── git, worktrees
                                                                                                   ├── fs read/write/watch/search
                                                                                                   └── CLI discovery + status hooks
```

- `Project` gains `host: { kind: 'local' } | { kind: 'ssh'; targetId }`. An **SSH target** is a
  saved alias from `~/.ssh/config` (parsed, Include supported) or host/user/port/identity.
  **No passwords or passphrases are stored**: keys come from ssh-agent, or the user is prompted
  each session.
- `ExecutionHost` is a narrow interface: `pty.spawn/write/resize/kill/attach`,
  `exec(file, args)` (no shell), `fs.*`, `watch`, `git.*`. `ProjectService`, `WorkspaceService`,
  `WorktreeService`, `GitService`, `CliRuntimeManager`, `ShellService`, `FilesService` and
  discovery all go through it. **Rule: no silent local fallback.** If the host is down, operations
  fail with "<target> is unreachable".
- **hiveoryd** (a small Node bundle, no native modules except node-pty prebuilds for
  linux-x64/arm64 and darwin):
  - Uploaded over SFTP to `~/.hiveory-relay/v<protocol>/` and started detached (`setsid`, ignores
    HUP). One daemon per user per remote host. **Namespace by protocol version** (Orca's lesson),
    and keep a daemon with live PTYs alive across app updates.
  - Node on the remote: use the user's `node` ≥ 20 if present, otherwise download a pinned, hashed
    Node build into the relay directory.
  - Owns PTYs. A disconnect or app quit **detaches** and never kills. Reconnect re-attaches and
    replays the bounded `OutputBuffer` tail. Agent status is `unverifiable` while disconnected,
    never `idle` or `exited`.
  - Grace setting: keep until reset (default) or kill after N hours.
- **Agent status hooks and agent tools.** Agents call Hiveory's local HookServer (status hooks,
  MCP agent tools). Over SSH this goes through an **`ssh -R` reverse forward** of the HookServer
  port to a remote loopback port, with the same bearer token per instance. If the tunnel drops,
  hooks queue in hiveoryd and are delivered on reconnect.
- **Browser and dev servers**: a local port forward (`-L`) per detected dev-server port, so the side
  panel browser opens `localhost:<port>` (Orca does port forwarding the same way).
- **Host keys**: read `~/.ssh/known_hosts`; unknown means a prompt showing the fingerprint;
  mismatched means refuse with remedy text. The trust store lives in userData. Use system OpenSSH
  for ProxyJump/ProxyCommand (Windows ships OpenSSH).
- **CLIs on the remote**: discovery runs remotely, and engines use the remote machine's logins.
  The Settings › Agents list shows "on <target>".
- **One checkout per workspace** (ADR 0021) extends naturally: the tree key becomes
  `hostId + path`.
- **Explorer and editor panes** read and write through `fs.*`. Watching uses inotify on the remote,
  and events stream as frames.
- **Out of scope for SSH v1**: computer use on the remote, the Sessions tab for remote CLI history
  (add later through `fs`), and Windows SSH targets (Linux/macOS remotes first; Windows remote
  needs ConPTY in hiveoryd).

### 4.2 Order of work

1. `ExecutionHost` interface + `LocalHost` refactor (no behaviour change, tests stay green).
2. hiveoryd: frame protocol, PTY sessions, exec, fs, git; local tests run it over a pipe.
3. `SshHost`: ssh2 connect, host-key verifier, SFTP deploy, reconnect/backoff, reverse/forward tunnels.
4. Add project › Remote: pick a target, browse the remote folder, then the project opens with a
   host badge everywhere (sidebar, title, panes).
5. Isolated workspaces on remote (worktrees under `~/.hiveory/workspaces/`).

---

## 5. Remote machines and VMs in Bots mode

A bot's **engine** and its **computer** are separate choices, as in OpenMausBot:

| Computer | Engine runs | Desktop is | How |
|---|---|---|---|
| `off` | locally | none | chat/tools only |
| `browser` | locally | a Hiveory WebContentsView per bot (persist partition) | existing BrowserService/PageDriver |
| `this-pc` | locally | the user's desktop | existing ComputerService (Windows), explicit opt-in, approvals on |
| `container` | locally | Linux desktop in Docker/Podman on this PC | pinned Cua-style image, noVNC on random loopback port, MCP proxy for computer tools |
| `vps` | locally | same container on a user VPS | `docker -H ssh://<alias>` (OpenMausBot BYO VPS); SSH only, no public ports |
| `hiveory-server` | **on the server** | server's container | the whole bot lives on a Hiveory server (§6) |

- **Leases**: one thread holds a desktop at a time (renewable TTL). Others get "waiting for its
  turn on this computer". Container lifecycle (create/start/stop) is serialized per container.
  Removing a container is always the user's call.
- **Hardening**: no published ports, dropped capabilities, no host mounts except the bot's own
  workspace folder, and refuse to reuse a container that fails ownership or pinning checks.
- **Take control**: noVNC through an SSH or loopback tunnel into a side panel pane. While the user
  drives, the agent's lease pauses.
- **Places on a VPS bot**: a Place can be a folder on an SSH target. The engine can run there too,
  through the same `ExecutionHost`, so remote Work and remote Bots share the transport.

---

## 6. The whole app in a VM ("Hiveory server")

Goal: agents and bots keep working while every laptop is closed, and the desktop or phone attaches
as a client.

```text
VM / VPS (Linux)                                        Your desktop (client mode)
┌──────────────────────────────────────┐                ┌───────────────────────────┐
│ hiveory serve (Electron under Xvfb,   │◀──WSS (E2EE)──▶│ same renderer, IPC over   │
│   or plain-Node main without browser) │   pairing code │ WebSocket transport;      │
│ ├─ all main services (projects, git,  │                │ local main runs only the  │
│ │  agents, chats, bots, routines)     │                │ relay + native bits       │
│ ├─ hiveoryd (PTYs, detached scope)    │                └───────────────────────────┘
│ └─ companion API: default-deny allow- │◀── phone (later): approvals, status, chat
│    list over the IPC contract         │
└──────────────────────────────────────┘
```

- **Transport seam**: the renderer calls `api(name, input)` today through preload IPC. Add a
  WebSocket transport that carries the same `{name, input}` frames and the same `subscribe` event
  stream. Main validates with the same zod schemas, plus a **remote allowlist** (which IPC names a
  paired client may call). Dangerous names (`projects.pickFolder`, OS integrations, settings that
  touch the host) stay host-only. That is OpenMausBot's default-deny companion, built on our contract.
- **Pairing**: a short code plus an X25519 key exchange, or Tailscale only (`.ts.net`, the safest
  default). Device tokens live in the OS keychain (`safeStorage`) and never reach the renderer or
  URLs. Each paired device can be revoked.
- **Run modes**: `hiveory serve --tailscale` or `--port` behind the user's reverse proxy, run as a
  systemd unit with hiveoryd in its own scope so restarting the service keeps the terminals.
- **What needs a display**: the agent browser (WebContentsView) needs Electron, so use Electron
  under Xvfb on servers. Computer use on the server means the server's container desktop, never a
  real seat.
- **One host, one model**: a machine is either an SSH target (§4) or a Hiveory server (§6), never
  both. The UI enforces this per hostname.

---

## 7. Security checklist (applies to every phase)

- Host keys are verified (§4.1) and never auto-accepted. Passwords and passphrases are never stored.
- Remote API: default-deny allowlist, the same zod validation, per-device tokens, and revocation.
- No raw shell, ever: `exec(file, args)` only. hiveoryd refuses paths outside the project roots
  for `fs.*`.
- Secrets stay in main. They are injected into engine processes as env only, and never cross to
  the remote unless the engine runs there and the user opted in for that target.
- Bot autonomy is bounded: per-bot permission toggles, a hop limit on delegation, budgets, approval
  cards for writes, routines start paused, and a team file never carries keys or history.
- Rule 27 stays as it is for Queen Bee.

---

## 8. Decisions (made — see ADR 0022)

1. Head bot: a **Chief of Staff** role on one bot (OpenMausBot's model), not Queen Bee.
2. Modes: **Work · Bots · Chat**, each its own mode.
3. Bots are **global** (as in Grok Bot, OpenMausBot and BridgeMind), each with its own folder.
4. Remote is **one host layer** shared by Work and Bots (`hiveoryd` + the host protocol).
5. Local and VPS computers are **Docker** containers.
6. Durability: one failing feature never takes the app down (ADR 0009 amendment).

Status: B1 and B3 (Bots, Chief of Staff delegation) and R1 and R2 (local host process, SSH
transport) are built. Next: remote projects in Work on the SSH host, then bot computers on Docker.

## 9. Phases

| Phase | Scope | Depends on |
|---|---|---|
| B1 | Bots mode: bot CRUD, brief, engine/model, threads over ChatService, status, approvals inbox | — |
| B2 | Memory tool, per-bot connections/skills/places, groups with @mention/lead | B1 |
| B3 | Lead bot delegation tools + incidents + bounded bot messaging | B2 |
| R1 | `ExecutionHost` seam + LocalHost (refactor only) | — |
| R2 | hiveoryd + SshHost: remote projects, PTYs, git, fs, tunnels, host keys | R1 |
| R3 | Remote isolated workspaces, remote CLI discovery, reconnect UX (`unverifiable`) | R2 |
| C1 | Bot computers: `browser`, `this-pc` (existing services) | B1 |
| C2 | `container` and `vps` computers, leases, take control (noVNC) | C1, R2 (SSH) |
| S1 | WebSocket transport + allowlist + pairing; `hiveory serve` | R1 |
| S2 | Desktop client mode; routines on the server | S1, B3 |
| S3 | Phone companion (approvals, status, chat) | S1 |

## Sources

- Orca: <https://github.com/stablyai/orca>, especially `docs/reference/ssh-execution-boundary.md`,
  `ssh-host-key-verification.md`, `headless-linux-server.md` and `orcad-operations.md`, plus
  `cloud/README.md`
- OpenMausBot: <https://www.openmausbot.com>, <https://github.com/milind-soni/OpenMausBot>,
  especially `README.md`, `docs/byo-vps.md`, `docs/desktop-companion.md`, `docs/deploy-vps.md`,
  `docs/decision-model.md`, `docs/computer-use-integration.md`,
  `docs/plans/2026-09-09-independent-threads.md`, `server/chief-of-staff.ts`,
  `server/container-computer.ts` and `server/local-vm-lease.ts`
- BridgeMind: <https://www.bridgemind.ai>, <https://docs.bridgemind.ai/docs/agent-mode>, `/code-mode`,
  `/routines`, `/skills-and-plugins`, and <https://www.bridgemind.ai/changelog>
