# ADR 0019: Queen Bee, the app operator

## Status
Accepted. All five phases are built (see "Phases").

## Context
Users want to drive Hiveory by typing or speaking ("open two Codex in feature-x",
"what's left?") and get an instant answer, the way CNVS does with voice. The assistant is
not a coding agent. It only operates Hiveory: agents, panes, pages, presets, the side panel
and settings. It also reports on what every agent is doing.

That narrow scope is what makes "no wrong actions" and real speed possible, whatever model
sits behind it.

## Decision

### One pipeline, model last
```text
utterance ─▶ tier 0: rule parser (no model, < 20 ms)
          └▶ tier 1: brain, only if tier 0 can't classify
                  · API key (any OpenAI-compatible endpoint, Anthropic, Gemini AI Studio, local)
                  · user's own codex app-server (ChatGPT plan)
                  · user's own claude session (optional; policy risk)
          ──▶ executor ──▶ app actions ──▶ receipt (+ Undo)
```

**Actions are typed.**
- Both tiers emit `QueenAction[]`, a closed union in `src/shared/queen/actions.ts`. The model
  never runs anything itself.
- The executor resolves names (agents, CLIs, projects, workspaces, presets) against live
  state. If a name is ambiguous it asks instead of guessing. Destructive actions confirm.

**Reports are computed.**
- Statuses, counts and wait times come from app state (`src/shared/queen/report.ts`).
- A report covers the current project. From Home it covers every project, as one
  list in which each row names its workspace. This is not a board: the Kanban stays
  project-scoped (AGENTS.md rule 8).
- A model may only phrase them, or summarise an agent's own output. Such summaries are
  labelled and link to the agent.

**Receipts are templates.**
- Each personality has a fixed phrase set, so a confirmation never waits on a model.
- Personality changes wording only, never what an action does. Persona text cannot grant
  permissions.

**Model limits.**
- Reasoning runs at its minimum, there is a short time budget, and the tool call is forced.
- Strict schemas are used where the provider supports them; output is validated again with
  zod.
- A slow or over-thinking model can delay a reply but cannot cause a wrong action.

**Never.** Hiveory never reuses subscription OAuth tokens: Anthropic and Google ban it (see
the research notes in the Round C discussion). Gemini is supported through an AI Studio key
only.

### Look
**Two placements.**
- Docked: a bar at the bottom of the main area in Work and Chat, with the panes lifted
  above it.
- Floating: a pill you can drag anywhere. It collapses to the hive mark when idle and
  remembers its position.
- It never floats over the native browser page; it slides to the nearest free edge.

**Controls.**
- Input, mic (hold to talk), dock/float toggle, and ⋯ (personality, mute voice, Configure,
  which opens Settings › Queen Bee).
- One reply card above the bar: the answer, action receipts and Undo. There is no
  scrolling history. Esc dismisses. Her shortcut (default Win+Alt, ⌘⌥ on macOS) taps
  to focus her and holds to talk.

### Voice (phase 3)
**Push-to-talk.**
- Default Win+Alt, changeable.
- In-app always works. The system-wide hotkey is opt-in, because it needs a native
  keyboard hook. The hook watches only the chosen keys and never logs input.

**Speech-to-text.** Local only, and downloaded only when the user asks:
- Parakeet TDT 0.6B v3 for English, Spanish, Portuguese, German and French (it covers
  25 European languages).
- Whisper large-v3-turbo for Hindi and Hinglish.
- These languages were chosen by vibe-coding user base: India, Brazil, Europe and Latin
  America lead adoption. Japanese and Chinese are not included, because no data showed a
  comparable user base.

**Text-to-speech.**
- Kokoro-82M (Apache 2.0): English, Spanish, Portuguese, French and Hindi voices.
- Users pick any of Kokoro's English voices. Loading arbitrary voice model files is not
  offered: an unverified model is untrusted native input to the inference runtime.

**Downloads.**
- Pinned URLs, SHA-256 verification, resumable, deletable.
- A three-step guide in Settings.

### Personalities
Each core is fixed; the fields on top are the user's.

| Name | Core |
|---|---|
| **Ada** | Strict, formal, precise. |
| **Sunny** | Fun and energetic. |
| **Frankie** | Frank facts, never sugar-coats or flatters, then a push forward. A reality check, never rude. |
| **Custom** | Name, persona text (≤ 500 chars), and sliders: formal↔casual, calm↔energetic, gentle↔direct. |

**Shared fields.**
- What she calls you, and how to pronounce it.
- Reply language and reply length.
- When she speaks aloud: only after you spoke, always, or never.
- Voice and speed.
- Things she's learned: added only with a visible "Noted: …", editable, local-only.

