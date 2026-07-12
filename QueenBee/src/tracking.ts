export type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'in-review' | 'done' | 'failed';

export interface TaskProgress {
  taskId: string;
  status: TaskStatus;
  agentId?: string;
  startedAt?: number;
  completedAt?: number;
  handoffSummary?: string;
}

export class ProgressTracker {
  private tasks = new Map<string, TaskProgress>();

  init(taskIds: string[]): void {
    for (const id of taskIds) {
      this.tasks.set(id, { taskId: id, status: 'backlog' });
    }
  }

  update(taskId: string, updates: Partial<TaskProgress>): void {
    const existing = this.tasks.get(taskId);
    if (existing) {
      Object.assign(existing, updates);
    }
  }

  get(taskId: string): TaskProgress | undefined {
    return this.tasks.get(taskId);
  }

  list(): TaskProgress[] {
    return Array.from(this.tasks.values());
  }

  listByStatus(status: TaskStatus): TaskProgress[] {
    return this.list().filter(t => t.status === status);
  }
}
