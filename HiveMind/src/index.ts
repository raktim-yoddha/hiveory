/**
 * Node entry point: the pure core + the Node side-effect implementations.
 *
 * Browser/renderer hosts must import `@hiveory/hivemind/core` and supply their
 * own `WorktreeOps` / `HandoffFs` adapters — importing this file pulls
 * `node:child_process` and `node:fs`.
 */
import { AgentRegistry } from './registry/index.js';
import { LockRegistry } from './locks/index.js';
import { HandoffManager } from './handoffs/index.js';
import { RoleManager } from './roles/index.js';
import { Orchestrator } from './orchestrator.js';
import { NodeWorktreeManager, nodeHandoffFs } from './node.js';
import type { WorktreeOps, HandoffFs } from './ports.js';

export interface HiveMindConfig {
  projectPath: string;
  nectarProjectPath?: string;
  worktreeParentDir?: string;
  /** Override the side-effect ports (tests, or a non-Node host). */
  worktree?: WorktreeOps;
  handoffFs?: HandoffFs;
}

export class HiveMind {
  readonly registry: AgentRegistry;
  readonly locks: LockRegistry;
  readonly worktree: WorktreeOps;
  readonly handoffs: HandoffManager;
  readonly roles: RoleManager;
  readonly orchestrator: Orchestrator;

  constructor(config: HiveMindConfig) {
    this.registry = new AgentRegistry();
    this.locks = new LockRegistry();
    this.worktree =
      config.worktree ?? new NodeWorktreeManager(config.projectPath, config.worktreeParentDir);
    this.handoffs = new HandoffManager(
      config.nectarProjectPath || config.projectPath,
      config.handoffFs ?? nodeHandoffFs,
    );
    this.roles = new RoleManager();
    this.orchestrator = new Orchestrator(
      this.registry, this.locks, this.worktree, this.handoffs, this.roles,
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

// Pure core — re-exported so Node consumers only need one import.
export {
  AgentRegistry, LockRegistry, RoleManager, Orchestrator, HandoffManager,
  formatHandoff, parseHandoff, joinPath,
} from './core.js';
export { NodeWorktreeManager, WorktreeManager, nodeHandoffFs } from './node.js';

export type { Role, RoleDefinition } from './roles/index.js';
export type { AgentRecord, AgentStatus } from './registry/index.js';
export type { LockEntry, LockConflict } from './locks/index.js';
export type { HandoffEntry } from './handoffs/format.js';
export type { WorktreeInfo, WorktreeOps, HandoffFs } from './ports.js';
export type { TaskSpec } from './orchestrator.js';
