# Plan: Speed and memory

Status: **Phase 0 (ADR 0066), flow control (ADR 0067), chat deltas (ADR 0068) and the second round of measurements (§7.2) are done** (2026-11-10); the rest is proposed. Phase 0's numbers changed
the order of the work: read §3.1 and §7 before the phases in §4. Each phase gets its ADR when it
starts (rule 29), and nothing here becomes a rule until it is in AGENTS.md / CLAUDE.md.

This plan answers four questions:

1. Why does Hiveory lag and sometimes hang with several agents running?
2. What do comparable open-source apps do, and which of their choices fit Hiveory?
3. In what order can we fix it **without losing a single feature**, including terminals and
   chats that outlive Hiveory, the server, the phone, and remote hosts?
4. Should parts of the backend be written in Rust?

Vocabulary as in the contract: users see **Workspace**, **Worktree** and **Schedule**. Code names
(`Project`, `Workspace`, `Routine`, `hiveoryd`, `PtySession`…) are used for mechanics.

---

## 1. What must never break

These are the invariants. Every phase lists which of them it touches. A phase ships only when the
tests named here pass on Windows, macOS and Linux.

| # | Feature | Where it is decided | Guard test |
|---|---|---|---|
| I1 | Quitting with **Keep agents running** leaves terminals running. On restart each agent re-attaches to the *same* process and shows its real screen | ADR 0050 §5, §7 | new `e2e:durability`: same pid and screen after a quit and relaunch |
| I2 | A chat turn keeps running while Hiveory is closed. On restart the reply is rebuilt and keeps streaming | ADR 0051 | `e2e:durability`: a reply mid-stream survives a quit |
| I3 | Hooks reach Hiveory across restarts. A prompt that appears while it is closed reads **Needs you** on return | ADR 0050 §6 | `e2e:durability`: a hook fired while closed is replayed |
| I4 | An update never ends a terminal. A new app adopts the running daemon through the frozen core frames | ADR 0050 §8 | daemon tests for a protocol bump and adoption |
| I5 | After a reboot, an agent resumes its conversation. The saved output is the fallback | ADR 0044, 0014 | existing tests |
| I6 | Status is exactly `idle` / `working` / `waiting-for-you`, from hooks, heuristics and on-screen confirmation | rule 6, ADR 0006, 0049 | status-machine and heuristics tests |
| I7 | `hiveory --serve` runs headless. A paired desktop client and the phone see the same Workspaces, agents and terminals | ADR 0022, 0027, 0048, 0052, 0053 | server tests, `pnpm mobile:check`, phone channel test |
| I8 | A phone watching a terminal sizes it to its screen while it watches | ADR 0048 | existing PTY session tests |
| I9 | SSH hosts run `hiveoryd` with Hiveory's own Node. Remote work never silently runs locally | ADR 0022, 0025, 0026 | host-services tests |
| I10 | Agent tools read screens, deliver messages with bracketed paste, drive the browser and the computer | ADR 0015, 0016, 0032 | `e2e:tools` |
| I11 | Kanban, attention badge, tray count, Pluto link and native alerts follow live status | ADR 0054, 0061 | `e2e`, `e2e:native` |
| I12 | Schedules fire from Hiveory, and missed runs within 12 hours catch up | ADR 0046, 0051 | routine tests |
| I13 | Hidden terminal tabs get the activity mark. Terminals off screen for 90 s are freed and rebuilt | ADR 0044 | `e2e:panes`, `e2e:layout` |
| I14 | Changes, Review, Pull request and git status stay current | ADR 0058, 0064 | `e2e:changes` |
| I15 | All saved data (Workspaces, Worktrees, agents, presets, chats, Schedules, settings) survives every upgrade | ADR 0008 | migration tests (Phase 4) |
| I16 | One failing feature never takes another down | ADR 0009 | existing guards |

**How a phase proves it.** Before a phase starts, its guard tests must exist and pass on today's
code. After the change they must pass unchanged. A test that has to be *edited* to pass marks a
behavior change, which needs the product owner's yes and an ADR.

---

## 2. What comparable apps do

