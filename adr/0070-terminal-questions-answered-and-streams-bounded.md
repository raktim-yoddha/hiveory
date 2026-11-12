# ADR 0070 — A terminal's questions are answered even when nobody shows it, and a slow device cannot swell the server

Builds on ADR 0022, 0027, 0048, 0050 and 0066. Decided by the product owner, 2026-11-12.

## Context

End-to-end tests of Hiveory as a server (`pnpm e2e:server`, new) found two faults that only show
when no window on the computer draws a terminal.

- **Unanswered questions.** Programs ask their terminal questions: where the cursor is (`ESC[6n`),
  what the terminal is (`ESC[c`). Only a screen that draws the terminal answered them. With none (a
  server with no client watching, a phone watching, which is read-only, or a desktop terminal freed
  after 90 s off screen), the program waited for each answer: after a phone stopped watching, a
  PowerShell prompt sent 20 such questions and typed back one character every few seconds. A
  Windows console asks too, at times VS Code documents.
- **An unbounded backlog per device.** The server wrote every event to every device's stream without
  looking whether the device read it. A phone too slow to read a flooding terminal made the server
  hold all of it: about 1 GB in eight seconds.

Orca met both: its model of each terminal answers queries ("model query authority"), and it caps
every queue toward a view, repainting from the saved screen after a drop.

## Decision

**Hiveory's own copy of the screen answers when nobody else can.** Main keeps a headless copy of
every terminal (ADR 0044). It now answers the program's questions while:

- no window on this computer shows the terminal: the window tells main when it keeps one
  (`terminal.view`, a window-only channel; a window keeps a terminal while shown and for 90 s
  after), and a closing window clears them all;
- and no paired desktop is connected (`hasDesktopClient`): its window answers for the terminals it
  shows, as before.

A phone never answered and still does not. Answering twice is as wrong as not answering, since the
second answer reaches the program as typed input, so exactly one side answers. Output shown again
is never answered: what a daemon kept while Hiveory was closed (marked `replay` by the host
client) and what is restored from last time (`annotate`) asked long ago, and late answers break
some programs (the window has the same rule for its own replay).

**A device that falls behind is disconnected, not buffered.** A stream more than 8 MB behind is
closed (`MAX_STREAM_BEHIND`). The device reconnects and reads the terminal's screen whole, as after
any dropped connection: the phone already does; a paired desktop's window now reads a terminal
again whenever output arrives after a gap (`resync`), instead of drawing it with a hole.

## Consequences

- Measured on this machine: after a phone stops watching, a PowerShell prompt answers at once (it
  did not within 10 s); a stalled phone during a flood leaves the server at about 220 MB (it grew
  to 1.1 GB), and the phone gets live output again after it reconnects.
- A terminal shown on a paired desktop and on this computer's window at once still gets two
  answers, as it did before; so does one with only a paired desktop connected that does not show
  it, which still gets none.
- `pnpm e2e:server` covers pairing and its refusals, what a phone may call, a terminal streamed to
  a phone in order and sized to it, a chat reply reaching devices whole (ADR 0068), a stalled
  phone during a flood, and the server stopping. It is not in CI yet.
