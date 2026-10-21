# ADR 0050 — Agents and terminals outlive Hiveory: a durable local terminal daemon

Builds on ADR 0022 (hiveoryd, one host layer), ADR 0025 (remote daemons that outlive SSH), ADR 0014
(resuming conversations) and ADR 0044 (saved terminal output). Decided by the product owner, 2026-10-21.

## Context

Locally, hiveoryd runs as an Electron utility process (`LocalHost`). That isolates native PTY crashes
from the app, but the process dies with Hiveory. Quitting, an update, a crash of the main process
or a dev restart ends every agent and terminal. A command half-way through (a build, a migration, a
long agent turn) is killed. On the next start the agents only resume their *conversation*
(ADR 0014), and the terminal shows the saved output of the last run (ADR 0044).

Remote machines already do better (ADR 0025): `hiveoryd --daemon` runs detached on a private
socket, keeps output while nobody is attached, and `pty.attach` takes a terminal back. It still ends
5 minutes after the last disconnect.

Orca (stablyai/orca) runs a detached terminal daemon on the user's own computer too. Its terminals
survive the app quitting and being updated, the next launch reattaches to them, and `orca serve`
can adopt the same daemon. The product owner wants the same durability for every CLI and terminal
in Hiveory.

Three things stop the remote design from simply running locally:

- **Endpoints die with the app.** Each agent is launched with the hook URL and MCP URL of the
  current run (`HookServer` listens on a random port with a random token). After a restart, a
  surviving Claude Code posts its hooks to a dead port, so its status is lost, and its Hiveory tools
  stop working.
- **No stable terminal identity.** Terminals are `p1, p2…` per daemon run, so a new app instance
  cannot tell which terminal belongs to which agent.
- **Updates replace the binary.** The NSIS installer closes processes running from the install
  folder. On macOS and Linux (AppImage) the bundle a running daemon loads from is replaced or
  unmounted.

## Decision

### 1. The local terminal host is a detached daemon

- On first use, Hiveory starts hiveoryd as its own process: `spawn(<runtime exe>, [host.js,
  '--daemon'], { detached: true, windowsHide: true, stdio: ['ignore', log, log] })` with
  `ELECTRON_RUN_AS_NODE=1` and `unref()`. It is not a utility process, so it outlives the app. There
  is one daemon per user per profile ("Hiveory", "Hiveory Dev"). Its working folder is the profile's
  data folder, never a worktree, so deleting a worktree never invalidates it.
- The app connects over a private local endpoint, using the same `HostClient` and frames it uses
  for remote hosts. `LocalHost` becomes the local adapter of the remote layer, not a separate path.
- **Fallbacks are kept and stay visible.** If the daemon cannot start or be reached three times,
  the app uses today's utility process (terminals isolated, not durable). If that fails as well,
  terminals run in-process. Each step shows a notice. A remote host never falls back to running
  locally.

### 2. A private, authenticated endpoint

- **Endpoint:**
  - Windows: a named pipe `\\.\pipe\hiveory-<profile>-<salt>`. The pipe disappears when its owner
    exits, so it can never be stale.
  - macOS / Linux: a socket at `<data>/hiveoryd/<protocol>.sock`, in a `0700` folder, with mode `0600`.
  - Both are created without `readableAll` / `writableAll`, so only this user can reach them.
- **`<data>/hiveoryd/endpoint.json` (mode `0600`):** the pipe salt, a 256-bit token, the daemon's
  pid and incarnation id, its protocol, and its relay port (§6). The daemon writes it; the app only
  reads it. A new incarnation gets a new token.
- **Mutual authentication on `hello`:**
  - The client sends a nonce. The daemon answers with `HMAC(token, nonce)` and its own nonce, which
    the client must answer the same way.
  - A daemon that cannot prove the token is treated as an impostor. The app does not send it env or
    keystrokes, and shows a warning. This closes pipe-name squatting by another user (CWE-306,
    CWE-923).
- **Bounds:**
  - A frame is at most 1 MiB, and a longer line closes the connection (CWE-400).
  - Agent environments, which hold API keys, cross only this channel and are never logged.
  - The daemon's log holds lifecycle lines only, never terminal output (rule 27).

### 3. Who owns the endpoint (Orca's lesson)