| App | Stack | Where terminals live | Storage | Remote / server | Lesson for Hiveory |
|---|---|---|---|---|---|
| **VS Code** | Electron, TS | **pty host** in a utility process. One MessagePort per window goes **straight to the renderer**, with a fallback through main. xterm-headless on the pty host, plus the serialize addon for reconnects. Flow control: 100,000 / 5,000 / 5,000 characters | files, SQLite for state | VS Code Server runs plain Node (no Electron) | Get terminal bytes off main. Use flow control. Reconnect from a serialized screen |
| **Orca** (Stably AI) | Electron, TS | detached **daemon child process** (node-pty) on a Unix socket with a token | **SQLite** | `orca serve` headless, a WebSocket RPC for CLI and phone, an SSH relay | Same daemon shape Hiveory took (ADR 0050). Process ownership lives on the host side, and "unknown ≠ dead" |
| **Emdash** | Electron, TS | PTY runtime in **worker processes**, typed "Wire" RPC over a preload port | **SQLite (Drizzle)** | SSH | Heavy work runs in workers. A pool of ready worktrees makes new tasks start instantly (~80 ms vs ~2,300 ms) |
| **Wave Terminal** | Electron + **Go** backend | Go `wavesrv` owns processes. `wsh` static binary on remotes | **SQLite** | `wsh connserver` on SSH hosts | Compiled backend chosen *at the start*. Route-based RPC, the same call local or remote |
| **vibe-kanban** | **Rust** (Axum) + React | Tokio-spawned agent processes | **SQLite (sqlx)** | single binary, web UI over HTTP and WebSocket | Rust from day one. A `Deployment` trait gives local and remote the same services |
| **code-server** | Node + VS Code | VS Code's pty host | files | plain Node HTTP server, Docker image, systemd | How a Linux server is packaged and reached from any device |

**What they agree on:**

1. Terminal output never runs through the UI-owning thread (VS Code, Orca, Emdash, Wave).
2. Flow control from the screen back to the PTY (VS Code, xterm.js guide).
3. SQLite for app state (Orca, Emdash, Wave, vibe-kanban, all four).
4. A daemon that outlives the window (Orca, VS Code reconnection, Wave).
5. One RPC contract shared by local, remote and phone (Wave, Emdash, Orca). Hiveory already has
   this in `src/shared`.

**Where they differ.** Language. Node-hosted PTYs (VS Code, Orca, Emdash) are as smooth as the
Go and Rust ones once the architecture is right. None of these apps rewrote a working backend
into another language mid-life. See §5.

---

## 3. What is slow today

Read from the code. Phase 0 measures each item before anything is changed.

| # | Hot spot | Where | Why it hurts |
|---|---|---|---|
| H1 | Every agent's output is parsed by a headless xterm **in main** | `pty-session.ts:283` (`mirror.write`) | VT parsing for N agents shares the thread that owns windows, IPC and menus. Claude Code and OpenCode redraw all the time |
| H2 | The output buffer copies 512 KB per chunk once full | `output-buffer.ts:16` | joining strings, then `slice`, flattens and copies the whole buffer on each chunk |
| H3 | No flow control | `pty-session.ts`, `terminal-registry.ts` | one flooding agent can queue megabytes in the renderer, and keystrokes wait behind them |
| H4 | Each chat tick re-sends the whole reply | `chat-service.ts:406` (`structuredClone(reply)` every 50 ms) | O(n²) over the reply's length, in IPC and in cloning |
| H5 | Chat markdown is re-parsed whole each tick | `Markdown.tsx:16` (marked + DOMPurify on the full text) | O(n²) on the renderer thread, so long replies stutter |
| H6 | Every chat is read at startup | `chat-store.ts:21` | startup time grows with history |
| H7 | The state store clones everything on each update and writes pretty-printed JSON synchronously | `state-store.ts:51`, `:63` | 43 call sites. Cost grows with saved data. Phase 0 decides whether it matters |
| H8 | Whole-store subscriptions | `useChat()` in `ChatComposer.tsx:69`, `AgentPicker.tsx:119`; `useLayouts()` in `WorkspaceScreen.tsx:57`; 12 more | the composer re-renders on every chat event |
| H9 | 1.27 MB main bundle, 2 lazy screens | `out/renderer/assets/index-*.js` | parsed on every window start |
| H10 | Renderer never throttled | `window.ts:58` (`backgroundThrottling: false`) | full-speed rendering while hidden in the tray |
| H11 | Git polling | Changes 10 s, git status 20 s, PR 30 s, worktree sync 30 s | each starts git processes, which are costly on Windows |
| H12 | One WebGL context per terminal on screen | `terminal-registry.ts:344` | Chromium caps live contexts, and losing one means a rebuild |
| H13 | Hidden browser pages keep their renderer | `browser-service.ts:314` | each page is a full Chromium process |

### 3.1 What Phase 0 measured

Measured with `pnpm e2e:perf` on one Windows development machine, five runs, terminals in the
terminal host. The baseline is `scripts/perf-baseline.json`.

| Scenario | Result | Goal | Verdict |
|---|---|---|---|
| Six terminals printing 250,000 characters a second each | main late by 7 ms (p99), full frame rate, typing echoes in 14 ms | 50 ms | **Fine.** Ordinary agent output is not the problem |
| Two terminals printing as fast as they can | main late by **5–14 s**, window blocked for **3–8 s**, 0.4–6 fps, a typed character takes **over 3 s** to echo | 50–100 ms | **This is the hang** (H3, and H1/H2 at volume) |
| Memory right after that flood | window process **870–1,050 MB** (159 MB idle); terminal host up to **730 MB** (106 MB idle) | 400 MB | The backlog queues up in every process on the way |
| 50,000-character chat reply | no blocked frame, main late by 7 ms; each character crosses to the window **128 times** | 3 times | H4 is real waste, H5 is not felt at this length |
| Start-up with 200 chats of history | 0–135 ms more than an empty profile (1.5–1.7 s): inside the run-to-run noise | 100 ms | H6 is small |
| Clicks (sidebar, side panel, Worktree switch, Settings) | next frame in 36–46 ms, no long task | 67 ms | Fine |
| Idle, four terminals | 756 MB in all: main 160, window 159, terminal host 106, the rest GPU and helpers | none yet | The floor to lower |

