/**
 * Node-only implementations of the side-effect ports.
 *
 * Never import this from `core.ts` — it pulls `node:child_process` / `node:fs`
 * and would break the renderer build. The desktop app supplies its own
 * Tauri-backed adapters instead.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { WorktreeInfo, WorktreeOps, HandoffFs } from './ports.js';

export class NodeWorktreeManager implements WorktreeOps {
  constructor(
    private projectPath: string,
    private parentDir?: string,
  ) {
    this.parentDir ||= path.dirname(projectPath);
  }

  private git(args: string[], cwd: string): void {
    // execFileSync (not execSync): arguments are passed as argv, so a task id or
    // path containing spaces/quotes can't break out into the shell.
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  }

  create(taskId: string): WorktreeInfo {
    const branch = `agent/${taskId}`;
    const worktreePath = path.join(this.parentDir!, `${path.basename(this.projectPath)}-${taskId}`);
    this.git(['worktree', 'add', worktreePath, '-b', branch], this.projectPath);
    return { path: worktreePath, branch, taskId };
  }

  remove(worktreePath: string): void {
    this.git(['worktree', 'remove', '--force', worktreePath], this.projectPath);
  }

  mergeAndRemove(worktreePath: string, branchName: string): void {
    this.git(['merge', '--no-ff', branchName], this.projectPath);
    this.remove(worktreePath);
  }

  exists(worktreePath: string): boolean {
    return fs.existsSync(worktreePath) && fs.existsSync(path.join(worktreePath, '.git'));
  }
}

/** Back-compat alias — this was the pre-port class name. */
export { NodeWorktreeManager as WorktreeManager };

export const nodeHandoffFs: HandoffFs = {
  mkdir: (dir) => fsp.mkdir(dir, { recursive: true }).then(() => undefined),
  writeFile: (file, content) => fsp.writeFile(file, content, 'utf-8'),
  readFile: (file) => fsp.readFile(file, 'utf-8'),
  readDir: (dir) => fsp.readdir(dir),
};
