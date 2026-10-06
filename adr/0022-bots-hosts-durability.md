# ADR 0022 — Bots mode, one remote host layer, durability

Builds on ADR 0019–0021 and `docs/plans/remote-and-bots.md` (the research). The product owner
decided this round:

1. The head bot is not Queen Bee. It works the way the reference products do.
2. There are three modes, each its own mode. Order is our call.
3. Bot scope follows the reference products.
4. Remote is one reusable layer, shared by Work and Bots.
5. Local machines and VMs run as Docker containers.
6. One failing service must never take the app down.

## Bots mode

**What the reference products do.** Grok Bot, OpenMausBot and BridgeMind all give the user a
roster of *global* bots. A bot is an identity (a role or brief, memory, skills, tools), separate
from the engine that powers it, and it has many conversations (threads). OpenMausBot puts a
**Chief of Staff** at the head of a team: the user's single contact, who delegates to bots
(`delegate_bot`, results wake it), consults them (`ask_bot`) and returns one consolidated answer.
Grok Bot's bots message each other, and a message wakes the bot that receives it. BridgeMind's
teammates work from their own home folder plus folders the user approves.

**Decision.**
- **Modes: Work · Bots · Chat.** Hiveory is a development environment first, so Work leads. Bots
  sits next to it; Chat stays the one-off conversation. This replaces product-spec's former
  non-features "Agent top-level mode" and "agent-to-agent communication" (for bots only; Work
  agents keep their own agent tools).
- **A bot is global**, never scoped to a project, so the Kanban (rule 8) never shows bots. A bot
  has a name, brief, default engine/model/effort, default permission, memory, a Chief of Staff
  flag, a messaging flag and a pin. Bots live in `PersistedState.bots`, each record validated on
  its own; a file with two Chiefs keeps the first.
- **A thread is a chat with `botId`.** `ChatService` is the only conversation engine: same
  spawn, parse, stream, attachments and stop. Bot threads stay out of the Chat list. Each thread
  works in the bot's own folder (`<data>/Bots/<id>`) and starts from the bot's defaults; until its
  first message it may pick another engine or model.
- **Identity goes in as a preamble.** `ChatService` takes a `preamble(chat)` hook, and
  `BotService` supplies the name, role, brief and memory ahead of a thread's first turn (every
  turn for engines without resume). Memory snapshots per thread, as in OpenMausBot.
- **The head bot is the Chief of Staff.** At most one exists; the first bot becomes Chief until
  the user picks another. Its MCP tools: `list_bots`, `delegate_bot` (opens a thread on the
  teammate and returns at once; the reply comes back into the Chief's thread as a
  `[Result from …]` message and wakes it, and a busy Chief gets queued results together after its
  turn), `ask_bot` (waits up to 10 minutes, then leaves the answer in the teammate's thread). A bot
  with **messaging** on may `list_bots` and `ask_bot` other messaging bots. Every bot has
  `remember` / `forget` for its memory.
- **Bounded.** Only the Chief delegates. A thread handed down twice cannot pass work on again
  (depth 2). One thread may start at most 20 handoffs an hour. Unknown or unreachable names are
  refused with the reason, and a teammate without an engine says so.
- **Privacy (rule 27).** Bots are the user's own engines under the user's own logins. Their
  threads see the bot's folder like any chat does. Queen Bee is unchanged and never sees bot output.
  Memory is text the user can edit, and the prompt tells the bot never to store secrets.
- **UI.** The sidebar is the team (Chief first, then pinned, then by name) with a right-click menu
  (edit, make Chief, pin, delete). The screen shows the bot's identity header, thread tabs (with a
  right-click to delete) and the shared `ChatMessages` / `ChatComposer` (no folder picker).
  `BotEditor` edits name, brief, engine, full access, Chief, messaging and memory. `BotAvatar`
  draws identity tiles from central tokens. Queen Bee understands "go to bots".

## One host layer for Work and Bots

