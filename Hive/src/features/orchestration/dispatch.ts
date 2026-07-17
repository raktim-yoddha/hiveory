import { breakdown } from "@hiveory/queenbee";
import type { QueenBeeTask } from "@hiveory/queenbee";
import {
  AgentRegistry, LockRegistry, RoleManager, Orchestrator, HandoffManager,
} from "@hiveory/hivemind/core";
import type { Role, LockConflict } from "@hiveory/hivemind/core";
import { TauriWorktreeOps, tauriHandoffFs } from "./hivemindAdapters";

// The orchestration spine.
//
//   goal → QueenBee.breakdown() → HiveMind.Orchestrator.plan() (lock conflicts)
//        → per task: dispatch() → worktree + handoff + registry → launch bee
//
// HiveMind owns every orchestration decision (which roles need a worktree, who
// conflicts with whom, status lifecycle). Hive supplies Tauri adapters for the
// side effects and the UI hooks — no orchestration policy lives in this file.
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
  agentId?: string;
  worktree?: WorktreeInfo;
  /** Set when HiveMind's lock registry refused the task (file ownership clash). */
  blockedBy?: LockConflict[];
  error?: string;
}

const roles = new RoleManager();

/** QueenBee suggests a role name; map it onto HiveMind's role vocabulary. */
function toHiveMindRole(suggested: string): Role {
  const r = (suggested || "").toLowerCase();
  return r === "builder" || r === "scout" || r === "reviewer" || r === "coordinator"
    ? (r as Role)
    : "builder";
}

/**
 * Pure: turn breakdown tasks into an ordered dispatch plan.
 * Worktree need comes from HiveMind's RoleManager — the single source of truth.
 */
export function planDispatch(tasks: QueenBeeTask[]): DispatchPlanEntry[] {
  return tasks.map((task) => ({
    task,
    cli: task.suggestedCli || "claude",
    needsWorktree: roles.getDefinition(toHiveMindRole(task.suggestedRole)).needsWorktree,
  }));
}

export interface DispatchHooks {
  launchWorkerBee: (cli: string, name: string, cwd?: string) => void;
  addCard: (title: string, description: string, cli: string) => void;
}

function buildOrchestrator(projectPath: string) {
  const registry = new AgentRegistry();
  const locks = new LockRegistry();
  const handoffs = new HandoffManager(projectPath, tauriHandoffFs);
  const orchestrator = new Orchestrator(
    registry, locks, new TauriWorktreeOps(projectPath), handoffs, roles,
  );
  return { registry, locks, handoffs, orchestrator };
}

// One Orchestrator per project, kept for the session.
//
// Locks and the agent registry are *live state*: a per-call instance would drop
// every file lock the moment dispatch returned, so two goals dispatched minutes
// apart could hand the same file to two builders, and approve() would find no
// agent to merge. Keyed by project so separate projects stay isolated.
const orchestrators = new Map<string, ReturnType<typeof buildOrchestrator>>();

export function getOrchestrator(projectPath: string) {
  let existing = orchestrators.get(projectPath);
  if (!existing) {
    existing = buildOrchestrator(projectPath);
    orchestrators.set(projectPath, existing);
  }
  return existing;
}

/** Test seam: drop cached state (also used when a project closes). */
export function resetOrchestrator(projectPath?: string) {
  if (projectPath) orchestrators.delete(projectPath);
  else orchestrators.clear();
}

/**
 * Approve a task's work: merge its branch back and let HiveMind release the
 * file locks and mark the registry/handoff merged. Falls back to a direct merge
 * when the agent isn't in the registry (e.g. dispatched before a reload), so
 * approval still works — just without the bookkeeping.
 */
export async function approveTask(
  projectPath: string,
  taskId: string,
  fallback: { branch: string; worktreePath: string },
): Promise<{ merged: boolean; viaOrchestrator: boolean }> {
  const { registry, orchestrator } = getOrchestrator(projectPath);
  const agent = registry.findByTask(taskId);
  if (agent) {
    await orchestrator.approve(agent.id);
    return { merged: true, viaOrchestrator: true };
  }
  await new TauriWorktreeOps(projectPath).mergeAndRemove(fallback.worktreePath, fallback.branch);
  return { merged: true, viaOrchestrator: false };
}

/**
 * Execute a goal end-to-end: break it down, ask HiveMind whether each task can
 * start (file-ownership locks), then dispatch it — worktree, handoff, registry,
 * WorkerBee, board card. Returns per-task outcomes; one failure does not abort
 * the rest.
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

  const { orchestrator, handoffs } = getOrchestrator(projectPath);
  if (projectPath) {
    try { await handoffs.ensureStructure(); } catch { /* handoffs are best-effort */ }
  }

  // One goal = one mission; it groups this goal's tasks in the registry and in
  // `.nectar/agents/handoffs/` (HandoffManager.listByMission keys on this).
  const missionId = `m${Date.now().toString(36)}`;

  for (const { task, cli } of plan) {
    const result: DispatchResult = { taskId: task.id, title: task.description, cli };
    const spec = {
      id: task.id,
      description: task.description,
      owns: task.owns ?? [],
      reads: task.reads ?? [],
      dependsOn: task.dependsOn ?? [],
      role: toHiveMindRole(task.suggestedRole),
      cli,
      missionId,
    };

    try {
      // Ask HiveMind first: two builders owning the same file must not both run.
      const check = orchestrator.plan([spec]);
      if (!check.canStart.some((t) => t.id === task.id)) {
        result.blockedBy = check.conflicts;
        results.push(result);
        continue;
      }

      const { agentId, worktree } = await orchestrator.dispatch(spec);
      result.agentId = agentId;
      if (worktree) {
        result.worktree = { path: worktree.path, branch: worktree.branch, task_id: worktree.taskId };
      }
      hooks.launchWorkerBee(cli, task.description.slice(0, 40), worktree?.path);
      hooks.addCard(task.description, `owns: ${task.owns?.join(", ") || "—"}`, cli);
    } catch (e) {
      result.error = (e as Error)?.message || String(e);
    }
    results.push(result);
  }
  return results;
}
