# ADE landscape research (October 2026)

What comparable Agentic Development Environments offer, and which of those
ideas Hiveory can adopt **locally** (no backend or cloud service).

## BridgeMind — BridgeSpace
- Multi-agent workspaces (Claude, Codex, Gemini, Cursor side by side, up to 16 agents).
- Kanban + multi-pane terminals; an orchestrating "Bridge Agent" for the swarm.
- Built-in browser and IDE in the same window.
- Companion tools: BridgeVoice (voice-to-text into any app), BridgeMCP (shared memory and task routing for agents).

## Orca (Stably AI, open source)
- Parallel git-worktree per task; fan one prompt out to several agents, compare, merge the winner.
- WebGL terminals with splits and scrollback search.
- Embedded Chromium per worktree with a "Design Mode" for inspecting UI elements.
- Inline diff review with comments sent back to agents; commit tooling.
- GitHub/Linear PR and issue browsing; file/image drag-and-drop into prompts.
- A CLI that lets agents control the app; global search across worktrees, files, agents, commands.
- Usage tracking and account switching; markdown/PDF/image preview; MCP/skills/hooks extensibility.

## Emdash (General Action, open source)
- 20+ CLI agents, each task in its own worktree; worktree pooling (pre-created worktrees for instant start).
- Monaco diff review; PR creation and CI status; Linear/Jira/GitHub issues.
- Cross-agent skills synced across providers; auto-approve flags per provider.
- Preserves git-ignored files (`.env` …) when creating worktrees; SSH remote development.

## Plugins, MCP and skills management (both Work and Chat)
- **Agent Skills** is now a cross-tool standard: a folder with `SKILL.md`, loaded from
  `~/.agents/skills` / `.agents/skills` by Codex, Copilot, Cursor, Gemini, OpenCode, Amp, Goose,
  Letta and others; Claude reads `~/.claude/skills`. Hiveory's Skills & MCP page inventories these
  and can share a skill into `~/.agents/skills` for every agent.
- **MCP servers** stay in each CLI's own config (Claude `~/.claude.json`, Codex `config.toml`,
  OpenCode/Kilo JSON, Gemini `settings.json`, Cursor `mcp.json`). Hiveory lists them per server and
  per CLI, read-only, and injects its own `hiveory` server per launch without touching user config.
- **Plugins**: Claude (`--plugin-dir`, marketplace), Codex (`codex plugin`), OpenCode (`opencode plugin`)
  and Antigravity (`agy plugin`) each have their own plugin systems; a future Hiveory view could list
  them through each CLI's own commands.

## Local features worth adding next (ranked)
1. **Diff review per workspace** — changed files with inline diffs, stage/commit/discard, and
   "send comment to agent" (via `send_message`). Uses local git only.
2. **Fan-out & compare** — send one prompt to N agents in N new branch workspaces, then compare diffs
   side by side and merge the winner into the base branch.
3. **Worktree pooling** — keep a few pre-created worktrees warm so new isolated workspaces open instantly.
4. **Copy git-ignored config into new worktrees** (`.env`, local settings) with an allowlist per project.
5. **Built-in browser panel** with element inspection, plus browser tools for agents (open, read, screenshot).
6. **Global search / command palette** across projects, workspaces, agents, files and commands.
7. **Prompt attachments** — drag files/images into an agent pane or chat.
8. **Local notifications** when an agent needs you or finishes (OS notifications; no mobile backend).
9. **Usage view** from each CLI's own local stats (e.g. `opencode stats`, Codex/Claude session logs).
10. **Markdown / PDF / image preview** in the side panel.

## Sources
- [BridgeMind ADE (chatgate.ai)](https://chatgate.ai/post/ade) · [BridgeSpace 3 (hunted.space)](https://www.hunted.space/product/bridgespace-3) · [BridgeMind (everydev.ai)](https://www.everydev.ai/developers/bridgemind)
- [Orca](https://onorca.dev/) · [Orca (openalternative)](https://openalternative.co/orca)
- [Emdash docs](https://mintlify.wiki/generalaction/emdash/introduction) · [Emdash (morphllm)](https://www.morphllm.com/emdash-ai-coding-agent)
- [Agent Skills (Cursor docs)](https://cursor.com/docs/skills) · [Agent Skills standard (agentpatterns.ai)](https://www.agentpatterns.ai/standards/agent-skills-standard/)
