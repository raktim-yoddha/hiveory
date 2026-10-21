# ADR 0051 — Chat turns outlive Hiveory too

Builds on ADR 0050 (the durable terminal host) and ADR 0031 (queued chat messages).
Decided by the product owner, 2026-10-21.

## Context

ADR 0050 made agents and terminals outlive Hiveory, but only those that run in a terminal. Every
headless CLI run still went through `ChatService`, as a child process of Hiveory itself:

- Chat mode;
- Work agents in chat view;
- bot threads;
- the chat turns that Schedules and triggers start.

Quitting, updating or a crash killed a reply mid-stream, and on the next start it read
"Interrupted". The product owner asked for the same durability everywhere.

## Decision

- **A chat turn's CLI runs in the terminal host.** This covers every chat: Chat mode, chat-view
  agents, bot threads, and runs started by Schedules and triggers. Turns are a new kind of hosted
  process: a plain process, no terminal.
  - **Calls:** `proc.spawn` (keyed by the chat id), `proc.list`, `proc.attach` and `proc.kill`.
  - **Events:** `proc.data` and `proc.exit`.
  - All of them join the frozen core of ADR 0050 §8.
  - `ChatService` starts turns through `ChatProcessBackend` (`chat-process.ts`), in the terminal host
    when it serves Hiveory. When it doesn't, the turn runs in Hiveory's own process, as before.
- **The terminal host keeps a turn's whole output:** stdout up to 8 MiB and stderr up to 64 KiB,
  from its first byte, not only while detached.
  - A turn is let go of once its end has reached an attached app.
  - One that ended while no app was attached waits whole for the next one.
- **Quitting with agents kept** (Settings › Agents › Keep agents running when Hiveory quits) lets go
  of running turns rather than stopping them. Quitting with agents stopped stops them.
- **Start-up (`ChatService.recover`)** checks every reply still marked streaming:
  - its run is still going: it is taken back, the reply is rebuilt from the run's whole output, and
    it streams on;
  - its run ended while Hiveory was closed: the reply is finished from what the run printed;
  - its run is gone (after a reboot): it reads "Interrupted", as before.
- **Queued messages** (ADR 0031) go in after a recovered turn ends, as after any turn.
- **Agent tools** of a chat turn go through the relay (ADR 0050 §6). While Hiveory is closed they
  answer "Hiveory is not open…"; the turn itself carries on.
- **What does not change:**
  - **Schedules and triggers** fire from Hiveory itself, so they need Hiveory open, or running as a
    server (`--serve`). A scheduled run missed while it was closed still runs when it is back within
    12 hours, and older ones are logged as missed. What a run starts (agents in Work, chat turns)
    now outlives Hiveory.
  - **Skills** are files the CLIs read themselves. There is no process of Hiveory's to keep.
  - **Queen Bee's own model calls** (`cli-brain`) are a few seconds each and stay in Hiveory.

## Consequences

- A reply in progress survives quitting, updating and a crash of Hiveory. Its text is rebuilt
  exactly, because it is parsed again from the run's first byte.
- **Memory cost:** the terminal host holds up to 8 MiB per running turn. A reply longer than that
  is rebuilt from its last 8 MiB only.
- **Left for later:**
  - turns held by an older-protocol terminal host are left to end there; that host's terminals are
    drained, its turns are not;
  - running Schedules while Hiveory is closed, which is what server mode is for.
