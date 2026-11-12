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

## Amendment (2026-11-12): a streaming reply is drawn block by block

The second round of measurements (`docs/plans/speed-and-memory.md` §7.2) found one cost left in
the window: while a reply streamed, its whole markdown was parsed, sanitized and put back into the
page on every update, about 10% of the window's thread in script and 11% in layout.

- **While a reply streams**, its text is cut into top-level blocks (paragraphs, lists, code,
  tables…) with marked's own lexer (`markdownBlocks` in
  `src/renderer/src/components/ui/markdown-blocks.ts`). Each block is turned into HTML and
  sanitized once, and keeps its place in the page; only the block still being written is redrawn.
  A block is made again only when its source text changes, or when the reply's link definitions
  change (a reference link resolves as the whole text says).
- **Joined, the blocks' HTML is exactly the whole reply's**, at every point of the stream: a test
  checks this for every prefix of a reply holding each kind of block. Only sanitizing differs: it
  runs per block, so raw HTML that opens in one block and closes in another is shown differently
  until the reply ends.
- **When the reply ends** it is drawn whole, exactly as before.

Measured on the same machine, the 50,000-character reply: the window's thread spends 4.4% in
script (was 9–10%) and 2.7–2.8% in layout (was 11%); the window process uses 42–45% of a core
(was 50–60%). A reply looks the same while it streams and once it ends (compared on screen).
