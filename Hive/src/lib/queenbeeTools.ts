import type { QueenBeeMode } from "@hiveory/queenbee";

// QueenBee's tool-calling surface: the actions she can perform conversationally,
// mapping 1:1 to things the UI can do. Pure + side-effect-free here — execution
// is injected via ToolContext so this module is testable without React/stores.
//
// Mode gating (per MODES.md): Steward acts (create/dispatch); Forager & Stinger
// are read-only auditors — they observe and report, they never mutate.

export interface ToolParam {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  required: string[];
  /** Whether the tool mutates app state (gated to Steward). */
  mutates: boolean;
}

/** Callbacks the host wires to real stores/Tauri. Kept minimal + typed. */
export interface ToolContext {
  createWorkspace: (name: string) => string;
  listWorkspaces: () => Array<{ id: string; name: string }>;
  addTask: (title: string, description?: string) => void;
  listTasks: () => Array<{ id: string; title: string; column: string }>;
  moveTask: (taskId: string, column: string) => boolean;
  launchWorkerBee: (cli: string, name?: string) => void;
  setBoardOpen: (open: boolean) => void;
}

const COLUMNS = ["backlog", "todo", "in-progress", "review", "done"];

export const TOOLS: ToolDef[] = [
  {
    name: "create_workspace",
    description: "Create a new workspace (a saved project context / tab).",
    params: { name: { type: "string", description: "Workspace name" } },
    required: ["name"],
    mutates: true,
  },
  {
    name: "list_workspaces",
    description: "List all workspaces with their ids and names.",
    params: {},
    required: [],
    mutates: false,
  },
  {
    name: "add_task",
    description: "Add a task card to the active workspace board (lands in Backlog).",
    params: {
      title: { type: "string", description: "Short task title" },
      description: { type: "string", description: "Optional longer description" },
    },
    required: ["title"],
    mutates: true,
  },
  {
    name: "list_tasks",
    description: "List task cards on the active workspace board.",
    params: {},
    required: [],
    mutates: false,
  },
  {
    name: "move_task",
    description: "Move a task card to a different board column.",
    params: {
      taskId: { type: "string", description: "Task card id" },
      column: { type: "string", description: "Target column", enum: COLUMNS },
    },
    required: ["taskId", "column"],
    mutates: true,
  },
  {
    name: "launch_worker_bee",
    description: "Launch a WorkerBee: a CLI coding agent in a terminal pane.",
    params: {
      cli: { type: "string", description: "CLI command to run, e.g. 'claude', 'codex', 'aider'" },
      name: { type: "string", description: "Optional display name for the pane" },
    },
    required: ["cli"],
    mutates: true,
  },
  {
    name: "set_board",
    description: "Open or close the TaskComb board drawer.",
    params: { open: { type: "boolean", description: "true to open, false to close" } },
    required: ["open"],
    mutates: true,
  },
  {
    name: "dispatch_goal",
    description:
      "Break a goal into tasks and dispatch WorkerBees for each — creates an isolated git worktree per builder task, launches the agent, and adds a board card. Only call after the human has approved dispatching.",
    params: { goal: { type: "string", description: "The goal to break down and dispatch" } },
    required: ["goal"],
    mutates: true,
  },
];

/** dispatch_goal is executed asynchronously by the host (Tauri + git), not by executeTool. */
export const ASYNC_TOOLS = new Set(["dispatch_goal"]);

/** Tools available to a given mode. Steward: all. Forager/Stinger: read-only. */
export function toolsForMode(mode: QueenBeeMode): ToolDef[] {
  if (mode === "Steward") return TOOLS;
  return TOOLS.filter((t) => !t.mutates);
}

export class ToolError extends Error {}

/**
 * Execute a tool call. Throws ToolError on bad input or when a mode tries a
 * tool it isn't allowed. Returns a short human/LLM-readable result string.
 */
export function executeTool(
  mode: QueenBeeMode,
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): string {
  const def = toolsForMode(mode).find((t) => t.name === name);
  if (!def) {
    throw new ToolError(`Tool "${name}" is not available in ${mode} mode.`);
  }
  for (const req of def.required) {
    if (args[req] === undefined || args[req] === null || args[req] === "") {
      throw new ToolError(`Missing required argument "${req}" for ${name}.`);
    }
  }

  switch (name) {
    case "create_workspace": {
      const id = ctx.createWorkspace(String(args.name));
      return `Created workspace "${args.name}" (${id}).`;
    }
    case "list_workspaces": {
      const ws = ctx.listWorkspaces();
      return ws.length
        ? ws.map((w) => `- ${w.name} (${w.id})`).join("\n")
        : "No workspaces.";
    }
    case "add_task": {
      ctx.addTask(String(args.title), args.description ? String(args.description) : undefined);
      return `Added task "${args.title}" to Backlog.`;
    }
    case "list_tasks": {
      const tasks = ctx.listTasks();
      return tasks.length
        ? tasks.map((t) => `- [${t.column}] ${t.title} (${t.id})`).join("\n")
        : "No tasks on the board.";
    }
    case "move_task": {
      const col = String(args.column);
      if (!COLUMNS.includes(col)) {
        throw new ToolError(`Invalid column "${col}". Must be one of: ${COLUMNS.join(", ")}.`);
      }
      const ok = ctx.moveTask(String(args.taskId), col);
      if (!ok) throw new ToolError(`No task found with id "${args.taskId}".`);
      return `Moved task ${args.taskId} to ${col}.`;
    }
    case "launch_worker_bee": {
      ctx.launchWorkerBee(String(args.cli), args.name ? String(args.name) : undefined);
      return `Launched WorkerBee "${args.name || args.cli}".`;
    }
    case "set_board": {
      const open = args.open === true || args.open === "true";
      ctx.setBoardOpen(open);
      return open ? "Opened the board." : "Closed the board.";
    }
    case "dispatch_goal":
      // Impure/async (git worktrees + PTY) — the host intercepts this before executeTool.
      throw new ToolError("dispatch_goal must be executed by the host, not executeTool.");
    default:
      throw new ToolError(`Unhandled tool "${name}".`);
  }
}

/** Anthropic Messages API tool schema. */
export function toAnthropicTools(mode: QueenBeeMode) {
  return toolsForMode(mode).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(t.params).map(([k, p]) => [
          k,
          p.enum ? { type: p.type, description: p.description, enum: p.enum } : { type: p.type, description: p.description },
        ]),
      ),
      required: t.required,
    },
  }));
}

/** OpenAI Chat Completions function-tool schema. */
export function toOpenAITools(mode: QueenBeeMode) {
  return toolsForMode(mode).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object" as const,
        properties: Object.fromEntries(
          Object.entries(t.params).map(([k, p]) => [
            k,
            p.enum ? { type: p.type, description: p.description, enum: p.enum } : { type: p.type, description: p.description },
          ]),
        ),
        required: t.required,
      },
    },
  }));
}