- Only a daemon publishing itself may change the endpoint, and only to replace an entry it has just
  proven dead. No one removes a name they did not create, and there is no sweeper.
- **Unix:** bind a private name, then `link` it onto the endpoint. On `EEXIST`, prove the incumbent
  dead (connection refused or file missing, nothing else), re-check that the entry has not changed,
  then `rename` in one call.
  - A timeout or `EPERM` means "can't tell". The starter then declines, adopts the incumbent or
    fails. It never deletes.
  - This replaces today's "unlink on `ECONNREFUSED`".
- **Windows:** `EADDRINUSE` means someone owns the pipe. Connect, authenticate, and adopt it if it
  proves the token; otherwise warn and fall back.

### 4. Terminals have stable identities

- `pty.spawn` takes a `key`: the agent instance id or the shell pane id.
- A new call, `pty.list`, returns `{ key, ptyId, pid, alive, cols, rows, startedAt, exit? }` for
  everything the daemon holds, including terminals that ended while no one was attached.
- Hiveory stores nothing new: the key *is* the id it already persists.

### 5. Starting Hiveory takes the terminals back

- The app reaches the daemon (or starts one) and calls `pty.list`:
  - **Live terminal:** the agent's `PtySession` attaches to it instead of launching. `pty.attach`
    returns the output kept while detached; it is fed into the session's buffer and headless mirror,
    so the pane, status detection and phone viewers see the real screen. The pane redraws at the
    pane's size.
  - **Terminal that ended while Hiveory was closed:** reported with its exit code. The agent then
    follows today's rules: resume its conversation (ADR 0014), or restart if it crashed.
  - **No terminal (after a reboot, say):** today's resume. The saved output (ADR 0044) stays the
    fallback.
- A terminal whose key Hiveory no longer knows (its agent was removed meanwhile) is ended.
- **Process verdicts are `live`, `unverifiable` and `exited`:**
  - Losing contact with the daemon is never evidence that a process ended. Panes say "Reconnecting
    to its terminal…", not "Session ended".
  - Auto-recovery never starts a second CLI on the same conversation while the first may still run.
  - Only the daemon's exit report means `exited`.
  - When the daemon stays unreachable, the agent shows **Start again**, which first ends the old
    process by pid if it is still running.

### 6. Hooks and agent tools reach Hiveory across restarts

- The daemon runs the **relay**: a loopback HTTP listener on `127.0.0.1` with a port it keeps for
  its whole life.
- Agents are launched with relay URLs, so the URLs stay valid as long as the terminal lives.
  - `/hooks/<instanceId>/<event>` is forwarded to the attached app as a `relay.hook` event.
  - `/mcp/<instanceId>` is forwarded as a `relay.mcp` call.
- The checks are today's: a token header, no `Origin` header (against DNS rebinding), and bodies up
  to 1 MiB.
- **While no app is attached:**
  - Hook events are kept per terminal, the last 64, and replayed on attach, so the status machine
    catches up (a permission prompt that appeared while Hiveory was closed reads as **Needs you**).
  - MCP calls get a JSON-RPC error, "Hiveory is not open". The agent keeps working, just without
    Hiveory's tools.
- At detach the app saves each agent's last runtime details. On attach they are the starting point,
  then replayed hooks and the screen (ADR 0049) correct them.

### 7. Quitting detaches by default

- **Setting:** Settings › Agents › **Keep agents running when Hiveory quits** is on by default.
  - On: Quit leaves the daemon, its terminals and the relay running.
  - Off: Quit ends them, as today.
- **Quit choice:** the tray and the Quit menu also offer **Quit and stop agents**.
- **Grace policy.** A daemon with no app attached keeps its terminals:
  - until they exit, by default;
  - or for a chosen limit: 1 hour, 1 day or 7 days.
  - The same policy replaces the remote 5-minute grace (`RECONNECT_GRACE_MS`, hiveoryd `GRACE_MS`).
  - A daemon with no terminals and no app exits after 60 s.
- Output kept while detached stays bounded: the newest 2 MiB per terminal.
- **Visibility:** the tray shows "N agents running" while Hiveory's window is closed. On Windows the
  daemon has no window of its own.

### 8. Updates do not end terminals

