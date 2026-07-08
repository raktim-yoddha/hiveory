# Hiveory AI v1

An AI-native dev environment with unified project memory. Hiveory AI v1 focuses on three core modules:

- **Hive**: Tauri desktop shell with terminal panes and file editor
- **Nectar**: Unified project memory with hybrid vector + keyword search
- **WorkerBees**: CLI agent adapters (Claude Code, Codex, Aider, Gemini)

## Tech Stack

- **Shell**: Tauri v2 (Rust + Next.js)
- **Frontend**: Next.js App Router, shadcn/ui, TailwindCSS
- **terminal**: xterm.js + portable-pty (Rust)
- **Editor**: Monaco
- **Storage**: SQLite with FTS5
- **Search**: Hybrid vector + keyword with reciprocal rank fusion
- **Monorepo**: pnpm workspaces + Turborepo

## Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run Hive in development
cd Hive
pnpm dev

# Run Tauri dev mode
pnpm tauri:dev
```

## Project Structure

```
hiveory/
├── Hive/              # Tauri app (Next.js + Rust)
├── Nectar/            # Memory & search (standalone)
├── WorkerBees/        # CLI agent adapters (standalone)
└── .nectar/           # Created per-project at runtime
```

## v1 Definition of Done

1. Open a project folder in Hive
2. Launch Claude Code in a terminal pane with automatic Nectar context injection
3. Switch to Aider and inherit context from the Claude Code session
4. Inspect `.nectar/memory/*.md` - readable, git-diffable markdown
5. Delete `nectar.db` and `.nectar/index/`, re-index, and get the same behavior back

## Key Features

### Nectar Memory System

- `.nectar/memory/` stores project knowledge as markdown
- Hybrid search: vector similarity + FTS5 keyword match
- Reciprocal rank fusion for ranked results
- Chunk-level indexing (never injects full files)
- Token-budgeted injection with relevance threshold

### WorkerBees Adapters

- Unified interface for Claude Code, Codex CLI, Aider, Gemini
- Automatic context injection from Nectar
- Structured session summaries routed to appropriate memory files
- Transparent terminal interaction (no hidden abstractions)

### Hive Shell

- 1 and 2-pane terminal layouts (extensible to grid)
- Monaco-based editor with file explorer
- Basic git status/diff
- Sidebar modes: Editor / terminals

## Development

### Nectar (Standalone)

```bash
cd Nectar
pnpm build
pnpm test
```

### WorkerBees (Standalone)

```bash
cd WorkerBees
pnpm build
pnpm test
```

### Hive (Desktop App)

```bash
cd Hive
pnpm dev          # Next.js dev server
pnpm tauri:dev    # Tauri dev mode with hot reload
pnpm tauri:build  # Build desktop app
```

## License

Open-source (license TBD)