**Decision.** Remote is one subsystem, not two features. An **execution host** is where processes,
files and git run: `local`, `ssh:<target>`, `container:<id>` (Docker on this machine) or
`container:<id>@ssh:<target>` (Docker on a VPS). Work projects and bot computers both name a host,
and both go through one `ExecutionHost` interface (exec without a shell, PTYs, files, watching,
git). The host daemon (`hiveoryd`) that owns PTYs and files on a remote machine is the same
program that will own them locally in its own process: process isolation and remote use are one
piece of work. Rules from Orca carry over: the execution host owns execution; no silent local
fallback; process verdicts are `live` / `unverifiable` / `exited`; and the daemon is namespaced by
protocol version, so app updates never strand live terminals.

**Step 2 (done): the same daemon over SSH.** `SshHostConnector` uses the user's own OpenSSH, so
their config, keys, agent, ProxyJump and `known_hosts` all apply. It runs with `BatchMode=yes`
(never prompts, never stores passwords), `StrictHostKeyChecking` is left to the user (host keys
are never accepted by Hiveory), and the destination is validated to an alias or `user@host`
(never an option) after `--`. Only fixed commands run remotely. `probe` reads the OS, CPU, home
and Node version (needs Node 20+). `deploy` uploads `out/main/host.js` to
`~/.hiveory-host/v<protocol>/host.mjs` only when its SHA-256 changed, and installs node-pty there
once with npm; it refuses a bundle that imports sibling chunks. `connect` starts
`node host.mjs` over `ssh -T`, using the stdio transport and a hello handshake. ssh's failure text
becomes a next step (untrusted host key, refused login, unreachable). Settings › Remote checks a
host end to end (`hosts.check`). Verified locally with a fake ssh running the remote commands in
Git Bash: probe, upload, skipped re-upload, `exec` and a real PTY over stdio; and the real ssh
client's error path. A live SSH hop still needs a machine to test against. Remote projects and
bot computers come next, on this connection.

**Step 3 (done): remote projects in Work.** A project may live on an SSH host (`Project.host`).
- **One kit per machine.** `HostKit` (`src/main/services/hosts/host-kit.ts`) is everything a
  project needs from its machine: git, worktrees, files, fs, PTYs, its CLI registry, path rules
  (`posix` for a Linux server even on Windows), hook endpoint and roots. `localKit` wraps
  today's services; `HostRegistry` connects to an SSH host on first use and reconnects on the
  next use after a drop. `WorkspaceService`, `ProjectService`, the file and git handlers, the
  runtime and `AgentService` ask for the project's kit and never branch on local or remote.
- **The daemon runs the same classes.** `hiveoryd` serves `git`, `worktrees`, `files` and `fs`
  through `invoke`, with a fixed allowlist of methods per service (`HOST_SERVICES`; never
  `git.run`), so paths and tools are native on the server. Errors keep their type across the
  wire (`AppException`, `GitCommandError`), and folder watches come back as `files.changed`
  events. Remote deletes go to `~/.hiveory-host/trash`. Over SSH the daemon adopts the login
  shell's PATH, so CLIs in `~/.local/bin`, nvm or Homebrew are found, and `which` lists that
  host's CLIs (shell adapters declare `platforms`, so a Linux server offers bash and never cmd).
  It is built on its own (a Vite build after main), self-contained except for node-pty.
- **Agents on the server.** The runtime launches with the host's registry, a runtime folder on
  the host (files written there) and the host's own environment (`inheritEnv`, never this
  computer's PATH). An `ssh -R` reverse tunnel carries status hooks and Hiveory's MCP tools back
  to the local hook server (loopback on both ends, same per-agent token). Chat view runs CLIs
  headless locally, so remote workspaces use terminals. A dropped link ends that host's agents
  with a notice; restarting reconnects, and a restarted session picks up the new connection.
- **Kept local.** Restore previous scans this computer only. GitHub features (`gh`), "reveal in
  folder" and the Sessions history work for local projects; remote projects say so.
