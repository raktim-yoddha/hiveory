import { describe, it, expect } from "vitest";
import { buildPipeline, nodeStatus } from "../src/pipeline.js";
import type { TaskCard } from "../src/board.js";

const card = (over: Partial<TaskCard>): TaskCard => ({
  id: "t", title: "T", description: "", column: "todo", sortOrder: 0,
  owns: [], reads: [], dependsOn: [], createdAt: 0, updatedAt: 0, ...over,
});

describe("nodeStatus", () => {
  it("done column → pass", () => expect(nodeStatus(card({ column: "done" }))).toBe("pass"));
  it("review column → review", () => expect(nodeStatus(card({ column: "review" }))).toBe("review"));
  it("in-progress → active", () => expect(nodeStatus(card({ column: "in-progress" }))).toBe("active"));
  it("running agent → active even if column lags", () => expect(nodeStatus(card({ column: "todo" }), "running")).toBe("active"));
  it("launching agent → active", () => expect(nodeStatus(card({ column: "todo" }), "launching")).toBe("active"));
  it("blockingReason → failed", () => expect(nodeStatus(card({ blockingReason: "conflict" }))).toBe("failed"));
  it("error agent → failed", () => expect(nodeStatus(card({}), "error")).toBe("failed"));
  it("plain backlog → pending", () => expect(nodeStatus(card({ column: "backlog" }))).toBe("pending"));
  it("plain todo → pending", () => expect(nodeStatus(card({ column: "todo" }))).toBe("pending"));
});

describe("buildPipeline", () => {
  it("always has the six stages", () => {
    const stages = buildPipeline([]);
    expect(stages.map((s) => s.id)).toEqual(["planner", "coordinator", "builders", "aggregator", "reviewer", "verifier"]);
    expect(stages[0].nodes[0].status).toBe("pending");
  });

  it("routes tasks into stages by column and marks planner done", () => {
    const stages = buildPipeline([
      card({ id: "a", column: "in-progress" }),
      card({ id: "b", column: "review" }),
      card({ id: "c", column: "done" }),
      card({ id: "d", column: "backlog" }),
    ]);
    const byId = Object.fromEntries(stages.map((s) => [s.id, s.nodes.map((n) => n.id)]));
    expect(byId.builders.sort()).toEqual(["a", "d"]);
    expect(byId.reviewer).toEqual(["b"]);
    expect(stages[0].nodes[0].status).toBe("done");
  });

  it("carries cli/role/branch onto nodes", () => {
    const stages = buildPipeline([card({ id: "a", column: "todo", assignedCli: "codex", assignedRole: "builder", worktreeBranch: "agent/a" })]);
    const buildNodes = stages.find((s) => s.id === "builders")!.nodes;
    expect(buildNodes[0]).toMatchObject({ cli: "codex", role: "builder", branch: "agent/a" });
  });

  it("verifier shows pass when all tasks done", () => {
    const stages = buildPipeline([card({ id: "a", column: "done" }), card({ id: "b", column: "done" })]);
    const verifier = stages.find((s) => s.id === "verifier")!;
    expect(verifier.nodes[0].status).toBe("pass");
    expect(verifier.nodes[0].label).toBe("PASS");
  });

  it("verifier shows pending when tasks remain", () => {
    const stages = buildPipeline([card({ id: "a", column: "in-progress" }), card({ id: "b", column: "done" })]);
    const verifier = stages.find((s) => s.id === "verifier")!;
    expect(verifier.nodes[0].status).toBe("pending");
    expect(verifier.nodes[0].label).toBe("Pending");
  });

  it("builders layout is parallel when multiple tasks", () => {
    const stages = buildPipeline([card({ id: "a", column: "todo" }), card({ id: "b", column: "in-progress" })]);
    const builders = stages.find((s) => s.id === "builders")!;
    expect(builders.layout).toBe("parallel");
  });

  it("builders layout is single when one or zero tasks", () => {
    const stages = buildPipeline([card({ id: "a", column: "todo" })]);
    const builders = stages.find((s) => s.id === "builders")!;
    expect(builders.layout).toBe("single");
  });
});