**Persona extras.**
- Ada: honorific (Sir, Ma'am, your name, or none).
- Sunny: hype level.
- Frankie: goals and deadlines, a nudge after an agent has waited N minutes, and intensity.

The persona names are reserved: the pet-name pool never uses them, so "tell Ada…" is
never ambiguous.

## Phases
1. **Operator core.** Dock/float UI, the tier-0 parser (English), the executor, computed
   reports, persona receipts and the Settings section. No new dependencies.
2. **Brain.** API-key providers (OpenAI-compatible, Anthropic, Gemini) with keys sealed by
   SecretBox, plus a CI evaluation set of real utterances.
3. **Voice.** sherpa-onnx speech-to-text and text-to-speech, model downloads and push-to-talk.
4. **System-wide hotkey** (opt-in), learned memory, and the custom persona.
5. **Subscription brains**: codex app-server, and optionally a claude session.

All five phases are built.

## Phase 2 notes (as built)
**Main process.**
- `QueenBrain` speaks three wire formats: OpenAI-compatible (OpenAI, OpenRouter, Groq,
  Cerebras, xAI, Ollama, LM Studio, custom), Anthropic and Gemini AI Studio.
- Every request forces one `plan` tool call with a flat schema that every provider accepts.
- Reasoning is set as low as the provider allows: `reasoning_effort` minimal/low, or a
  thinking budget of 0. A model that rejects that setting is asked once more without it,
  and remembered.
- The time budget is 8 s.
- The key is sealed by SecretBox and write-only over IPC. Gemini's key goes in a header,
  never the URL. Error bodies are scrubbed of the key.
- Addresses must be https; plain http is allowed only for localhost.

**Validation** (`planFromToolArgs`).
- Strict and all-or-nothing: every id must be one the model was shown, or nothing runs.
- Anything a model plans that closes or messages an agent needs a yes.

**Messages.**
- `message-agent` reuses the agent-tools delivery path (`deliverMessage`).
- From the rules ("tell Bruno to …") the user's exact words are sent without a
  confirmation. A model's wording always needs a yes.

**What the model sees.** Project, workspace, agent and CLI names and ids, agent statuses
and the request. Never files, code or terminal output.

## Phase 3 notes (as built)
**Shortcut.**
- One setting: two or three keys, at least one a modifier. Default `Meta+Alt`, which is
  Win+Alt on Windows and ⌘⌥ on macOS.
- Stored as modifiers plus a layout-independent `KeyboardEvent.code`. Tap focuses Queen
  Bee; hold (350 ms) is push-to-talk.
- Listened for in the capture phase, so terminals never swallow it. Combinations with a
  regular key never reach them.
- The recorder refuses keys terminals and the OS rely on: Ctrl+letter, Ctrl+Alt (AltGr),
  Alt+Shift and Ctrl+Shift (layout switch), and reserved macOS/Windows combinations.
- Works while Hiveory is focused; system-wide is phase 4.

**Settings › Queen Bee** has tabs: Personality, Providers, Voice, Bar & shortcut.

**Providers.**
- An ordered list of accounts, several per provider allowed, each with a name.
- The first enabled account plans; on any failure the next takes over.
- Models come from the provider's own list endpoint (OpenAI-compatible `/models`,
  Anthropic `/models`, Gemini `models` filtered to `generateContent`). Typing a name is
  always allowed.
- Custom providers choose their API format: OpenAI-, Anthropic- or Gemini-compatible.

**Voice.**
- sherpa-onnx (N-API, prebuilt for Windows, macOS and Linux) runs Parakeet TDT 0.6B v3,
  Whisper large-v3-turbo and Kokoro-82M on the CPU, off the main thread. Models load on
  first use and unload after 10 minutes idle.
- Packs download only on request, from files pinned to a Hugging Face commit. Each file
  is checked against its SHA-256. Downloads resume with Range requests and are verified
  over the whole file; a mismatch is deleted.
- espeak-ng data comes as an archive, unpacked by the OS's own bsdtar.
- Clips are 16 kHz mono and at most 60 s. Audio never leaves the computer.

**Hindi and Hinglish.**
- Whisper Turbo can't translate reliably, and Devanagari output would bypass the rules.
  So Whisper writes in Latin script, and the rule parser knows common Hinglish: kholo,
  band karo, dikhao, numbers like ek/do/teen, "aur", and verb-last word order.
- Anything else goes to the model.
- Accuracy on real Hindi speech is not yet measured; synthetic Hindi from Kokoro was too
  poor to judge.

**Microphone.**
- The main window may use only audio, only from its own page.
- macOS asks once through `askForMediaAccess`. The app carries
  `NSMicrophoneUsageDescription` and hardened-runtime entitlements (JIT, native
  libraries, audio input).

## Security pass (same round)
- **Plugin servers' environment.** Local MCP servers start with the MCP SDK's minimal
  environment plus locale, proxy and CA settings, and their own values. Never Hiveory's
  whole environment, which may hold other keys.
- **Secret masking.** A connection's secret values are masked in its tool results and
  error text before agents or the UI see them.
