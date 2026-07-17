import { AgentRegistry, type AgentStatus } from './registry/index.js';
import { LockRegistry, type LockConflict } from './locks/index.js';
import { RoleManager, type Role } from './roles/index.js';
// Type-only: erased at compile time, so the core stays free of Node built-ins.
import type { WorktreeOps, WorktreeInfo } from './ports.js';
import type { HandoffManager } from './handoffs/index.js';

export interface TaskSpec {
  id: string;
  description: string;
  owns: string[];
  reads: string[];
  dependsOn: string[];
  role: Role;
  cli: string;
  missionId: string;
}

export interface OrchestrationResult {
  canStart: TaskSpec[];
  blocked: Array<{ task: TaskSpec; reason: string }>;
  conflicts: LockConflict[];
}

export class Orchestrator {
  constructor(
    private registry: AgentRegistry,
    private locks: LockRegistry,
    private worktree: WorktreeOps,
    private handoffs: HandoffManager,
    private roles: RoleManager,
  ) {}

  plan(tasks: TaskSpec[]): OrchestrationResult {
    const canStart: TaskSpec[] = [];
    const blocked: Array<{ task: TaskSpec; reason: string }> = [];
    const allConflicts: LockConflict[] = [];

    const completedTaskIds = new Set(
      this.registry.findByStatus('merged').map(a => a.taskId)
    );

    for (const task of tasks) {
      const unresolvedDeps = task.dependsOn.filter(d => !completedTaskIds.has(d));
      if (unresolvedDeps.length > 0) {
        blocked.push({ task, reason: `Waiting on: ${unresolvedDeps.join(', ')}` });
        continue;
      }

      const roleDef = this.roles.getDefinition(task.role);
      if (roleDef.needsWorktree && task.owns.length > 0) {
        const conflicts = this.locks.acquireMany(task.owns, task.id);
        if (conflicts.length > 0) {
          blocked.push({
            task,
            reason: `File conflict on: ${conflicts.map(c => c.filePath).join(', ')} (owned by task: ${conflicts[0].existingOwner})`,
          });
          allConflicts.push(...conflicts);
          continue;
        }
      }

      canStart.push(task);
    }

    return { canStart, blocked, conflicts: allConflicts };
  }

  async dispatch(task: TaskSpec): Promise<{ agentId: string; worktree?: WorktreeInfo }> {
    const roleDef = this.roles.getDefinition(task.role);
    let worktree: WorktreeInfo | undefined;

    if (roleDef.needsWorktree) {
      // await: WorktreeOps may be async (the desktop app goes through Tauri IPC).
      worktree = await this.worktree.create(task.id);
    }

    const agentId = `agent-${task.id}-${Date.now()}`;
    this.registry.register({
      id: agentId,
      taskId: task.id,
      cli: task.cli,
      role: task.role,
      worktreePath: worktree?.path || '',
      branchName: worktree?.branch || '',
      paneId: '',
      status: 'running',
      missionId: task.missionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await this.handoffs.write(task.id, {
      taskId: task.id,
      role: task.role,
      status: 'running',
      worktreePath: worktree?.path,
      branchName: worktree?.branch,
      filesTouched: task.owns,
      summary: task.description,
      blocking: [],
      dependsOn: task.dependsOn,
    });

    return { agentId, worktree };
  }

  async complete(agentId: string): Promise<void> {
    const agent = this.registry.get(agentId);
    if (!agent) return;

    this.registry.updateStatus(agentId, 'awaiting-review');
    await this.handoffs.write(agent.taskId, { status: 'awaiting-review' });
  }

  async approve(agentId: string): Promise<void> {
    const agent = this.registry.get(agentId);
    if (!agent) return;

    if (agent.worktreePath) {
      // Merge must land before we mark it merged / release the file locks —
      // otherwise a failed merge would free files an unmerged branch still owns.
      await this.worktree.mergeAndRemove(agent.worktreePath, agent.branchName);
    }

    this.registry.updateStatus(agentId, 'merged');
    this.locks.release(agent.taskId);

    await this.handoffs.write(agent.taskId, { status: 'merged' });
  }

  async reject(agentId: string, reviewerNotes: string): Promise<void> {
    const agent = this.registry.get(agentId);
    if (!agent) return;

    this.registry.updateStatus(agentId, 'failed');
    await this.handoffs.write(agent.taskId, {
      status: 'failed',
      reviewerNotes,
    });
  }
}
