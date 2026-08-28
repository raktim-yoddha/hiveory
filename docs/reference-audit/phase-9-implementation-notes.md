# Phase 9 implementation notes

Phase 9 uses external references for behavior and visual direction. It does
not bundle the reference applications or copy their dependency trees.

## BridgeMind reference

- Product and interaction reference: [BridgeMind One](https://www.bridgemind.ai/)
- Used for: the centered Agent/Code/Chat switcher, persistent global
  navigation, mode-specific rails, dark graphite surfaces, compact pane
  chrome, engine status, and bottom composer hierarchy.
- BridgeMind branding and assets are not bundled.

## Local reference checkouts

| Checkout | Relevant patterns consulted | Implementation boundary |
| --- | --- | --- |
| `techn/orca` | pane/workspace composition and local desktop interaction patterns | Rust-owned Code workspace and pane contracts |
| `techn/t3code` | conversation/session lifecycle and streaming-oriented UI patterns | durable Chat store plus provider-neutral stream events |
| `techn/hermes-agent` | agent sessions, approvals, summaries, and scheduled execution concepts | existing Agent, Routines, Jobs, and approval services |

All three checkouts are MIT-licensed according to the existing license
inventory. This phase adapts concepts and protocol behavior; it does not copy
their source files or redistribute their runtime dependencies. The desktop
host launches only user-installed `codex`, `claude`, `agy`, or `opencode`
executables after adapter detection.

## Phase 9 engine contract

The application uses the existing `provider_account_id` field as the stable
engine identifier so no destructive migration is required:

- `agentic-super-app-openai` — OpenAI Responses API provider
- `codex-cli` — Codex CLI
- `claude-code` — Claude Code
- `antigravity` — Antigravity CLI (`agy` executable)
- `opencode` — OpenCode CLI

Code terminals are scoped to a trusted workspace. Chat CLIs run in a fresh
temporary directory with tools disabled/read-only flags where supported, and
their JSONL output is normalized into the existing durable Chat event stream.
