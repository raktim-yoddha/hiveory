import { AgentRegistry } from './registry/index.js';
import { LockRegistry } from './locks/index.js';
import { WorktreeManager } from './worktree/index.js';
import { HandoffManager } from './handoffs/index.js';
import { RoleManager, type Role } from './roles/index.js';
import { Orchestrator } from './orchestrator.js';

export interface HiveMindConfig {
  projectPath: string;
  nectarProjectPath?: string;
  worktreeParentDir?: string;
}

export class HiveMind {
  readonly registry: AgentRegistry;
  readonly locks: LockRegistry;
  readonly worktree: WorktreeManager;
  readonly handoffs: HandoffManager;
  readonly roles: RoleManager;
  readonly orchestrator: Orchestrator;

  constructor(config: HiveMindConfig) {
    this.registry = new AgentRegistry();
    this.locks = new LockRegistry();
    this.worktree = new WorktreeManager(config.projectPath, config.worktreeParentDir);
    this.handoffs = new HandoffManager(config.nectarProjectPath || config.projectPath);
    this.roles = new RoleManager();
    this.orchestrator = new Orchestrator(
      this.registry, this.locks, this.worktree, this.handoffs, this.roles
    );
  }

  static async create(config: HiveMindConfig): Promise<HiveMind> {
    const hm = new HiveMind(config);
    await hm.initialize();
    return hm;
  }

  private async initialize(): Promise<void> {
    await this.handoffs.ensureStructure();
  }
}

export type { Role } from './roles/index.js';
export type { AgentRecord, AgentStatus } from './registry/index.js';
export type { LockEntry, LockConflict } from './locks/index.js';
export type { HandoffEntry } from './handoffs/index.js';
export type { WorktreeInfo } from './worktree/index.js';
