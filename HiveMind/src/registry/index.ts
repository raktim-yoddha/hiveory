export type AgentStatus = 'pending' | 'running' | 'awaiting-review' | 'merged' | 'failed' | 'abandoned';

export interface AgentRecord {
  id: string;
  taskId: string;
  cli: string;
  role: string;
  worktreePath: string;
  branchName: string;
  paneId: string;
  status: AgentStatus;
  missionId: string;
  createdAt: number;
  updatedAt: number;
}

export class AgentRegistry {
  private agents = new Map<string, AgentRecord>();

  register(record: AgentRecord): void {
    this.agents.set(record.id, { ...record, updatedAt: Date.now() });
  }

  get(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  updateStatus(id: string, status: AgentStatus): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = status;
      agent.updatedAt = Date.now();
    }
  }

  findByTask(taskId: string): AgentRecord | undefined {
    for (const agent of this.agents.values()) {
      if (agent.taskId === taskId) return agent;
    }
    return undefined;
  }

  findByMission(missionId: string): AgentRecord[] {
    return Array.from(this.agents.values()).filter(a => a.missionId === missionId);
  }

  findByStatus(status: AgentStatus): AgentRecord[] {
    return Array.from(this.agents.values()).filter(a => a.status === status);
  }

  remove(id: string): void {
    this.agents.delete(id);
  }

  list(): AgentRecord[] {
    return Array.from(this.agents.values());
  }

  clear(): void {
    this.agents.clear();
  }
}
