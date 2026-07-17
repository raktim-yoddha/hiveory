import { invoke } from "@tauri-apps/api/core";
import type { WorktreeOps, WorktreeInfo, HandoffFs } from "@hiveory/hivemind/core";

/**
 * Tauri-backed implementations of HiveMind's side-effect ports.
 *
 * HiveMind owns the orchestration logic (locks, roles, registry, plan/dispatch/
 * approve). Hive only translates its ports to Rust IPC — no policy lives here.
 */

interface RustWorktreeInfo { path: string; branch: string; task_id: string }

export class TauriWorktreeOps implements WorktreeOps {
  constructor(private projectPath: string) {}

  async create(taskId: string): Promise<WorktreeInfo> {
    const wt = await invoke<RustWorktreeInfo>("create_worktree", {
      projectPath: this.projectPath,
      taskId,
    });
    return { path: wt.path, branch: wt.branch, taskId: wt.task_id };
  }

  async remove(worktreePath: string): Promise<void> {
    await invoke("remove_worktree", { projectPath: this.projectPath, worktreePath });
  }

  async mergeAndRemove(worktreePath: string, branchName: string): Promise<void> {
    // The Rust command merges then removes in one step.
    await invoke("merge_worktree", {
      projectPath: this.projectPath,
      branch: branchName,
      worktreePath,
    });
  }

  async exists(worktreePath: string): Promise<boolean> {
    try {
      await invoke<unknown>("list_directory", { path: worktreePath });
      return true;
    } catch {
      return false;
    }
  }
}

interface RustFileInfo { name: string; is_file: boolean; is_dir: boolean }

/** Handoff storage over the Rust filesystem commands. */
export const tauriHandoffFs: HandoffFs = {
  mkdir: (dir) => invoke("ensure_dir", { path: dir }),
  writeFile: (file, content) => invoke("write_file", { path: file, content }),
  // read_file rejects on a missing path, which is exactly what HandoffFs wants.
  readFile: (file) => invoke<string>("read_file", { path: file }),
  readDir: async (dir) => {
    const entries = await invoke<RustFileInfo[]>("list_directory", { path: dir });
    return entries.filter((e) => e.is_file).map((e) => e.name);
  },
};
