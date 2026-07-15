import { describe, it, expect } from "vitest";
import { planDispatch } from "./dispatch";
import type { QueenBeeTask } from "@hiveory/queenbee";

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