What follows from it:

- **Flow control comes first.** Any command that prints without pause (a build log, a test run, a
  large `cat`) freezes the whole app and balloons memory, because nothing between the PTY and the
  screen can say "wait". That is one fix at the source, and it does not need the engine moved.
- **Moving the terminal engine out of main (old Phase 2) is not yet justified.** At ordinary
  load main is idle. It is decided again from the numbers after flow control.
- **Chat deltas stay worth doing** (128 times is waste on every reply, and it grows with length),
  but block-by-block markdown has no measured need yet.
- **Not measured yet:** real TUIs that redraw with cursor movement (heavier to parse than plain
  lines), re-render counts, slower machines, macOS and Linux. Phase 1 adds a redraw scenario.

Phase 0 also found and fixed a bug: output printed in the instant a terminal or chat reply starts
or is taken back was dropped (a reply could come back missing lines after reopening Hiveory).

---

## 4. The phases

**Order.** §7 has the order to build in, revised after Phase 0. The phases below keep their
original numbers and text.

Each phase is independent and shippable. It lands as its own PATCH release behind a switch where
noted, keeps the old path as the fallback for one release, and passes the §1 guards.

### Phase 0: Measure and guard (no behavior change) — done, ADR 0066

**Goal:** numbers to steer by, and tests that catch any lost feature. As built: `pnpm e2e:perf`,
`pnpm e2e:durability`, `scripts/perf-baseline.json`, and a `guards` CI job (report-only until it
has run green on all three systems). Not built: the seeded 50 Worktrees and 20 agents for
start-up (only chat history is seeded).

- **Performance scenarios** in `scripts/e2e-perf.mjs`, which already measures long tasks:
  - **Flood:** 6 shell terminals each print as fast as they can. Record:
    - main's event-loop delay (`perf_hooks.monitorEventLoopDelay`, p50/p99);
    - renderer long tasks;
    - keystroke echo time, typing into a seventh terminal. This is the xterm.js guide's
      "run `yes`, press Ctrl-C" check.
  - **Chat:** a fake CLI streams a 50,000-character reply. Record renderer long tasks and total
    IPC bytes.
  - **Startup:** time to first paint with 200 chats, 50 Worktrees and 20 agents seeded.
  - **Memory:** `app.getAppMetrics()` per process type, plus `hiveoryd` RSS, idle and with 8 agents.
- **Durability suite** `e2e:durability` for I1–I4: quit with agents kept, relaunch, then assert
  the same pid, the restored screen, the status, a chat still streaming, and a replayed hook.
- **Budgets.** The first run records the baseline. Targets:
  - main event-loop delay p99 under **50 ms**. 50 ms is the browser's long-task threshold.
  - no renderer task over 50 ms while streaming;
  - keystroke echo under 50 ms during a flood;
  - startup and memory no worse than baseline; later phases set the goals.