- Verified against a Docker sshd server (Node 22, git, a fake `claude` on the login PATH): browse,
  add `~/demo`, git info, the host's CLIs, a bash pane printing the server's hostname and folder,
  Explorer create/write/read/delete (path escape refused), an isolated workspace as a worktree
  there, the fake Claude Code sending a hook and listing 33 tools through the tunnel (status turned
  working), workspace deletion removing the worktree, and a killed daemon followed by a reconnect.

**Step 4 (done): bot computers on Docker.** A bot may have its own Linux computer
(`Bot.computer = { kind: 'docker', host? }`): a container on this computer, or on an SSH host.
- **One path for both.** `BotComputers` runs every `docker` command through the host kit's
  `exec`: locally a plain `execFile`, remotely through hiveoryd on the SSH connection Hiveory
  already has (respecting the user's SSH setup), not `docker -H ssh://`. The image
  (`hiveory-computer:1`: Xvfb, fluxbox, x11vnc + noVNC, xdotool, ImageMagick, Chromium, git, node)
  is built from a Dockerfile in code with `docker build -`, so it builds the same way anywhere.
- **Hardened.** `--cap-drop ALL`, `no-new-privileges`, PID, memory and CPU limits, and a label
  that marks ownership (a container of the same name without this bot's label is refused, never
  touched). Locally the bot's folder is `/workspace` and noVNC is published on `127.0.0.1` only.
  Remotely it uses a named volume, publishes nothing, and "take control" opens an `ssh -L` tunnel
  to the container. Hiveory never deletes a container on its own.
- **Tools.** `desktop_run` (bash in /workspace, bounded output and timeout),
  `desktop_screenshot`, `desktop_click`, `desktop_type`, `desktop_key` (key names only),
  `desktop_scroll` and `desktop_open_url` (http/https), each a `docker exec` with an argument list.
  Actions return a fresh screenshot. Named `desktop_*` so they never clash with `computer_*`
  (the user's own PC). One conversation holds a desktop at a time (10-minute lease, released when
  its turn ends).
- **UI.** The bot editor has a Computer choice (none / Docker here / Docker on an SSH host); the
  bot header has a Computer menu (state, start, stop, take control).
- Verified with Docker Desktop: hardened local container, noVNC on loopback, a real Codex bot
  calling `desktop_run` (writing `/workspace/answer.txt`, which appeared in the bot's folder) and
  `desktop_screenshot`, stop, a remote bot computer created through hiveoryd on the SSH test server
  and reached by tunnel, and a foreign same-named container left alone.

Build order: (1) `hiveoryd` locally, in its own process; (2) the same daemon over SSH;
(3) remote projects; (4) bot computers on containers.

**Step 1 (done).** `src/shared/host/protocol.ts` defines the frames (calls with results,
fire-and-forget notifications, events; `HOST_PROTOCOL = 1`) and `HostTransport`.
`src/host/host-server.ts` is the daemon: `hello`, `pty.spawn` / `pty.write` / `pty.resize` /
`pty.kill` with `pty.data` / `pty.exit` events, and `exec` (no shell). `src/host/main.ts` serves
it over an Electron utility-process port, or JSON lines on stdio, which is how it will run over
SSH. The build emits it as `out/main/host.js`, a second library entry so electron-vite keeps its
externals. In main, `LocalHost` forks it, checks `hello`, restarts it after a crash and gives up
after three failed starts in a row. `HostClient` times out calls, and when the host disconnects
it fails pending calls and reports every PTY it served as exited. `PtySession` takes a
`PtyBackend`: the app passes `hostPtyBackend(localHost, inProcessPty)`, which runs PTYs on the
daemon and falls back to in-process node-pty when the daemon is unavailable. Verified in the
built app: the OpenConsole and pwsh processes are children of the host, and killing the host
leaves Hiveory running; the affected agents show as exited and the next terminal starts a new
host.

## Durability

ADR 0009 is extended (see its amendment). Every startup step, settings reaction and quit disposer
runs through `guard()`. `emit` and renderer listeners are contained, and `PtySession` no longer
throws an unheard `'error'`. Bots add no new single point of failure: a broken bot record is
dropped on load, a failed thread ends as that thread's error, delegation failures come back to the
model as tool errors, and the Bots screen has its own error boundary.
