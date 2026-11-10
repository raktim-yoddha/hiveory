# ADR 0068 — A streaming chat reply is sent to the window as the text that was added

Builds on ADR 0027, 0051 and 0066. Decided by the product owner, 2026-11-10.

## Context

While a chat reply streams, Hiveory told the window about it twenty times a second by sending the
whole reply again each time. The speed measurements (ADR 0066) put a number on that: for a
50,000-character reply, each character crossed to the window about 128 times, and the cost grows
with the square of the reply's length. The window also replaced the whole message on each update.

## Decision

**The window is sent what was added.** On each update of a streaming reply, the chat service
compares it with what it last sent (`chatSent`, `chatAppends` in `src/shared/domain/chat-delta.ts`):

- **Only text was added** to existing text or thinking parts: the window gets a new event,
  `chat.delta`, with the added text per part. Nothing changed: nothing is sent.
- **Anything else changed** (a new part, a tool call or its output, tasks, usage, an error, the end
  of the reply, the title, queued messages), or it is the first update: everyone gets the whole
  reply as `chat.event`, as before. So does a reply taken back after a restart (ADR 0051), which is
  rebuilt and sent whole first.

**Each addition says where it starts.** An append carries `at`, the position of its first character
in its part, as terminal output carries its offset. The window (`applyChatAppends`) adds only what
it does not hold yet, so an addition that arrives after the window reloaded the chat never
duplicates text; one that starts past what the window holds makes it load the whole chat again.

**Paired devices are told as before.** A phone or a desktop paired to this computer keeps getting
the whole reply as `chat.event` on every update: the phone app needs no release, and
`MOBILE_CHANNELS` and `REMOTE_CHANNELS` are unchanged. To send one update to the window as a delta
and to paired devices whole, `Emit` takes an optional audience, `'window'` or `'clients'`. The
whole reply for clients is not copied when no client is connected.

## Consequences

- Measured on the same machine: each character of a 50,000-character reply now crosses to the
  window once (was about 128 times). The reply was not stuttering before, so nothing visible
  changes at this length; the saving grows with the length of the reply.
- Paired devices still receive the whole reply on every update. They can take deltas later by
  using the same two functions, which are dependency-free for that reason.
- Tool output is still sent whole whenever it changes.
- The window still renders a reply's markdown as a whole on each update; rendering it block by
  block is left until the numbers call for it.
- `e2e:perf` holds the ratio to 3 or less, and checks on screen that a streaming reply shows every
  line once and in order.
