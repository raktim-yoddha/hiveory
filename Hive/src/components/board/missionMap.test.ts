import { describe, it, expect } from "vitest";
import { buildMissionMap, nodeStatus } from "./missionMap";
import type { TaskCard } from "@hiveory/taskcomb";

const card = (over: Partial<TaskCard>): TaskCard => ({
  id: "t", title: "T", description: "", column: "todo", sortOrder: 0,
  owns: [], reads: [], dependsOn: [], createdAt: 0, updatedAt: 0, ...over,
});

describe("nodeStatus", () => {
  it("done column → done", () => expect(nodeStatus(card({ column: "done" }))).toBe("done"));
  it("review column → review", () => expect(nodeStatus(card({ column: "review" }))).toBe("review"));
  it("in-progress → active", () => expect(nodeStatus(card({ column: "in-progress" }))).toBe("active"));
  it("running agent → active even if column lags", () => expect(nodeStatus(card({ column: "todo" }), "running")).toBe("active"));
  it("blockingReason → failed", () => expect(nodeStatus(card({ blockingReason: "conflict" }))).toBe("failed"));
  it("error agent → failed", () => expect(nodeStatus(card({}), "error")).toBe("failed"));
  it("plain todo → pending", () => expect(nodeStatus(card({ column: "todo" }))).toBe("pending"));
});

describe("buildMissionMap", () => {
  it("always has the four stages", () => {
    const stages = buildMissionMap([]);
    expect(stages.map((s) => s.id)).toEqual(["plan", "build", "review", "done"]);
    expect(stages[0].nodes[0].status).toBe("pending"); // plan pending with no tasks
  });

  it("routes tasks into stages by column and marks plan done", () => {
    const stages = buildMissionMap([
      card({ id: "a", column: "in-progress" }),
      card({ id: "b", column: "review" }),
      card({ id: "c", column: "done" }),
      card({ id: "d", column: "backlog" }),
    ]);
    const byId = Object.fromEntries(stages.map((s) => [s.id, s.nodes.map((n) => n.id)]));
    expect(byId.build.sort()).toEqual(["a", "d"]);
    expect(byId.review).toEqual(["b"]);
    expect(byId.done).toEqual(["c"]);
    expect(stages[0].nodes[0].status).toBe("done");
  });

  it("carries cli/role/branch onto nodes", () => {
    const [, build] = buildMissionMap([card({ id: "a", column: "todo", assignedCli: "codex", assignedRole: "builder", worktreeBranch: "agent/a" })]);
    expect(build.nodes[0]).toMatchObject({ cli: "codex", role: "builder", branch: "agent/a" });
  });
});