- **CI** runs the suites on `windows-latest`, `macos-latest` and `ubuntu-latest` (under
  `xvfb-run`, per Electron's headless-CI guide) and fails on a budget regression.

Touches no feature. **ADR:** yes, because it adds a CI workflow (rule 29).

### Phase 1: Main-thread diet (internal only: same protocol, same files, same UI)

Every step keeps its interface, so no caller changes.

1. **Chunk ring buffer (H2).** `OutputBuffer` keeps a list of chunks and a total length, and
   drops whole chunks from the front. `append` and `snapshot` keep their signatures, and offsets
   stay monotonic, so the renderer's merge (`writeChunk`) is untouched. Test: a property test
   that offsets and snapshot content equal today's for random chunk streams.
2. **Cheaper saves (H7).** Stop pretty-printing `state.json`. It stays valid JSON, so an older
   version still reads it (I15). The deep clone in `update` is replaced only if Phase 0 shows it
   costs over 1 ms. Then copy-on-write per top-level collection.
3. **Chat deltas (H4).** New event `chat.delta` `{ chatId, messageId, part, append }` on the same
   50 ms tick:
   - `chat.event` (the full message) is still sent when a reply starts, when it ends, when a part
     is added or replaced, and on every (re)connect;
   - server clients (phone, desktop client) keep receiving full `chat.event` until they opt in
     (`?deltas=1`), so I7 holds with no phone release;
   - recovery (I2) is untouched, because it runs from the daemon's whole output in main.
4. **Markdown by blocks (H5).** Split text with `marked.lexer`. marked is already installed, and
   this is the Streamdown / AI SDK memoization pattern without adding the library. Each finished
   block is parsed and sanitized once and memoized by its raw text, and only the last block
   re-renders. **When the reply ends, the whole text is rendered once as today**, so the final
   HTML is byte-identical. That covers edge cases such as reference links defined later. Test:
   fixture corpus where final HTML equals today's.
5. **Selectors (H8).** The 15 whole-store hooks take selectors, or `useShallow` for several
   fields (Zustand docs). A lint rule forbids a bare `useStore()`.
6. **Lazy screens (H9).** `React.lazy` for Chat, Browser, Explorer, Changes / Review, Pull
   request and the Schedule editor, as Settings and the code editor already are. The fallback
   reuses the existing loading component. Measure with a bundle report.
7. **No work for absent listeners.** `server.ts:309` builds the SSE frame only when a stream
   wants the event.
8. **React Compiler 1.0 (H8), last in this phase.** Enable it with `compilationMode:
   'annotation'` (files opt in with `"use memo"`), then switch to automatic once the e2e suites
   pass. `@vitejs/plugin-react` v6 wires it through `@rolldown/plugin-babel` and
   `reactCompilerPreset()`. A component that misbehaves opts out with `"use no memo"`.
   **ADR:** yes (a new dependency).

Touches I2, I7, I13. Each step's guard is named above. **ADR:** for step 3 (a new event on the
shared contract) and step 8.

### Phase 2: The terminal engine moves into `hiveoryd` (H1, H3)

**Goal:** main stops parsing terminal output. This follows VS Code's pty host and Orca's daemon.
`hiveoryd` already owns every local and remote PTY (ADR 0022, 0050). Today it forwards raw bytes,
and main re-parses them.

1. **Capability handshake.** `hello` gains `features: string[]`.
   - An older daemon still running after an update reports none, and its terminals keep today's
     path (mirror in main) until they end.
   - The frozen core frames are unchanged and `HOST_PROTOCOL` stays at 3, so the new app
     **adopts** the running daemon (I4). No terminal ends on upgrade.
2. **New, additive frames:**
   - `pty.screen {ptyId, lines}` returns the visible text and the bracketed-paste mode;
   - `pty.ack {ptyId, chars}` is flow control;
   - `pty.watch {ptyId, viewer, on}` registers a viewer.
   The daemon keeps the headless mirror (`@xterm/headless`, already bundled into `host.js`) and
   the chunk ring. It already keeps 2 MiB per terminal while detached, and this unifies the two.
   Remote daemons get the same frames, so SSH hosts gain the same speed (I9).
3. **Main side.**
   - A `PtySession` on a daemon with `screen` has no mirror.
   - `screenText` becomes async. About 15 callers change (agent tools, `deliver`, the excerpt in
     `handlers.ts`). This is a mechanical change with tests.
   - The heuristics' screen check (ADR 0049) already runs only on the 250 ms tick, "when
     something needs it". It now asks the daemon, so a confirmed prompt can show at most one tick
     later (≤ 250 ms). That is within today's tolerance.
   - Status detection on fresh output (cheap regexes) stays in main for now.
4. **Flow control, using VS Code's constants:**
   - The daemon pauses the PTY (`node-pty` `pause()` / `resume()`) when a viewer's unacknowledged
     characters pass **100,000**, and resumes below **5,000**.
   - The renderer acknowledges every **5,000** parsed characters, from xterm's write callback.
   - Rules that protect I1, I7 and I10:
     - only a registered viewer counts;
     - a viewer silent for 5 s is dropped from flow control and re-syncs from a snapshot;
     - phones and SSE clients are never flow-controlled: a slow one is resynced;
     - **with no viewer the PTY is never paused**, so an agent never slows down because the
       window is hidden, closed or on another Worktree.
   - Test: flood plus Ctrl-C under 50 ms, and an unwatched flood running at full speed.