- **Relocated runtime.** The daemon runs from its own copy of the runtime, never from the install
  folder: `<data>/hiveoryd/runtime/<version>/`.
  - **What it holds:** the executable renamed `hiveoryd(.exe)` with the files node mode needs, plus
    `host.js` and the native PTY module.
  - **Integrity:** the copy is checked against a SHA-256 manifest before each start; a mismatch
    makes a fresh copy.
  - **Why:** the installer, the macOS updater and an AppImage unmount then never touch a running daemon.
  - **Pruning:** old copies are removed only when no daemon runs from them.
- **The endpoint is namespaced by protocol, not by build.** A new app with the same protocol adopts
  the running daemon.
- **Core frames are frozen:** `hello`, `pty.list`, `pty.attach`, `pty.write`, `pty.resize`,
  `pty.kill`, `pty.data`, `pty.exit` and the relay frames. A breaking change only adds frames and
  bumps `HOST_PROTOCOL`.
- **After a protocol bump:**
  - The new app starts a new daemon for new terminals.
  - It still attaches to the old daemon through the core frames, so its terminals keep running.
  - The old daemon takes no new terminals and exits when its last one ends.
  - The app keeps two `HostClient`s, as it already does for remote hosts.

### 9. Server mode adopts the same daemon

- `hiveory --serve` (ADR 0022) uses the profile's daemon like the desktop does. Switching a computer
  between desktop and server mode reattaches every terminal instead of ending them.
- A profile is either a desktop or a server at any moment; the single-instance lock enforces this.

### 10. Per platform

- **Windows:** `detached` plus `windowsHide`. If Hiveory itself was started inside a kill-on-close
  job (some terminals and IDEs do this), the daemon may still end with it. The app detects that it
  did and says so; it does not try to escape the job.
- **Linux:** when `systemd-run --user` is available, the daemon starts in its own `--scope`, so
  closing the desktop app's cgroup does not end it.
- **macOS:** a detached child is reparented to launchd. Permission prompts for folders keep naming
  Hiveory because it is the same signed binary.
- **Development builds** use their own profile and endpoint, and run `out/main/host.js`.
  - A rebuilt `host.js` does not replace a running daemon (same protocol).
  - **Restart terminal host** (Settings › About) ends the daemon and its terminals after a
    confirmation, and starts a fresh one.
  - `pnpm dev`'s instance handoff (e1307e0) reattaches instead of restarting the agents.

### 11. What users see

- Settings › Agents gains **Terminal host**:
  - a line: running since, terminals held, version;
  - the setting from §7;
  - **Restart terminal host**.
- `product-spec.md`, `ui-map.md` and `APP_GUIDE` get these when each part ships.

### Contract changes

- `src/shared/host/protocol.ts`:
  - `HOST_PROTOCOL` becomes 3;
  - `PtySpawnParams.key`;
  - `pty.list`;
  - the mutual `hello`;
  - `relay.hook` / `relay.mcp`;
  - a frozen-core comment that names the frames above.
- **Settings:** `keepAgentsAfterQuit: boolean` and `detachedGrace: 'until-exit' | '1h' | '1d' | '7d'`.
- **Nothing new reaches the renderer** except settings and the terminal host's status line. No
  phone channel changes.

## Consequences

- Quitting, updating and restarting Hiveory no longer kill running work, and agents keep their
  status across restarts. A reboot, logging off or ending the daemon still ends terminals; resume
  (ADR 0014) and saved output (ADR 0044) remain the answer there.
- **Costs:**
  - a relocated runtime per version on disk, about the size of the app, with old ones pruned;
  - more states to get right (attach, adopt, drain, unverifiable);
  - a relay that must stay compatible across app versions.
- Processes keep running while no window is open. The default (keep until they exit) trades
  resources for durability; the tray count and the grace limit are the guard rails.
- **Residual risk:** any process running as the same user can read `endpoint.json` and drive the
  daemon, as it can already read Hiveory's files and its loopback tokens today. Other users cannot.
- **Built in phases**, each with its tests (rule 21):
  1. Detached daemon locally: endpoint, mutual hello, ownership, keys, `pty.list`, adopt on start,
     quit detaches, the setting, verdicts.
  2. The relay for hooks and MCP: kept hooks, replay, saved runtime details.
  3. Relocated runtime, protocol drain, grace policy unified with remote hosts.
  4. Server-mode adoption, Linux scope, the Terminal host section, the tray count.
