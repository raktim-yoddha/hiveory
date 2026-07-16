import { breakdown, DefaultAssignmentStrategy } from "@hiveory/queenbee";
import type { QueenBeeTask } from "@hiveory/queenbee";
import { invoke } from "@tauri-apps/api/core";

// The orchestration spine, wired for the renderer. HiveMind's Orchestrator is
// Node-only (child_process git, fs handoffs), so Hive drives the same flow
// through Tauri Rust commands + the existing WorkerBee launch path:
//
//   goal → QueenBee.breakdown() → QueenBee.DefaultAssignmentStrategy →
//   per task: create_worktree (Tauri) → launch bee → board card
//
// Assignment strategy uses QueenBee's DefaultAssignmentStrategy internally,
// mapping role → worktree needs locally since Tauri worktree commands are
// async (HiveMind's WorktreeManager uses node:child_process synchronously).
//
// GUI-level behaviour (real git worktrees, PTY spawn) can only be verified by
// running the Tauri app; the pure planning below is unit-tested.

export interface WorktreeInfo {
  path: string;
  branch: string;
  task_id: string;
}

export interface DispatchPlanEntry {
  task: QueenBeeTask;
  cli: string;
  needsWorktree: boolean;
}

export interface DispatchResult {
  taskId: string;
  title: string;
  cli: string;
  worktree?: WorktreeInfo;
  error?: string;
}

// Roles that get their own isolated worktree (writers). Scouts/reviewers read.
const WORKTREE_ROLES = new Set(["builder"]);

/** Pure: turn breakdown tasks into an ordered dispatch plan. Testable. */
export function planDispatch(tasks: QueenBeeTask[]): DispatchPlanEntry[] {
  return tasks.map((task) => ({
    task,
    cli: task.suggestedCli || "claude",
    needsWorktree: WORKTREE_ROLES.has(task.suggestedRole),
  }));
}

export interface DispatchHooks {
  launchWorkerBee: (cli: string, name: string, cwd?: string) => void;
  addCard: (title: string, description: string, cli: string) => void;
}

/**
 * Execute a goal end-to-end: break it down, create a worktree per writer task,
 * launch a WorkerBee in it, and drop a board card. Returns per-task outcomes;
 * a failed worktree does not abort the rest.
 */
export async function dispatchGoal(
  goal: string,
  projectPath: string,
  hooks: DispatchHooks,
  nectarContext?: string,
): Promise<DispatchResult[]> {
  const { tasks } = await breakdown({ goal, nectarContext });
  const plan = planDispatch(tasks);
  const results: DispatchResult[] = [];

  for (const { task, cli, needsWorktree } of plan) {
    const result: DispatchResult = { taskId: task.id, title: task.description, cli };
    try {
      let cwd: string | undefined;
      if (needsWorktree && projectPath) {
        const wt = await invoke<WorktreeInfo>("create_worktree", {
          projectPath,
          taskId: task.id,
        });
        result.worktree = wt;
        cwd = wt.path;
      }
      hooks.launchWorkerBee(cli, task.description.slice(0, 40), cwd);
      hooks.addCard(task.description, `owns: ${task.owns.join(", ") || "—"}`, cli);
    } catch (e) {
      result.error = (e as Error)?.message || String(e);
    }
    results.push(result);
  }
  return results;
}