5. **Faster re-attach (conditional).** If Phase 0 shows opening a pane is slow from replaying
   512 KB of raw output, the snapshot can come from the daemon's mirror via
   `@xterm/addon-serialize` (VS Code's `ptyService.serializeTerminalState`).
   - This ships only if a test proves the restored history is **at least as long** as today's.
     The mirror's scrollback is sized to match.
   - Raw replay stays the fallback.
   - The renderer's replay guard (dropping capability replies during replay) is unchanged.
   - **ADR:** yes (a new dependency).

Touches I1, I4, I6, I8, I9, I10. **ADR:** yes (new host frames, a new `terminal.ack` IPC channel,
an amendment to ADR 0050).

### Phase 3: Direct stream to the window (only if Phase 2's numbers still show main busy)

**Goal:** terminal bytes skip main completely. This copies VS Code's **direct proxy**:
`renderer ↔ ptyHost` over a MessagePort, with `renderer ↔ main ↔ ptyHost` kept as the fallback.

- The local daemon is detached and listens on a named pipe or socket (ADR 0050), and Electron
  MessagePorts cannot reach it. So a small **terminal bridge** runs as an Electron
  `utilityProcess`:
  - it connects to the daemon with the existing `HostClient`;
  - it hands each window one `MessagePort`: `MessageChannelMain`, then
    `utilityProcess.postMessage` and `webContents.postMessage` (Electron docs);
  - the preload exposes only a narrow `terminalPort()`, never `ipcRenderer` (rule 4).
- Status detection moves into the daemon. Adapter heuristics are data: regex sources, sent at
  spawn. The daemon emits `pty.hint` events, so main does no per-byte work.
- Main subscribes to a terminal's bytes only while an SSE client watches it. `server.ts` already
  filters streams per terminal.
- Client mode (a desktop paired to a server) and any failure fall back to today's indirect path.

Touches I1, I6, I7, I11, I13. **ADR:** yes (a new process, a new preload API, a widened IPC).

### Phase 4: Storage in SQLite (H6, H7)

**Why SQLite:** Orca, Emdash, Wave and vibe-kanban all keep app state in SQLite.

**Why `node:sqlite` and not better-sqlite3:**
- it ships inside Electron 44's Node 24.21. Verified on this machine: it loads with no flag and no
  warning, reports SQLite 3.53.4, and WAL works;
- no native rebuild for Electron, the daemon or remote Node;
- the API (`DatabaseSync`, `prepare`, `run`, `all`) is in Node's docs;
- its stability label must be confirmed in Node 24's docs before the ADR.

- **Tables** per entity, with chat messages as rows (`chat_id, seq, json`).
  - A streaming save writes one row, not the whole chat.
  - Startup reads chat summaries only, and messages load when a chat opens.
  - `ChatService.recover` queries the replies still marked streaming (I2).
- **The same `StateStore` interface** (the `state` getter, `update`). It stays an in-memory
  cache with write-through of the changed collections, so the 43 call sites are untouched.
- **Migration (I15):**
  1. Copy `state.json` and `chats/` to a dated backup.
  2. Import everything in one transaction.
  3. Run `PRAGMA quick_check`.
  4. If any of this fails, keep running on JSON with a notice (ADR 0009).
- **Downgrade safety:** keep writing the JSON files as today for two releases, then stop. See §8.
- The phone and remote clients are unaffected because they talk HTTP. `hiveoryd` keeps no app
  data.

Touches I2, I15. **ADR:** yes (a stored-data format change).

### Phase 5: Less background work (H10–H13)

1. **Git by events (H11).**
   - Watch `.git/HEAD`, `index` and `refs`, debounced 300 ms, then run one `git status`. Remote
     Worktrees use the daemon's existing `files.changed` path.
   - Polling stays as a slow backup, because watchers miss events on network drives and WSL
     (I14).
   - Identical concurrent git commands share one process (single-flight), with at most 4 git
     processes per repository.
2. **Later start for what the first paint doesn't need.** Update check, LAN discovery, Tailscale
   status, skill and extension scan, theme and wallpaper scan start after `ready-to-show`. This
   follows "loading and running code too soon" in Electron's performance checklist.
   **Schedules still start at boot** (I12).
3. **WebGL only on screen (H12).** Release a terminal's WebGL context when it leaves the screen
   and reattach on show. DOM rendering and context-loss handling already exist.
4. **Hidden window (H10), needs the product owner (§8).** Work and chat stream in main and the
   daemon, not the renderer. With throttling on, a hidden window still receives IPC messages, so
   activity marks keep working (I13), but rendering pauses until shown. Requires an audit that no
   renderer timer does needed work while hidden.
5. **Sleeping browser pages (H13), needs the product owner (§8).** Close a hidden page's
   renderer and keep its URL and title, then recreate it on show. A page never sleeps while an
   agent drove it in the last N minutes or while it plays media.

Touches I10, I12, I13, I14. **ADR:** yes for 4 and 5 (they change what users see).

### Phase 6: Server anywhere, on every desktop OS

1. **Headless Linux without a display.** `hiveory --serve 7788 --ozone-platform=headless`.
   - Electron documents `headless` as "Don't connect to any display server". The switch must be
     on the command line; `appendSwitch` is too late. So the launcher passes it.
   - Verify that the agent browser (offscreen pages) works this way. If it does not, the server
     documents `xvfb-run` as the fallback.
   - **We keep one server: the Electron build.** A separate plain-Node server, as VS Code Server
     and code-server have, would drop the built-in browser and computer tools that need Chromium
     (I10). The cost is a bigger install, not lost features.
2. **Packaging, following code-server's model:**
   - a systemd user unit (`hiveory-server.service`, with `loginctl enable-linger` so it runs
     without a login);
   - a Docker image with git and the CLIs mounted from the host;
   - both built by the release workflow.
3. **Version skew.** `/health` returns the version and `features` (the same idea as the daemon
   handshake). A desktop client or phone hides what an older server lacks, instead of failing.
4. **Every OS.** The Phase 0 suites run on all three platforms on every PR. Native pieces
   (node-pty, a possible Rust addon) ship prebuilt per target: win x64/arm64, mac x64/arm64,
   linux x64/arm64.
5. **Any device** already works: pairing code, Tailscale, LAN discovery, SSH tunnel, phone app.
   A browser client, serving the renderer over HTTP as code-server and vibe-kanban do, is a later
   product decision (§8). The groundwork is that the renderer's `lib/api` (`api()`, `subscribe()`)
   stays the only transport seam.

Touches I7, I9. **ADR:** yes (a release step, a server endpoint field).

### Phase 7: Rust, only if Phase 0 still points at `hiveoryd`

See §5. Gated on measurements taken after Phase 2.

---

## 5. Rust: the decision

**Yes, Rust works alongside Electron.** There are two proven ways:

- a **napi-rs addon**: a native module loaded by Node. Low call overhead (ScyllaDB chose it over
  Neon), and prebuilt binaries for every target from the napi-rs CLI;
- a **sidecar binary** speaking a protocol (Wave's `wsh`, vibe-kanban, Zed's remote server).

**But a rewrite is not justified:**

- `hiveoryd` reuses main's own `GitService`, `WorktreeService` and `FileService` through
  `invoke` (`host-server.ts:122`). A Rust daemon would duplicate every one of them (rule 1), and
  every future feature would be built twice.
- The comparable Node apps (VS Code, Orca, Emdash) are smooth with node-pty once output is off
  the UI thread. The Go and Rust apps chose their language at the start. None migrated mid-life.
- Inside Electron, napi-rs cannot hand over buffers zero-copy, because of V8's memory cage (napi-rs
  docs). Every chunk is copied at the boundary.
