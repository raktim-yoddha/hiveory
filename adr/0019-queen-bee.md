# ADR 0019: Queen Bee, the app operator

## Status
Accepted. It ships in phases (see "Phases").

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
  scrolling history. Esc dismisses; Ctrl+Shift+K focuses the input from anywhere,
  terminals included. Plain Ctrl+K stays readline's kill-line.

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
- Users may load their own voice model in a supported format; Hiveory ships none.

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

## Consequences
- Most commands work with no key and no network.
- A report can only be wrong where it summarises agent output, and that is labelled.
- One more always-visible surface. It stays one bar and four controls.
