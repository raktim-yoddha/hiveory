import { AgentService } from '../services/agents/agent-service'
import { BUILT_IN_ADAPTERS } from '../services/cli/adapters'
import { HookServer } from '../services/cli/hooks/hook-server'
import { CliRegistry } from '../services/cli/registry'
import { CliRuntimeManager } from '../services/cli/runtime/runtime-manager'
import type { Emit } from '../services/events'
import { GitService } from '../services/git/git-service'
import { WorktreeService } from '../services/git/worktree-service'
import { LayoutService } from '../services/layout/layout-service'
import { StateStore } from '../services/persistence/state-store'
import { PresetService } from '../services/presets/preset-service'
import { ProjectService } from '../services/projects/project-service'
import { WorkspaceRepository } from '../services/workspaces/workspace-repository'
import { WorkspaceService } from '../services/workspaces/workspace-service'
import type { Logger } from './logger'
import type { AppPaths } from './paths'

export type Container = ReturnType<typeof createContainer>

/** Composition root: the only place services are wired together. */
export const createContainer = (paths: AppPaths, log: Logger, emit: Emit) => {
  const store = new StateStore(paths.stateFile, log, (level, message) => emit('app.notice', { level, message }))
  const git = new GitService()
  const worktrees = new WorktreeService(git)
  const registry = new CliRegistry(BUILT_IN_ADAPTERS, log)

  let hookServer: HookServer | null = null
  const runtime = new CliRuntimeManager(registry, log, paths.runtimeDir, () => hookServer?.endpoint)
  hookServer = new HookServer((id, event, payload) => runtime.ingestHook(id, event, payload), log)

  const workspaceRepo = new WorkspaceRepository(store)
  const layouts = new LayoutService(store, emit)
  const agents = new AgentService(store, workspaceRepo, layouts, registry, runtime, log, emit)
  const projects = new ProjectService(store, git, agents, emit)
  const workspaces = new WorkspaceService(workspaceRepo, git, worktrees, agents, paths.worktreeRoot, emit)
  const presets = new PresetService(store, emit)

  return { store, git, registry, runtime, hookServer, workspaceRepo, layouts, agents, projects, workspaces, presets }
}