- The lag comes from O(n²) work and work on the wrong thread. Phases 1–3 fix that in TypeScript.

**When Rust is allowed.** Phase 0 runs after Phase 2. If `hiveoryd` CPU or memory per terminal
is then the bottleneck:

- a **napi-rs addon inside `hiveoryd`** replaces `@xterm/headless` and the chunk ring, with VT
  parsing from the `alacritty_terminal` (or `vt100`) crate;
- it sits behind the daemon's own internal interface, so no protocol or UI change;
- it falls back to the JS engine if the addon fails to load;
- prebuilt binaries for all six targets.

A full Rust `hiveoryd` (which would also run on musl / Alpine and Windows remotes) is a separate
product decision. It is not a speed fix.

**Not Tauri.** The built-in browser and agent browser tools rely on Electron's `WebContentsView`
and the DevTools protocol, xterm.js WebGL is weak on Linux WebKitGTK, and moving would mean
rewriting the app.

---

## 6. Staying easy to extend

Proposed contract **rule 30, Performance**. It goes into AGENTS.md and CLAUDE.md with the
Phase 1 ADR.

- High-volume data (terminal bytes, chat deltas) travels on its own stream, never through
  `state.changed` or the generic event channel.
- No synchronous file I/O in main after startup, no whole-state clone, and no per-chunk parsing
  in main.
- Renderer store hooks always take a selector. Each new screen or panel is lazy-loaded.
- A new service starts on first use, can be disposed, and declares if it must start at boot.
- Host-side features are additive frames announced in `hello.features`. Core frames stay frozen
  (ADR 0050 §8).
- Every PR keeps the Phase 0 budgets green on all three OSes.

**How a new feature plugs in:**

