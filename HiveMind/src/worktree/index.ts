import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export interface WorktreeInfo {
  path: string;
  branch: string;
  taskId: string;
}

export class WorktreeManager {
  constructor(
    private projectPath: string,
    private parentDir?: string
  ) {
    this.parentDir ||= path.dirname(projectPath);
  }

  private projectName(): string {
    return path.basename(this.projectPath);
  }

  create(taskId: string): WorktreeInfo {
    const branchName = `agent/${taskId}`;
    const worktreePath = path.join(this.parentDir!, `${this.projectName()}-${taskId}`);

    execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
      cwd: this.projectPath,
      stdio: 'pipe',
    });

    return { path: worktreePath, branch: branchName, taskId };
  }

  remove(worktreePath: string): void {
    execSync(`git worktree remove "${worktreePath}"`, {
      cwd: this.projectPath,
      stdio: 'pipe',
    });
  }

  mergeAndRemove(worktreePath: string, branchName: string): void {
    execSync(`git merge "${branchName}"`, { cwd: this.projectPath, stdio: 'pipe' });
    this.remove(worktreePath);
  }

  exists(worktreePath: string): boolean {
    return fs.existsSync(worktreePath) && fs.existsSync(path.join(worktreePath, '.git'));
  }
}
