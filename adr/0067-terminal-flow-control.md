# ADR 0067 — A program that prints faster than the window draws waits for it

Builds on ADR 0022, 0048, 0050 and 0066. Decided by the product owner, 2026-11-10.

## Context

The speed measurements (ADR 0066) showed where Hiveory hangs: not with ordinary agent output, but
whenever a program prints without pause (a build log, a test run, a large file). Nothing between
the terminal and the screen could say "wait", so the output queued up in every process on the way.
With two terminals flooding, the main process ran 5 to 14 seconds late, the window was blocked for
3 to 8 seconds, a typed character took over 3 seconds to echo, and the window grew to about 1 GB.

VS Code solves this with flow control: its window acknowledges what it has drawn, and the terminal's
process is paused while the window is far behind (`FlowControlConstants`: pause above 100,000
unacknowledged characters, resume below 5,000, acknowledge every 5,000). xterm.js's own guide
describes the same watermark scheme.

## Decision

**The window says how far it has drawn; a program far ahead of it waits.**

- **The window acknowledges.** For each terminal, the window tells the main process how many
  characters it has taken in, in steps of 5,000 (`terminal.ack`, a new channel). Output for a
  terminal that has no screen in the window (freed after 90 seconds off screen, or never shown)
  counts as drawn at once.
- **The main process counts** (`PtySession`). From a terminal's first acknowledgement on, it counts
  the characters sent to the window and not yet acknowledged. Above 100,000 it pauses the program;
  below 5,000 it lets it carry on. The numbers are VS Code's.
- **The terminal host pauses** (`pty.pause`, `pty.resume`: two new notifications). It stops reading
  the terminal, so the program blocks on its own output, as it does in any terminal that is slow to
  draw. An in-process terminal is paused the same way. A terminal host from before these
  notifications ignores them, so the frozen core of ADR 0050 §8 and `HOST_PROTOCOL` are unchanged:
  its terminals behave as before until they end.

**A program never waits for a window that is not there.** This is the rule that keeps agents
working unattended:

- Nothing is counted until a window acknowledges. A server (`--serve`), a closed window, or a
  phone as the only viewer never pauses anything.
- The window closing lets every waiting program carry on at once.
- A window that stays silent for 2 seconds while a program waits is taken as gone or stuck: the
  program carries on, and waits again only once the window answers.
- Quitting with agents kept, a dropped link, or a new client taking over: the terminal host lets
  every paused terminal carry on, since nobody is left to say so.
- A hidden window (in the tray) still draws and acknowledges, so its terminals stay current.

**Paired devices are never waited for.** `terminal.ack` is not a remote or phone channel: a phone or
a desktop paired to a Hiveory server gets output at the pace the server's own window sets, or
unpaced when it has none. A paired desktop's window finds the channel refused and stops sending.

**The output buffer no longer copies itself.** `OutputBuffer` keeps the chunks as they arrive and
lets whole chunks go from the front, instead of rebuilding a 512 KB string on every chunk; its
snapshots and offsets are identical.

## Consequences

- Measured on the same machine, two flooding terminals, before and after (six runs after): main
  process late by at most 15 to 50 ms (was 5 to 14 s); window blocked for at most 0 to 125 ms (was
  3 to 8 s); a typed character echoes in 45 to 118 ms (was over 3 s); window memory after the flood
  about 460 to 530 MB (was about 1 GB), terminal host about 160 to 220 MB (was up to 730 MB). Six
  terminals printing 250,000 characters a second each are unchanged: they never reach the limit.
- A flood now shows at the speed the window can draw (6 to 12 million characters a second here),
  not the speed the program can print. `cat` of a huge file takes as long as drawing it takes.
- During a flood the window draws terminals as fast as the machine lets it, which varied twofold
  between runs: about 55 frames a second and a 45 ms echo in three, about 27 and 90 to 118 ms in three, around
  the 50 fps and 50 ms goals. Sharing one drawing budget per frame across terminals would hold the
  goals on a slow day; it is left until the numbers call for it. `e2e:perf` therefore holds these
  window numbers to "never frozen" (under one second), not to the baseline.
- A program is paused only through the terminal's own back pressure. One that ignores a blocked
  write (none known) would not slow down.
- With an older terminal host still running after an update, its terminals have no flow control
  until they end.

## Amendment (2026-11-12): the terminal host also pauses a terminal when its client is not reading

Decided by the product owner, 2026-11-12.

- **What was wrong.** Flow control counts what the window has not drawn. On macOS the main process
  itself could not read a flooding terminal's output as fast as the terminal host sent it: the
  backlog grew inside the host (about 540 MB) on the one connection to main, so the echo of a
  keystroke in another terminal waited behind it for over 3 seconds, while main and the window
  stayed idle enough never to ask for a pause. Diagnostics in `e2e:perf` (what the programs printed,
  what reached main, when an echo reaches main) showed it on CI's macOS runner only.
- **Decision.** The host pauses a terminal it is sending from while more than 1 MB waits on the
  line to its client (`LINE_HIGH`), and lets it read again once the line drains. A terminal held
  by its client (flow control) and by the line reads again only when neither holds it; a client
  that goes away releases both. The line reader in main no longer copies its buffer once per
  message, which was costly when terminals print fast in small pieces.
- **Consequences.** A connection that never backs up (the utility process) never pauses anything.
  The same applies to remote hosts, whose line to Hiveory is SSH.
