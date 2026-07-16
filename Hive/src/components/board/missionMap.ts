import type { TaskCard } from "@hiveory/taskcomb";

// Pure, local derivation of the mission pipeline from task data — no LLM, no
// tokens. Turns the flat task list into left-to-right stages (Plan → Build →
// Review → Done) with a node per task showing its CLI, role, and worktree.

export type NodeStatus = "pending" | "active" | "review" | "done" | "failed";

export interface MapNode {
  id: string;
  label: string;
  cli?: string;
  role?: string;
  branch?: string;
  status: NodeStatus;
}

export interface MapStage {
  id: string;
  title: string;
  nodes: MapNode[];
}

export function nodeStatus(t: TaskCard, agentStatus?: string): NodeStatus {
  if (t.blockingReason || agentStatus === "error") return "failed";
  if (t.column === "done") return "done";
  if (t.column === "review") return "review";
  if (t.column === "in-progress" || agentStatus === "running" || agentStatus === "launching") return "active";
  return "pending";
}

function toNode(t: TaskCard, statuses: Record<string, string>): MapNode {
  return {
    id: t.id,
    label: t.title,
    cli: t.assignedCli,
    role: t.assignedRole,
    branch: t.worktreeBranch,
    status: nodeStatus(t, t.workerBeeId ? statuses[t.workerBeeId] : undefined),
  };
}

/**
 * Build the mission pipeline. `statuses` maps a WorkerBee id → live agent
 * status (from workerBeesStore.agentStatuses).
 */
export function buildMissionMap(tasks: TaskCard[], statuses: Record<string, string> = {}): MapStage[] {
  const inCols = (cols: TaskCard["column"][]) =>
    tasks
      .filter((t) => cols.includes(t.column))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => toNode(t, statuses));

  const build = inCols(["backlog", "todo", "in-progress"]);
  const review = inCols(["review"]);
  const done = inCols(["done"]);

  const planStatus: NodeStatus = tasks.length === 0 ? "pending" : "done";

  return [
    { id: "plan", title: "Plan", nodes: [{ id: "queenbee", label: "QueenBee", role: "planner", status: planStatus }] },
    { id: "build", title: `Build${build.length ? ` (${build.length})` : ""}`, nodes: build },
    { id: "review", title: `Review${review.length ? ` (${review.length})` : ""}`, nodes: review },
    { id: "done", title: `Done${done.length ? ` (${done.length})` : ""}`, nodes: done },
  ];
}
