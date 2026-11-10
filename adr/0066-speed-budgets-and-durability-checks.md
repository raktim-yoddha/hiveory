# ADR 0066 — Speed is measured, and what survives a quit is checked

Builds on ADR 0044, 0050 and 0051. Decided by the product owner, 2026-11-10.

## Context

Hiveory had grown slow and sometimes hung, and nobody could say where: there were no numbers for
start-up, for several agents printing at once, for a long chat reply or for memory. The one speed
script timed clicks only. A plan to make the app fast (`docs/plans/speed-and-memory.md`) changes
the path every terminal and chat takes, and the product owner's condition was that no feature is
lost on the way, above all that agents and chats keep running when Hiveory is closed and are there
when it opens again (ADR 0050, 0051). No end-to-end check covered that.

## Decision

**Speed has numbers, a baseline and goals (`pnpm e2e:perf`).** The script runs the built app with
terminals in the terminal host, as users have them, and measures:

- start-up, with an empty profile and with 200 chats of history;
- the window's answer to clicks (sidebar, side panel, switching Worktrees, Settings);
- six terminals printing 250,000 characters a second each, and two printing as fast as they can:
  how late the main process runs, the window's longest blocked stretch and frame rate, and how
  long a typed character takes to echo in another terminal;
- a 50,000-character chat reply: the same, and how many times each character crosses to the window;
- memory per process, idle, right after the flood and with eight agents.

Each number has a **goal** where the plan sets one, and is compared with
`scripts/perf-baseline.json`: it passes at its goal, or when it is not half again worse than the
baseline (small numbers get a fixed allowance). `HIVEORY_PERF=record` writes a new baseline;
`HIVEORY_PERF=report` only prints. Numbers that swing too widely to compare today (the unbounded
flood, memory after it) are reported against their goals and compared once the plan fixes them.

**What survives a quit is checked (`pnpm e2e:durability`).** With agents kept, the suite quits and
reopens the app and requires: a terminal's process is the same one, still printing, with what it
printed before and during the quit on its screen, in the same terminal host; a chat reply that was
streaming carries on and ends whole, every line once and in order; a reply that ended while Hiveory
was closed is whole; and a quit that stops agents ends the terminal host. Hooks kept and replayed
while closed stay covered by `local-daemon.test.ts`.

**Test stand-ins (`scripts/e2e-fixtures/`).** A plain-text chat CLI found as `copilot` on the test's
PATH, a paced or unbounded terminal printer, and a counter that names its own process. They hold no
person's data (rule 27) and never ship.

**CI.** A `guards` job builds the app and runs both suites on Windows, macOS and Linux (Linux under
a virtual display). Speed is report-only there, since runners differ too much to compare; the
numbers are kept with the run. The job does not block a merge until it has run green on all three.

**The plan's order follows the numbers.** A phase of the speed plan starts from what this script
shows, and ends when its goals are met with both suites passing.

## Consequences

- A baseline belongs to the machine that recorded it; on another system the comparison is skipped
  and says so. Recording a new baseline is a deliberate step, reviewed like code.
- The first run already paid for itself: it found replies and terminals losing output printed
  right as they start or are taken back (fixed in the same change set), and showed that the hangs
  come from unbounded output with no flow control, not from ordinary agent output.
- The suites add about four minutes per system to CI.
- Not covered yet: remote (SSH) hosts, the phone, and a server with clients. Their guards are
  added before the phases that touch them.
