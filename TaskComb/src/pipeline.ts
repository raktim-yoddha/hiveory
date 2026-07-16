import type { TaskCard } from "./board.js";

export type NodeStatus = "pending" | "active" | "review" | "done" | "failed" | "pass";
export type StageKind = "planner" | "coordinator" | "builder" | "aggregator" | "reviewer" | "verifier";

export interface PipelineNode {
  id: string;
  label: string;
  subtitle?: string;
  cli?: string;
  role?: string;
  tag?: string;
  branch?: string;
  status: NodeStatus;
}

export interface PipelineStage {
  id: string;
  kind: StageKind;
  title: string;
  statusText: string;
  tag: string;
  nodes: PipelineNode[];
  layout: "single" | "parallel";
}

export function nodeStatus(t: TaskCard, agentStatus?: string): NodeStatus {
  if (t.blockingReason || agentStatus === "error") return "failed";
  if (t.column === "done") return "pass";
  if (t.column === "review") return "review";
  if (t.column === "in-progress" || agentStatus === "running" || agentStatus === "launching") return "active";
  return "pending";
}

function toNode(t: TaskCard, statuses: Record<string, string>): PipelineNode {
  return {
    id: t.id,
    label: t.title,
    subtitle: t.description,
    cli: t.assignedCli,
    role: t.assignedRole,
    tag: (t.assignedCli || t.assignedRole || "BUILD").toUpperCase(),
    branch: t.worktreeBranch,
    status: nodeStatus(t, t.workerBeeId ? statuses[t.workerBeeId] : undefined),
  };
}

export function buildPipeline(tasks: TaskCard[], statuses: Record<string, string> = {}): PipelineStage[] {
  const inCols = (cols: TaskCard["column"][]) =>
    tasks.filter((t) => cols.includes(t.column)).sort((a, b) => a.sortOrder - b.sortOrder).map((t) => toNode(t, statuses));

  const buildTasks = inCols(["backlog", "todo", "in-progress"]);
  const reviewTasks = inCols(["review"]);
  const doneTasks = inCols(["done"]);

  const hasActiveBuild = buildTasks.some((n) => n.status === "active");
  const hasReview = reviewTasks.length > 0;
  const hasDone = doneTasks.length > 0;
  const hasFailed = tasks.some((t) => t.blockingReason || (t.workerBeeId && statuses[t.workerBeeId] === "error"));

  const planNodeStatus = tasks.length === 0 ? "pending" : hasActiveBuild || hasReview || hasDone ? "done" : "active";
  const dispatchCount = buildTasks.length + reviewTasks.length + doneTasks.length;

  return [
    {
      id: "planner",
      kind: "planner",
      title: "Planner",
      statusText: tasks.length === 0 ? "Idle" : planNodeStatus === "active" ? "Orchestrating" : "Standing by",
      tag: "PLAN",
      layout: "single",
      nodes: [{
        id: "queenbee",
        label: "QueenBee",
        role: "orchestrator",
        tag: "PLAN",
        status: planNodeStatus,
      }],
    },
    {
      id: "coordinator",
      kind: "coordinator",
      title: "Coordinator",
      statusText: dispatchCount > 0 ? "Dispatch" : "Pending dispatch",
      tag: dispatchCount > 0 ? "CODEX" : "COORD",
      layout: "single",
      nodes: [{
        id: "coordinator",
        label: `Dispatch`,
        subtitle: dispatchCount > 0 ? `${dispatchCount} tasks` : undefined,
        tag: dispatchCount > 0 ? "CODEX" : "COORD",
        status: dispatchCount > 0 ? "done" : "pending",
      }],
    },
    {
      id: "builders",
      kind: "builder",
      title: `Building`,
      statusText: buildTasks.length > 0
        ? `${buildTasks.length} active build${buildTasks.length > 1 ? "s" : ""}`
        : "No active builds",
      tag: buildTasks.length > 0 ? `${buildTasks.length}` : "0",
      layout: buildTasks.length > 1 ? "parallel" : "single",
      nodes: buildTasks.length > 0 ? buildTasks : [{ id: "builders-empty", label: "No active builds", status: "pending" }],
    },
    {
      id: "aggregator",
      kind: "aggregator",
      title: "Aggregator",
      statusText: hasFailed ? "Some failed" : hasActiveBuild ? "Building..." : hasReview ? "Ready for review" : hasDone ? "Merged" : "Idle",
      tag: "MERGE",
      layout: "single",
      nodes: [{
        id: "aggregator",
        label: "Merge",
        subtitle: hasFailed ? "Some failed" : hasActiveBuild ? "Building..." : hasReview ? "Ready for review" : hasDone ? "Merged" : "Idle",
        tag: "MERGE",
        status: hasFailed ? "failed" : hasActiveBuild ? "active" : hasDone || hasReview ? "done" : "pending",
      }],
    },
    {
      id: "reviewer",
      kind: "reviewer",
      title: `Review`,
      statusText: reviewTasks.length > 0 ? `${reviewTasks.length} awaiting review` : "Awaiting review",
      tag: "REVIEW",
      layout: "single",
      nodes: reviewTasks.length > 0 ? reviewTasks : [{ id: "reviewer-empty", label: "Awaiting review", status: hasDone ? "done" : "pending" }],
    },
    {
      id: "verifier",
      kind: "verifier",
      title: "Verifier",
      statusText: hasDone && tasks.every((t) => t.column === "done")
        ? `${tasks.length} task${tasks.length === 1 ? "" : "s"} complete`
        : `${tasks.length} task${tasks.length === 1 ? "" : "s"}, ${doneTasks.length} done`,
      tag: hasDone && tasks.every((t) => t.column === "done") ? "PASS" : "VERIFY",
      layout: "single",
      nodes: [{
        id: "verifier",
        label: hasDone && tasks.every((t) => t.column === "done") ? "PASS" : "Pending",
        subtitle: hasDone && tasks.every((t) => t.column === "done")
          ? `${tasks.length} task${tasks.length === 1 ? "" : "s"} complete`
          : `${tasks.length} task${tasks.length === 1 ? "" : "s"}, ${doneTasks.length} done`,
        tag: hasDone && tasks.every((t) => t.column === "done") ? "PASS" : "VERIFY",
        status: hasDone && tasks.every((t) => t.column === "done") ? "pass" : hasFailed ? "failed" : "pending",
      }],
    },
  ];
}
