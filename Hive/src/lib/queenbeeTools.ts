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
  launchTerminal: (name?: string) => void;
  setBoardOpen: (open: boolean) => void;
  openSettings: () => boolean;
  // workspaces
  deleteWorkspace: (id: string) => boolean;
  renameWorkspace: (id: string, name: string) => boolean;
  recolorWorkspace: (id: string, color: string) => boolean;
  switchWorkspace: (id: string) => boolean;
  // worker bees
  listWorkerBees: () => Array<{ id: string; name: string; cli: string }>;
  removeWorkerBee: (id: string) => boolean;
  renameWorkerBee: (id: string, name: string) => boolean;
  reorderWorkerBee: (from: number, to: number) => boolean;
  setDefaultWorkerBee: (cli: string) => void;
  // layout
  setGridLayout: (layout: string) => void;
  maximizePane: (id: string | null) => void;
  refitTerminals: () => void;
  // chrome
  setLeftSidebar: (open: boolean) => void;
  setRightDock: (open: boolean) => void;
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
    name: "launch_terminal",
    description: "Open a plain shell terminal pane (PowerShell/cmd/bash) for running arbitrary commands — not a CLI agent.",
    params: { name: { type: "string", description: "Optional display name" } },
    required: [],
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
    name: "open_settings",
    description: "Open the Settings panel (providers + models configuration).",
    params: {},
    required: [],
    mutates: true,
  },
  {
    name: "delete_workspace",
    description: "Delete a workspace by id.",
    params: { id: { type: "string", description: "Workspace id" } },
    required: ["id"],
    mutates: true,
  },
  {
    name: "rename_workspace",
    description: "Rename a workspace.",
    params: { id: { type: "string", description: "Workspace id" }, name: { type: "string", description: "New name" } },
    required: ["id", "name"],
    mutates: true,
  },
  {
    name: "recolor_workspace",
    description: "Change a workspace's accent color (hex, e.g. #22c55e).",
    params: { id: { type: "string", description: "Workspace id" }, color: { type: "string", description: "Hex color" } },
    required: ["id", "color"],
    mutates: true,
  },
  {
    name: "switch_workspace",
    description: "Make a workspace the active one.",
    params: { id: { type: "string", description: "Workspace id" } },
    required: ["id"],
    mutates: true,
  },
  {
    name: "list_worker_bees",
    description: "List running WorkerBees with their ids, names, and CLI.",
    params: {},
    required: [],
    mutates: false,
  },
  {
    name: "remove_worker_bee",
    description: "Close/remove a WorkerBee pane by id.",
    params: { id: { type: "string", description: "WorkerBee id" } },
    required: ["id"],
    mutates: true,
  },
  {
    name: "rename_worker_bee",
    description: "Rename a WorkerBee pane.",
    params: { id: { type: "string", description: "WorkerBee id" }, name: { type: "string", description: "New display name" } },
    required: ["id", "name"],
    mutates: true,
  },
  {
    name: "reorder_worker_bee",
    description: "Move a WorkerBee from one grid position to another (0-based indices).",
    params: { from: { type: "number", description: "Current index" }, to: { type: "number", description: "Target index" } },
    required: ["from", "to"],
    mutates: true,
  },
  {
    name: "set_default_worker_bee",
    description: "Set the default CLI used when launching a new WorkerBee.",
    params: { cli: { type: "string", description: "CLI command, e.g. 'claude'" } },
    required: ["cli"],
    mutates: true,
  },
  {
    name: "set_grid_layout",
    description: "Set the WorkerBee grid layout.",
    params: { layout: { type: "string", description: "'auto', '1', '2', '3', or '4'", enum: ["auto", "1", "2", "3", "4"] } },
    required: ["layout"],
    mutates: true,
  },
  {
    name: "maximize_pane",
    description: "Maximize a WorkerBee pane by id, or pass an empty id to restore the grid.",
    params: { id: { type: "string", description: "Pane id, or '' to restore" } },
    required: [],
    mutates: true,
  },
  {
    name: "refit_terminals",
    description: "Re-fit all terminal panes to their containers (after a layout change).",
    params: {},
    required: [],
    mutates: true,
  },
  {
    name: "set_left_sidebar",
    description: "Show or hide the left workspace sidebar.",
    params: { open: { type: "boolean", description: "true to show" } },
    required: ["open"],
    mutates: true,
  },
  {
    name: "set_right_dock",
    description: "Show or hide the right QueenBee dock.",
    params: { open: { type: "boolean", description: "true to show" } },
    required: ["open"],
    mutates: true,
  },
  {
    name: "list_memory_files",
    description: "List the project's Nectar memory files (.nectar/memory/*.md).",
    params: {},
    required: [],
    mutates: false,
  },
  {
    name: "read_memory_file",
    description: "Read one Nectar memory file's contents by its path relative to .nectar/memory/.",
    params: { path: { type: "string", description: "e.g. 'architecture.md'" } },
    required: ["path"],
    mutates: false,
  },
  {
    name: "search_memory",
    description: "Hybrid (vector + keyword) search over the project's Nectar memory.",
    params: { query: { type: "string", description: "What to look for" } },
    required: ["query"],
    mutates: false,
  },
  {
    name: "list_dispatched",
    description: "List tasks that were dispatched into isolated git worktrees and are awaiting approval.",
    params: {},
    required: [],
    mutates: false,
  },
  {
    name: "approve_task",
    description:
      "Approve a dispatched task: merge its agent branch back into the project and remove its worktree. Only call after the human has approved the merge.",
    params: { taskId: { type: "string", description: "Task id from list_dispatched" } },
    required: ["taskId"],
    mutates: true,
  },
  {
    name: "write_memory",
    description:
      "Write a Nectar memory file (.nectar/memory/*.md). Nectar is QueenBee's memory — use this to record architecture, conventions, and decisions so every agent shares them. Overwrites the file at the given path.",
    params: {
      path: { type: "string", description: "Path under .nectar/memory/, e.g. 'architecture.md'" },
      content: { type: "string", description: "Full markdown content to write" },
    },
    required: ["path", "content"],
    mutates: true,
  },
  {
    name: "open_project",
    description: "Open the native folder picker so the human can choose a project to open.",
    params: {},
    required: [],
    mutates: true,
  },
  {
    name: "open_url",
    description: "Open a URL in the system browser — e.g. a running local dev server. Defaults to http://localhost:3000.",
    params: { url: { type: "string", description: "URL to open; defaults to http://localhost:3000" } },
    required: [],
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

/**
 * Tools the host executes asynchronously (Tauri IPC / git) rather than through
 * the pure executeTool switch below.
 */
export const ASYNC_TOOLS = new Set([
  "dispatch_goal",
  "approve_task",
  "list_dispatched",
  "list_memory_files",
  "read_memory_file",
  "search_memory",
  "write_memory",
  "open_project",
  "open_url",
]);

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
    case "launch_terminal": {
      ctx.launchTerminal(args.name ? String(args.name) : undefined);
      return `Opened a terminal${args.name ? ` "${args.name}"` : ""}.`;
    }
    case "set_board": {
      const open = args.open === true || args.open === "true";
      ctx.setBoardOpen(open);
      return open ? "Opened the board." : "Closed the board.";
    }
    case "open_settings": {
      const ok = ctx.openSettings();
      return ok ? "Opened Settings." : "Settings can't be opened from here.";
    }
    case "delete_workspace":
      if (!ctx.deleteWorkspace(String(args.id))) throw new ToolError(`No workspace "${args.id}".`);
      return `Deleted workspace ${args.id}.`;
    case "rename_workspace":
      if (!ctx.renameWorkspace(String(args.id), String(args.name))) throw new ToolError(`No workspace "${args.id}".`);
      return `Renamed workspace ${args.id} to "${args.name}".`;
    case "recolor_workspace":
      if (!ctx.recolorWorkspace(String(args.id), String(args.color))) throw new ToolError(`No workspace "${args.id}".`);
      return `Recolored workspace ${args.id}.`;
    case "switch_workspace":
      if (!ctx.switchWorkspace(String(args.id))) throw new ToolError(`No workspace "${args.id}".`);
      return `Switched to workspace ${args.id}.`;
    case "list_worker_bees": {
      const bees = ctx.listWorkerBees();
      return bees.length ? bees.map((b) => `- ${b.name} (${b.id}) — ${b.cli}`).join("\n") : "No WorkerBees running.";
    }
    case "remove_worker_bee":
      if (!ctx.removeWorkerBee(String(args.id))) throw new ToolError(`No WorkerBee "${args.id}".`);
      return `Removed WorkerBee ${args.id}.`;
    case "rename_worker_bee":
      if (!ctx.renameWorkerBee(String(args.id), String(args.name))) throw new ToolError(`No WorkerBee "${args.id}".`);
      return `Renamed WorkerBee ${args.id} to "${args.name}".`;
    case "reorder_worker_bee": {
      const from = Number(args.from);
      const to = Number(args.to);
      if (!Number.isInteger(from) || !Number.isInteger(to)) throw new ToolError("from/to must be integers.");
      if (!ctx.reorderWorkerBee(from, to)) throw new ToolError(`Index out of range (from=${from}, to=${to}).`);
      return `Moved WorkerBee from ${from} to ${to}.`;
    }
    case "set_default_worker_bee":
      ctx.setDefaultWorkerBee(String(args.cli));
      return `Default WorkerBee CLI set to "${args.cli}".`;
    case "set_grid_layout": {
      const layout = String(args.layout);
      if (!["auto", "1", "2", "3", "4"].includes(layout)) throw new ToolError(`Invalid layout "${layout}".`);
      ctx.setGridLayout(layout);
      return `Grid layout set to ${layout}.`;
    }
    case "maximize_pane": {
      const id = args.id ? String(args.id) : null;
      ctx.maximizePane(id);
      return id ? `Maximized pane ${id}.` : "Restored the grid.";
    }
    case "refit_terminals":
      ctx.refitTerminals();
      return "Refit all terminals.";
    case "set_left_sidebar": {
      const open = args.open === true || args.open === "true";
      ctx.setLeftSidebar(open);
      return open ? "Showed the left sidebar." : "Hid the left sidebar.";
    }
    case "set_right_dock": {
      const open = args.open === true || args.open === "true";
      ctx.setRightDock(open);
      return open ? "Showed the right dock." : "Hid the right dock.";
    }
    default:
      if (ASYNC_TOOLS.has(name)) {
        // Impure/async (Tauri IPC, git, PTY) — the host intercepts these first.
        throw new ToolError(`${name} must be executed by the host, not executeTool.`);
      }
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
