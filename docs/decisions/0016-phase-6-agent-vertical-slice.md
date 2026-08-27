# ADR 0016: Phase 6 Agent Vertical Slice

## Context

The application needs a named-Agent workspace that can run bounded model
turns, call local tools, ask for approval or user input, persist its state,
and recover after a host restart. The Agent surface must remain separate from
the existing Code orchestration service: an Agent may only access folders
that the user explicitly grants, and its durable history must be inspectable
from the desktop UI.

## Decision

Phase 6 introduces two Rust boundaries:

- `agent-domain` owns Agent invariants, state transitions, validation, skill
  frontmatter parsing, memory policy, and built-in skill sources.
- `agent-runtime` owns the model/tool turn loop, cancellation, lease-aware
  execution, approval and input pauses, continuation recovery, context
  compaction, child runs, and event publication.

The Agent store uses SQLite as the source of truth. Agent definitions are
versioned; runs, messages, function calls, approvals, continuations, events,
memories, retrievals, skills, folder grants, and artifact metadata are all
durable. Startup marks active runs as interrupted before the runtime resumes
new work. Background task failures are converted into a durable failed state
when the run still owns its lease.

The first-party tool surface is deliberately small:
`folder.list`, `folder.read_text`, `folder.write_text`, `memory.search`,
`memory.remember`, `artifact.create_text`, `user.request_input`, and
`delegate_task`. Folder access requires a matching grant and canonical-path
validation; symlinks and paths outside the granted root are rejected. The
default approval policy is `ask_for_mutations`, while explicit
`allow_within_scope` grants are required before filesystem writes can run
without another prompt. Agent memory is explicit-only by default and is
visible and deletable from the UI.

The OpenAI Responses provider sends strict function schemas, disables
parallel tool calls for deterministic approval ordering, keeps provider-side
storage disabled, and resumes a turn with the function-call and
function-call-output items after a tool completes. The provider remains behind
the existing model gateway so a future local or alternate provider does not
change Agent persistence or policy code.

Skills are loaded from built-ins and application-data directories containing
`SKILL.md` files. Frontmatter is bounded and validated before it enters the
Agent instruction context. Skill conflicts are surfaced as data and require
an explicit selection.

## Consequences

The desktop application now has a functional Agent vertical slice with a
dashboard, Agent detail workspace, live run transcript, approval cards, input
requests, run history, skills, memory, cancellation, and export controls.
The browser preview mirrors the same public shape without claiming to execute
local tools. All host mutations flow through typed Tauri commands and the
existing audit boundary.

This phase does not add arbitrary shell access, implicit Code roots, plugin
execution, remote workers, semantic/vector memory, automatic memory capture,
or multi-provider account selection. Those capabilities require separate
policy and threat-model decisions.

## Verification

The required gates are generated protocol bindings, Rust formatting,
workspace clippy with warnings denied, workspace tests, renderer typecheck,
renderer lint/build/tests, and identity/reference audits. Focused coverage
includes domain transition and skill validation, persistence across database
reopen, strict tool schemas, approval fingerprints, bounded folder access,
continuation state, and UI accessibility states.
