/**
 * Side-effect ports.
 *
 * The orchestration logic (registry, locks, roles, plan/dispatch/approve) is
 * pure and must run anywhere — including the Tauri renderer, which has no
 * `node:child_process` or `node:fs`. So every side effect goes through one of
 * these interfaces. Node implementations live in `node.ts`; the desktop app
 * supplies Tauri-backed ones. Neither is imported by the core.
 */

export interface WorktreeInfo {
  path: string;
  branch: string;
  taskId: string;
}

/** Git worktree isolation for a task. Implementations may be sync or async. */
export interface WorktreeOps {
  /** Create `agent/<taskId>` in its own working directory. */
  create(taskId: string): WorktreeInfo | Promise<WorktreeInfo>;
  /** Remove a worktree directory (force). */
  remove(worktreePath: string): void | Promise<void>;
  /** Merge the agent branch back into the project, then drop the worktree. */
  mergeAndRemove(worktreePath: string, branchName: string): void | Promise<void>;
  exists(worktreePath: string): boolean | Promise<boolean>;
}

/**
 * The minimum filesystem surface handoffs need. Kept this small deliberately:
 * the markdown format itself stays in HiveMind (see `handoffs/format.ts`) so
 * every host writes byte-identical handoff files.
 */
export interface HandoffFs {
  mkdir(dir: string): Promise<void>;
  writeFile(file: string, content: string): Promise<void>;
  /** Must reject/throw when the file is absent. */
  readFile(file: string): Promise<string>;
  /** File names only (not full paths). May reject when the dir is absent. */
  readDir(dir: string): Promise<string[]>;
}

/**
 * Join path segments with forward slashes.
 *
 * Deliberately not `node:path` — this runs in the renderer too. Forward slashes
 * are accepted by Windows APIs, and these paths are all under `.nectar/`.
 */
export function joinPath(...segments: string[]): string {
  return segments
    .filter(Boolean)
    .map((s, i) => (i === 0 ? s.replace(/[\\/]+$/, "") : s.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join("/");
}