1. Add its types to `src/shared` (one contract: desktop, server, phone).
2. Put the service in main, or in `hiveoryd` if it touches the execution host (Orca's "the
   execution host owns execution").
3. Add the IPC channel to the contract. Add it to `REMOTE_CHANNELS` / `MOBILE_CHANNELS` if
   clients may call it.
4. Add a lazy screen with selector-based stores.
5. Add a perf scenario if it streams.

---

## 7. Order and expected payoff

Revised after Phase 0 (§3.1). Each step ends when its goals in `pnpm e2e:perf` are met and
`pnpm e2e:durability` passes.

| Order | Work | Size | Goal it must meet | Risk to features |
|---|---|---|---|---|
| done | Phase 0: measure and guard | S | baseline and guards exist | none |
| done | **Flow control, end to end** (ADR 0067: the window acknowledges, main counts, the terminal host pauses the PTY), and the chunk ring buffer (Phase 1 step 1) | M | see §7.1 | an unwatched agent never slows down (unit tests, `e2e:durability`) |
| done | Chat deltas (ADR 0068; Phase 1 step 3) | S | `chat.sentPerCharacter`: **1** (was 128; goal 3) | paired devices still get whole replies; on-screen order checked in `e2e:perf` |
| done | A redraw scenario, CPU per process, where the window's time goes, idle cost and the memory floor in `e2e:perf` | S | see §7.2 | none |
| done | Markdown by blocks (ADR 0068 amendment; Phase 1 step 4) | S | `chat.windowScript` 4.4% (was 9–10), `chat.windowLayout` 2.8% (was 11), `chat.cpuWindow` 42–45% (was 50–60) | final HTML identical; every prefix checked |
| 4 | GPU memory of terminals: find what holds it, release it for terminals off screen (Phase 5 step 3) | S–M | `memory.idle.gpu`, `memory.loaded.gpu` goals, set then | low |
| 5 | Phase 6: server anywhere | M | a headless Linux server passes the suites | low |
| not called for | Selectors, React Compiler, lazy screens (rest of Phase 1), Phase 2 (engine into `hiveoryd`), Phase 3 (direct stream), Phase 4 (SQLite), git by events (Phase 5 step 1) | | §7.2: no number points at them on this machine | |
| open | Phase 7 (Rust), now a memory question only: the terminal host holds 105 MB idle | L | §7.2 | product owner's call |

### 7.1 What flow control changed

Two terminals printing as fast as they can, same machine, before and after (six runs after):

| Number | Before | After | Goal |
|---|---|---|---|
| Main process late by, at most | 5–14 s | **15–50 ms** | 100 ms: met |
| Window's longest blocked stretch | 3–8 s | **0–125 ms** | 50 ms: met in 3 runs of 6 |
| Typed character echoes in (median) | over 3 s | **45–118 ms** | 50 ms: met in 3 runs of 6 |
| Frames a second | 0.4–6 | **26–56** | 50: met in 3 runs of 6 |
| Window memory after the flood | 870–1,050 MB | **458–529 MB** | 400 MB: not yet |
| Terminal host memory with eight agents | up to 730 MB | **161–217 MB** | none |

The freeze is gone. The window-side numbers varied twofold between runs with no code change
(machine power and heat), so `e2e:perf` holds them to "never frozen" (under one second) and their
goals, not to the baseline. What is left: during a flood the window draws terminals as fast as
the machine lets it (xterm.js gives each flooding terminal its own 12 ms slice per turn). One
drawing budget per frame shared by all terminals would hold the goals on a slow day; it touches
how every terminal is written, so it waits until the redraw scenario (step 3) shows whether real
agents get near this load.

### 7.2 The second round of measurements

Same machine, four runs. CPU is in percent of one core.

**Where the memory is.**

| | Empty window | Four idle terminals | Eight agents after the runs |
|---|---|---|---|
| Main process | 151 MB | 157–160 MB | 170–180 MB |
| Window | 122 MB | 159–162 MB | 450–580 MB |
| GPU process | 172 MB | 260–264 MB | 447–455 MB |
| Terminal host | not started | 105 MB | 160–220 MB |
| Everything | **509 MB** | **748–761 MB** | **1,440–1,450 MB** |

- **Two thirds of the idle footprint is there before any work**: Electron with an empty Hiveory
  window is 509 MB. No change inside the app goes below that; only leaving Electron would.
- A terminal costs about 34 MB (23 MB of it in the GPU process). The terminal host adds 105 MB
  once: it is the Electron runtime run as Node.
- Under load the window (scrollback of seven terminals, a long chat) and the GPU process grow
  most. These are the two to work on.

**Where the time goes.**

| Scenario | Main late by (max) | Frames a second | Typing echo | CPU: main / window / GPU | Window's thread: script / layout |
|---|---|---|---|---|---|
| Idle, four terminals | | | | 1 / 0 / 0 | 0 / 0 |
| Six terminals printing 250,000 chars/s | 11–14 ms | 98–143 | 14 ms | 11–17 / 38–54 / 27–35 | 15 / 0 |
| **Six agent screens redrawing** (three in place at 20 fps, three full screen at 30 fps) | 9–11 ms | 119–140 | 14–16 ms | 7–10 / 43–65 / 41–71 | 26–39 / 0 |
| 50,000-character chat reply | 8–9 ms | 133–139 | | 3–5 / **50–60** / 19–21 | 9–10 / **11** |

(Counting frames costs about 4 of the window's and 2 of the GPU's percent by itself.)

What follows:

- **Idle is free**: no timers or polling worth removing. Git by events and "less background
  work" would not show here.
- **Agents redrawing their screens are handled**: six at once leave the app smooth, and main
  spends 10% of a core. Moving the terminal engine out of main, or a direct stream to the
  window, has nothing to win on this machine.
- **The window's script time is small** (0 idle, 10% in chat, 26–39% only while six terminals
  redraw, which is xterm.js itself). Nothing here calls for selectors or React Compiler.
- **A streaming chat reply is the one cost in the window**: half a core or more, and 11% of
  its thread in layout, because the whole reply's HTML is replaced on each update. Rendering by
  blocks (Phase 1 step 4) addresses exactly that.
