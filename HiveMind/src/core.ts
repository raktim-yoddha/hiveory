/**
 * Pure orchestration core — safe to import anywhere, including the Tauri
 * renderer. Contains no `node:` imports (see `ports.ts` for why).
 *
 * Node consumers should import the package root instead, which bundles this
 * plus the `execSync`/`fs` implementations.
 */
export { AgentRegistry } from './registry/index.js';
export { LockRegistry } from './locks/index.js';
export { RoleManager } from './roles/index.js';
export { Orchestrator } from './orchestrator.js';
export { HandoffManager, formatHandoff, parseHandoff } from './handoffs/index.js';
export { joinPath } from './ports.js';

export type { Role, RoleDefinition } from './roles/index.js';
export type { AgentRecord, AgentStatus } from './registry/index.js';
export type { LockEntry, LockConflict } from './locks/index.js';
export type { HandoffEntry } from './handoffs/format.js';
export type { WorktreeInfo, WorktreeOps, HandoffFs } from './ports.js';
export type { TaskSpec } from './orchestrator.js';
