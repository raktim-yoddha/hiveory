# ADR 0016 — Speed, Device Mode, Computer Use and Fast Orchestration

Builds on ADR 0015 (built-in agent browser).

## Principle: the model's turn is the cost
A browser click takes about 0.1 s; an LLM turn takes 2–5 s. Research on agent
tooling agrees (tool batching cuts latency and cost; accessibility trees beat
screenshots by about 5× in tokens). So "fastest" means, in this order:
1. **Fewer turns:** batches, composite tools, and the next view returned with
   every action.
2. **Fewer tokens per turn:** diffs instead of full pages, compact text instead
   of images.
3. **Fast tools:** in-process, warm, event-driven, no fixed sleeps.

## Browser
- **Agent strip is live.** "Milo is using this page" shows only while a tool
  call is running and for 2.5 s after (`BrowserPageView.agentActive`). The page
  stays the user's to use otherwise.
- **Device mode** replaces the viewport menu with a Chrome-style device toolbar
  above the page:
  - a device list of 22 built-in devices (iPhones, Pixel, Galaxy, iPads,
    Surface, Nest Hub, laptops up to 4K), each with its pixel ratio and mobile
    flags, plus custom sizes from Settings;
  - editable width × height, a pixel-ratio choice, rotate, and the zoom it is
    shown at;
  - drag handles on the emulated screen's edges and corner (Responsive).
  Agents reach the same through `browser_viewport` (preset, width/height,
  scale, mobile, rotate), and the toolbar opens when an agent sets a device.
  The panel sizes the page box to the emulated screen; main derives the zoom
  from the box width.
- **Speed:**
  - Actions return a *diff* snapshot (only the changed lines, refs stay valid)
    when it is shorter than the page.
  - Unnamed single-child wrappers are dropped from snapshots.
  - The cursor glide runs alongside the input instead of before it.
  - Settle waits are a 40 ms DOM-quiet window with a hard cap.
  - **Hidden pages:** Chromium aligns mouse moves and wheel events to frames,
    and a page off screen gets no frames, so these events stalled about 1 s.
    Clicks now send the move without waiting, and the press flushes it. Hover,
    drag and scroll force one frame with a stay-hidden capture. A hidden
    window doesn't help either.
  - Measured on a hidden page: click ~0.1 s, hover ~0.13 s, an HTML5 drag
    0.34 s, a three-step batch 0.27 s, a snapshot 3–5 ms.
- **`browser_crawl`** reads a whole site in one call: up to 60 same-origin
  pages, 1–8 in parallel, in hidden lean pages. Images, media and fonts are
  blocked by a request filter that exists only while a crawl runs. Refs are
  stripped from the output. Eight pages of a real site took about 6 s.

## Computer use (Windows)
- **Off by default** (Settings › Agents › Computer use); agents then get
  `computer_*` tools. Hiveory shows a notice when an agent starts using it
  (at most once a minute per agent).
- **One warm native helper.** A C# class compiled once to a DLL and run by
  Windows PowerShell answers JSON lines:
  - `SendInput` for mouse and keyboard (Unicode typing in one call);
  - GDI for screenshots (downscaled JPEG);
  - UI Automation with a cached `FindAll` for element trees;
  - `EnumWindows` and `SetForegroundWindow` to list and focus windows.
  It is per-monitor DPI-aware. Measured: snapshot 19 ms, click 12 ms,
  screenshot 69 ms.
- **Tools:**
  - `computer_snapshot` returns the focused window as text with refs `[@c12]`.
  - `computer_click`, `computer_move` and `computer_drag` take a ref or
    screenshot `[x, y]`, mapped back to the screen.
  - `computer_type` sets the value directly when given a ref; otherwise it
    types into the focused field.
  - Also `computer_key` (chords, Win+R), `computer_scroll`,
    `computer_windows`, `computer_screenshot` and `computer_batch`.
  Actions return the window's elements afterwards.
- macOS and Linux say "available on Windows for now".

## Orchestration and tool calling
- `ask_agent` sends a message, waits for the turn to end, and returns the reply
  (screen or chat message) in one call instead of three.
- `run_tools` takes up to 25 Hiveory tool calls in one round trip, in parallel
  by default or in sequence, stopping at the first error. It can't be nested.
- `wait_for_agent` polls every 150 ms and returns as soon as a turn it saw
  start has ended. `run_in_terminal` settles after 0.5 s of quiet output
  instead of 0.9 s.
- Agent prompts mention `run_tools` and `ask_agent`, and the computer-use
  prompt when that is on. Chat-mode chats get browser and computer tools; Work
  agents get everything.

## Consequences
- Diff snapshots assume the agent saw the previous snapshot of that page.
  `browser_snapshot` always returns the full page.
- A computer-use snapshot of a huge window can take longer than 19 ms (UI
  Automation crosses processes); it is capped at 250 elements.