- **Start-up** is 1.5–1.7 s with or without 200 chats of history: nothing calls for SQLite.
- **Rust** would win back about 100 MB (the terminal host), 13% of the idle footprint, and
  nothing in speed.

Not measured: slower machines, macOS, Linux, SSH hosts, twenty agents, the Changes and Pull request
tabs open, real CLIs (the fixtures draw like them but are not them).

---

## 8. Decisions for the product owner

1. **Hidden window:** may Chromium throttle the window while it is hidden in the tray? Agents and
   chats keep running either way.
2. **Browser pages:** may hidden pages sleep after N minutes? If so, is it on by default and what
   is N?
3. **SQLite downgrade policy:** keep writing the JSON files for two releases after the move?
4. **Linux server packaging:** publish a systemd unit and a Docker image with each release?
5. **Browser client:** reach a server from any browser, without the app (later)?
6. **Rust:** agree that Rust comes only through Phase 7's gate?

---

## 9. Sources

- Electron: [performance checklist](https://github.com/electron/electron/blob/main/docs/tutorial/performance.md),
  [MessagePorts](https://github.com/electron/electron/blob/main/docs/tutorial/message-ports.md),
  [utilityProcess](https://github.com/electron/electron/blob/main/docs/api/utility-process.md),
  [command-line switches (`--ozone-platform=headless`)](https://github.com/electron/electron/blob/main/docs/api/command-line-switches.md),
  [headless CI](https://github.com/electron/electron/blob/main/docs/tutorial/testing-on-headless-ci.md),
  [V8 memory cage](https://www.electronjs.org/blog/v8-memory-cage)
- VS Code: [flow-control constants](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/terminal.ts),
  [flow control issue](https://github.com/microsoft/vscode/issues/114214),
  [pty host as utility process](https://github.com/microsoft/vscode/pull/182345),
  [utility process + MessagePort design](https://github.com/microsoft/vscode/issues/175335),
  [ptyService (serialize, revive)](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/ptyService.ts),
  [reconnection via serialize addon](https://github.com/microsoft/vscode/issues/131453),
  [persistent sessions](https://code.visualstudio.com/docs/terminal/advanced),
  [VS Code Server](https://code.visualstudio.com/blogs/2022/07/07/vscode-server)
- xterm.js: [flow control guide](https://xtermjs.org/docs/guides/flowcontrol/),
  [serialize addon in VS Code](https://github.com/xtermjs/xterm.js/issues/4470)
- Orca: [repository](https://github.com/stablyai/orca),
  [architecture wiki](https://grok-wiki.com/public/wiki/stablyai-orca-47ffb1f68457),
  [PTY ownership fix](https://github.com/stablyai/orca/pull/11789),
  [orphaned terminals fix](https://github.com/stablyai/orca/pull/15644),
  [control-plane write-up](https://wangruofeng007.com/blog/2026-08/orca-agent-control-plane/)
- Emdash: [AGENTS.md](https://github.com/generalaction/emdash/blob/main/AGENTS.md),
  [main process](https://deepwiki.com/generalaction/emdash/8-main-process-architecture),
  [faster task startup](https://github.com/generalaction/emdash/pull/674)
- Wave Terminal: [architecture](https://deepwiki.com/wavetermdev/waveterm/2-system-architecture),
  [backend services](https://deepwiki.com/wavetermdev/waveterm/2.2-backend-services-architecture),
  [connections](https://github.com/wavetermdev/waveterm/blob/main/aiprompts/conn-arch.md)
- vibe-kanban: [backend](https://deepwiki.com/BloopAI/vibe-kanban/4-backend-services),
  [system architecture](https://deepwiki.com/BloopAI/vibe-kanban/1.1-system-architecture)
- code-server: [server entry](https://github.com/coder/code-server/blob/main/src/node/main.ts)
- Node: [`node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- Zustand: [`useShallow`](https://github.com/pmndrs/zustand/blob/main/docs/reference/hooks/use-shallow.md)
- React Compiler: [v1.0](https://react-nwkzwa7ig-fbopensource.vercel.app/blog/2025/10/07/react-compiler-1),
  [with Vite 8](https://recca0120.github.io/en/2026/04/14/react-compiler-vite-v6/)
- Streaming markdown: [Streamdown memoization](https://streamdown.ai/docs/memoization),
  [AI SDK cookbook](https://ai-sdk.dev/cookbook/next/markdown-chatbot-with-memoization.md)
- Rust: [napi-rs threadsafe functions](https://napi.rs/docs/concepts/threadsafe-function),
  [napi-rs buffers in Electron](https://napi.rs/docs/concepts/typed-array),
  [ScyllaDB: napi-rs vs Neon](https://www.scylladb.com/2026/02/11/cassandra-scylladb-driver-for-node-js-with-rust/),
  [alacritty_terminal](https://docs.rs/crate/alacritty_terminal/^0.15.0)