- **Left for later:**
  - spilling kept output to disk beyond 2 MiB;
  - giving remote hosts a relay of their own (their hooks still use the SSH tunnel);
  - escaping kill-on-close jobs on Windows.

## Amendment (2026-10-21): phase 1 as built

- **Built.**
  - `hiveoryd --daemon --local <Runtime>/hiveoryd` is started detached by `LocalHost`, with
    `endpoint.json` (mode `0600`).
  - The endpoint is a pipe named from the profile's folder and the protocol (`localEndpointPath`).
  - The mutual hello is `hello` then `auth` (`handshake.ts`, `gateHost`).
  - Endpoint ownership is `publish` in `src/host/endpoint-owner.ts`.
  - Terminals carry keys; `pty.list` and `shutdown` are new calls.
  - Live terminals are adopted at start-up (`LocalHost.prepare` / `take`) by agents and shells.
  - Quit detaches; the setting is `keepAgentsAfterQuit`, with "Quit and stop agents" in the tray.
  - A dropped link means "Reconnecting to its terminal…", then reconnect and `adopt`; only after
    that fails are the terminals given up.
- **`hold`, a frozen-core call.** Before letting go, the app asks the daemon to keep output from
  that moment, and saves each terminal's exact tail only after the answer. The stream is ordered,
  so no byte falls between the saved tail and the kept output. The saved tail is exact
  (`exactTail`), not ADR 0044's trimmed replay.
- **Redraw after adopting.** Adopting resizes the terminal one row smaller and back, so full-screen
  CLIs draw their whole screen at the pane's size.
- **Frame limit.** It is 16 MiB, not 1 MiB: a `pty.attach` result carries up to 2 MiB of kept
  output, which JSON escaping can more than double.
- **Interim for §6.** Until the relay exists, the hook server keeps its port and token in
  `<Runtime>/hook-endpoint.json` (mode `0600`; still kept, now behind the relay of phase 2). An agent kept across a restart therefore still
  reaches Hiveory for hooks and tools with the URL it was started with. If that port has been taken
  meanwhile, a new one is used, and kept agents fall back to heuristics.
- **Windows handle inheritance.** A child inherits every inheritable handle its parent holds, so a
  daemon started by an app whose stdio is a pipe (Playwright, a supervisor) holds that pipe open.
  Installed builds started from the shell have no such pipe.
  - Automated runs set `HIVEORY_STOP_AGENTS_ON_QUIT=1`. They use the utility host and never leave a
    daemon behind.
  - Escaping inherited handles is left with the Windows job question (§10).
- **Verified** in the built app: an agent's loop kept printing after quit, the daemon stayed up, and
  the next start attached the same daemon and showed every line, with none lost or doubled. "Quit
  and stop agents" ended the daemon and removed `endpoint.json`.
- **Not yet:** phases 2–4. Kept remote terminals are not yet adopted across an app restart (their
  daemon has `pty.list`, but nothing calls it yet).

## Amendment (2026-10-21): phase 2 as built

- **The relay is the hook server class itself,** run inside the daemon (`src/host/relay.ts`). It keeps
  its port and token in `<Runtime>/hiveoryd/relay.json` and publishes them in `endpoint.json`.
- **Agents are launched with the relay's URL** whenever the durable daemon serves this app
  (`LocalHost.relayEndpoint`, used for hooks and for `mcpFor`). Otherwise they get Hiveory's own hook
  server. That server keeps its port too (phase 1), and stays for chats and remote tunnels.
- **Start-up starts the daemon,** if none is running, before any agent launches, so the relay
  exists first.
- **While no app is attached:**
  - hooks are kept, the newest 64 per agent, and handed over once by `relay.kept`;
  - MCP calls get a JSON-RPC error: "Hiveory is not open…".
- **With an app attached:** `relay.mcp` events are answered with `relay.reply`. Pending calls end at
  once if the app leaves.
- **A taken-back agent starts from a saved status.** At detach each running agent's runtime details
  are saved (`<Runtime>/<id>/status.json`). On adopt they are restored, then its kept hooks are
  applied in order.
- **Verified** in the built app with a Claude Code agent:
  - its tools went through the relay;
  - they were refused while Hiveory was closed and worked again after it reopened;
  - the kept agent came back with its real status (**Needs you**).
