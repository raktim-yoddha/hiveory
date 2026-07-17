import { describe, it, expect, beforeEach, vi } from "vitest";
import { planDispatch, getOrchestrator, resetOrchestrator } from "./dispatch";
import type { QueenBeeTask } from "@hiveory/queenbee";

// The orchestrator writes handoffs through Tauri IPC, which doesn't exist in a
// test process. Stub it so we can assert the pure lock/registry behaviour.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => "") }));

const task = (over: Partial<QueenBeeTask>): QueenBeeTask => ({
  id: "t-1",
  description: "do a thing",
  owns: [],
  reads: [],
  dependsOn: [],
  suggestedRole: "builder",
  suggestedCli: "codex",
  ...over,
});

describe("planDispatch", () => {
  it("gives builders a worktree", () => {
    const [entry] = planDispatch([task({ suggestedRole: "builder" })]);
    expect(entry.needsWorktree).toBe(true);
    expect(entry.cli).toBe("codex");
  });

  it("scouts and reviewers do not get a worktree", () => {
    const plan = planDispatch([task({ suggestedRole: "scout" }), task({ suggestedRole: "reviewer" })]);
    expect(plan.every((e) => !e.needsWorktree)).toBe(true);
  });

  it("falls back to a default cli", () => {
    const [entry] = planDispatch([task({ suggestedCli: "" })]);
    expect(entry.cli).toBe("claude");
  });
});

describe("orchestrator lifetime", () => {
  beforeEach(() => resetOrchestrator());

  it("reuses one orchestrator per project so locks survive between dispatches", () => {
    const a = getOrchestrator("/proj");
    const b = getOrchestrator("/proj");
    expect(b).toBe(a);
  });

  it("keeps projects isolated", () => {
    expect(getOrchestrator("/proj-a")).not.toBe(getOrchestrator("/proj-b"));
  });

  it("holds file locks across separate dispatch calls", () => {
    // The bug this guards: a per-call orchestrator dropped every lock the moment
    // dispatch returned, so a later goal could hand the same file to a 2nd builder.
    const { orchestrator } = getOrchestrator("/proj");
    const spec = (id: string) => ({
      id, description: id, owns: ["src/app.ts"], reads: [], dependsOn: [],
      role: "builder" as const, cli: "claude", missionId: "m1",
    });

    const first = orchestrator.plan([spec("t1")]);
    expect(first.canStart.map((t) => t.id)).toEqual(["t1"]);

    const second = orchestrator.plan([spec("t2")]);
    expect(second.canStart).toEqual([]);
    expect(second.conflicts[0]).toMatchObject({
      filePath: "src/app.ts",
      existingOwner: "t1",
      requestingTask: "t2",
    });
  });

  it("frees the file for a later task once the owner is approved", async () => {
    const { orchestrator, registry, locks } = getOrchestrator("/proj");
    const spec = (id: string) => ({
      id, description: id, owns: ["src/app.ts"], reads: [], dependsOn: [],
      role: "builder" as const, cli: "claude", missionId: "m1",
    });
    orchestrator.plan([spec("t1")]);

    // Simulate a dispatched agent without touching git/Tauri.
    registry.register({
      id: "agent-t1", taskId: "t1", cli: "claude", role: "builder",
      worktreePath: "", branchName: "", paneId: "", status: "running",
      missionId: "m1", createdAt: Date.now(), updatedAt: Date.now(),
    });
    // t1 owns the file, so t2 is refused...
    expect(locks.getOwnedFiles("t1")).toEqual(["src/app.ts"]);
    expect(orchestrator.plan([spec("t2")]).canStart).toEqual([]);

    await orchestrator.approve("agent-t1");

    // ...and approving releases it, so t2 can now claim the same file.
    expect(orchestrator.plan([spec("t2")]).canStart.map((t) => t.id)).toEqual(["t2"]);
  });
});