- **Plugin accounts.** A plugin can have several accounts ("GitHub · Work"). Each has its
  own sealed keys and its own tool prefix.

## macOS pass (same round)
- **PATH.** Finder-launched apps get a minimal PATH. Hiveory adopts the login shell's
  PATH at startup, plus common bin folders, so CLIs and npx/uvx plugins are found.
- **Terminals.** The pane "+" offers zsh, bash and fish (and PowerShell when installed) on
  macOS and Linux.
- **Builds.** The DMG is built for the build machine's architecture, because native
  modules install for the host only.

## Phase 4 notes (as built)
**System-wide shortcut** (opt-in: Settings › Queen Bee › Bar & shortcut › "Also in other apps").
- `GlobalHotkey` runs uiohook-napi (a prebuilt N-API hook for Windows, macOS and Linux X11)
  only while the setting is on. It stops when the setting is turned off or Hiveory quits.
- Privacy: keycodes map to the shortcut's modifiers and key only. Every other key is an
  anonymous "something else" that just cancels a tap. Nothing is stored, logged or sent;
  only `tap`, `hold-start` and `hold-end` reach the renderer.
- While a Hiveory window is focused it stays silent: the in-app listener handles the keys.
- A tap brings Hiveory forward and focuses her. A hold starts push-to-talk without stealing
  focus, and the reply is spoken ("when I spoke to her").
- The hook cannot swallow keys, so other apps see the combination too. Win+Alt and ⌘⌥ do
  nothing on their own on Windows and macOS.
- A key-up can be lost (lock screen, secure desktop): a new key after 5 s of silence resets
  the tracker. The event's modifier flags are not used, because uiohook reports Ctrl as up
  while it is held.
- macOS needs Accessibility access: the setting offers "Allow in System Settings", which
  opens the system prompt. Wayland is reported as unsupported.

**Things she's learned.**
- Rules: "remember (that) …", "note (down) …", "keep in mind …" and "yaad rakho …" save the
  user's exact words. "remember to …" is a reminder, not a fact, and is not saved. "forget …"
  removes every note containing the words; "what do you know about me?" reads them back.
- A model may also plan `remember`. Every note shows as "Noted: …" with Undo.
- At most 50 notes of 200 characters, stored in settings on this computer and editable in
  Settings › Personality. They reach a model only in the per-request message, under NOTES,
  which the system prompt calls facts that never change its rules.

**Custom personality.**
- Her name: 1–20 letters, never a pet name, a built-in persona or "Queen". So "tell <name>"
  stays unambiguous, and "<name>, open Codex" parses like "queen, open Codex".
- Instant replies stay templates: the slider pushed furthest picks the phrasing (formal →
  Ada, energetic → Sunny, direct → Frankie; all soft → a calm Sunny). Energy sets the hype.
- The style text (≤ 500 characters) goes only into a model's system prompt, labelled as tone
  that never changes the rules or the allowed actions.

**Shared fields completed.**
- "Say it as": how her voice pronounces your name.
- Her voice: any of Kokoro's 28 English voices, or the personality's own.
- Frankie: a goal with its deadline, repeated in reports, and intensity (steady or hard).
- Replies stay English: receipts are fixed templates and only English phrase sets exist.
  Speech recognition still understands all six listening languages.

## Phase 5 notes (as built)
**Subscription brains** are two more presets in the same ordered account list: "Codex CLI
(ChatGPT plan)" and "Claude Code CLI (Claude plan)". They need no key.
- The official CLI, found by the CLI registry, makes the request with the user's own login.
  Hiveory never reads, copies or forwards their tokens; the "Never" rule above holds.
- Each request runs the CLI once, headless, in an empty temporary folder that is deleted
  afterwards. It is spawned without a shell, with the agent environment, and killed with its
  children past a 30 s budget. CLIs start a whole runtime, so answers take 5–20 s.
- **Codex:** `codex exec --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check
  --sandbox read-only`, with the shell tool, apps, plugins, hooks and web search disabled and
  reasoning effort `low`. A model that rejects that effort is asked again without it, and this
  is remembered. The plan comes back through `--output-schema` with a strict version of the
  plan schema (every key required, optional values nullable), read from
  `--output-last-message`.
- **Claude Code:** `claude -p --output-format json --json-schema … --tools "" --strict-mcp-config
  --setting-sources "" --no-session-persistence --disable-slash-commands --system-prompt …`,
  default model `haiku`. The plan is read from `structured_output`. The CLI's own error (for
  example an expired login) is shown as is.
- Model names become a CLI argument, so only plain names are accepted. Model lists come from
  each CLI's chat catalog.
- The answer is validated by `planFromToolArgs` exactly like an API model's.
- The Claude preset's dialog says that Anthropic's terms limit using a subscription through
  other apps, and suggests an API key when unsure.

## Consequences
- Most commands work with no key and no network.
- A report can only be wrong where it summarises agent output, and that is labelled.
- One more always-visible surface. It stays one bar and four controls.
