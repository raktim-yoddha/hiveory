import { join } from 'node:path'
import { AgentTools } from '../services/agent-tools/agent-tools'
import { handleBody } from '../services/agent-tools/mcp-protocol'
import { AgentService } from '../services/agents/agent-service'
import { BrowserService } from '../services/browser/browser-service'
import { BrowserTools } from '../services/browser/browser-tools'
import { ComputerService } from '../services/computer/computer-service'
import { ComputerTools } from '../services/computer/computer-tools'
import { ExtensionsService } from '../services/extensions/extensions-service'
import { ChatService } from '../services/chat/chat-service'
import { ChatStore } from '../services/chat/chat-store'
import { BUILT_IN_ADAPTERS } from '../services/cli/adapters'
import { HookServer } from '../services/cli/hooks/hook-server'
import { CliRegistry } from '../services/cli/registry'
import { CliRuntimeManager } from '../services/cli/runtime/runtime-manager'
import type { Emit } from '../services/events'
import { GithubService } from '../services/git/github-service'
import { GitService } from '../services/git/git-service'
import { WorktreeService } from '../services/git/worktree-service'
import { LayoutService } from '../services/layout/layout-service'
import { StateStore } from '../services/persistence/state-store'
import { PresetService } from '../services/presets/preset-service'
import { SettingsService } from '../services/settings/settings-service'
import { ShellService } from '../services/shell/shell-service'
import { UpdateService, type Updater } from '../services/updates/update-service'
import { ProjectService } from '../services/projects/project-service'
import { WorkspaceRepository } from '../services/workspaces/workspace-repository'
import { WorkspaceService } from '../services/workspaces/workspace-service'
import type { Logger } from './logger'
import type { AppPaths } from './paths'

export type Container = ReturnType<typeof createContainer>

/** Composition root: the only place services are wired together. */
export const createContainer = (paths: AppPaths, log: Logger, emit: Emit, updater: Updater | null = null) => {
  const store = new StateStore(paths.stateFile, log, (level, message) => emit('app.notice', { level, message }))
  const git = new GitService()
  const worktrees = new WorktreeService(git)
  const github = new GithubService(git)
  const registry = new CliRegistry(BUILT_IN_ADAPTERS, log)

  const computer = new ComputerService(paths.runtimeDir, log)
  let hookServer: HookServer | null = null
  let settings: SettingsService | null = null
  // Agent tools ride on the same loopback server and token as status hooks; route id = agent or chat id.
  const mcpFor = (id: string) => {
    const endpoint = hookServer?.endpoint
    if (!endpoint || !settings?.get().agentTools) return undefined
    const s = settings.get()
    return { url: `${endpoint.baseUrl}/mcp/${id}`, token: endpoint.token, browser: s.browserUse, computer: s.computerUse && computer.supported }
  }
  const runtime = new CliRuntimeManager(registry, log, paths.runtimeDir, () => hookServer?.endpoint, mcpFor)
  hookServer = new HookServer((id, event, payload) => runtime.ingestHook(id, event, payload), log)

  const workspaceRepo = new WorkspaceRepository(store)
  const layouts = new LayoutService(store, emit)
  const chatStore = new ChatStore(paths.chatsDir, log)
  const chats = new ChatService(chatStore, registry, workspaceRepo, log, emit, join(paths.chatsDir, 'attachments'), mcpFor, join(paths.runtimeDir, 'chat'))
  const agents = new AgentService(store, workspaceRepo, layouts, registry, runtime, log, emit, chats)
  const projects = new ProjectService(store, git, agents, emit)
  const workspaces = new WorkspaceService(workspaceRepo, git, worktrees, agents, paths.worktreeRoot, emit)
  const presets = new PresetService(store, emit)
  settings = new SettingsService(store, emit)
  const updates = new UpdateService(updater, log, emit)
  const shells = new ShellService()
  const extensions = new ExtensionsService(log)
  const browser = new BrowserService(store, settings, emit, log)
  const browserTools = new BrowserTools(browser, join(paths.runtimeDir, 'browser'), () => settings?.get().browserViewports ?? [])
  const computerTools = new ComputerTools(computer, (message) => emit('app.notice', { level: 'info', message }))
  const extraTools = () => (settings?.get().computerUse && computer.supported ? [computerTools] : [])
  const toolDeps = {
    agents,
    runtime,
    layouts,
    workspaces: workspaceRepo,
    registry,
    shells,
    chats,
    browser: () => (settings?.get().browserUse ? browserTools : null),
    extraTools
  }
  hookServer.setMcpHandler(async (instanceId, body) => {
    const refuse = (message: string) => ({ jsonrpc: '2.0', id: null, error: { code: -32001, message } })
    if (!settings?.get().agentTools) return refuse('Agent tools are turned off in Hiveory settings.')
    if (agents.find(instanceId)) return handleBody(body, new AgentTools(toolDeps, instanceId))
    // A Chat-mode chat (not a Work agent) gets the browser only.
    const chat = chatStore.get(instanceId)
    if (!chat) return refuse('This agent is no longer registered in Hiveory.')
    const caller = { id: chat.id, workspaceId: chat.projectId ?? `chat-${chat.id}`, petName: 'Chat' }
    const families = [...(settings.get().browserUse ? [{ handles: (n: string) => n.startsWith('browser_'), definitions: () => browserTools.definitions(), call: browserTools.call.bind(browserTools) }] : []), ...extraTools()]
    if (!families.length) return refuse('Browser and computer use are turned off in Hiveory settings.')
    return handleBody(body, {
      list: () => families.flatMap((f) => f.definitions()),
      call: (name, args) => {
        const family = families.find((f) => f.handles(name))
        return family ? family.call(caller, name, args) : Promise.resolve({ text: `Unknown tool: ${name}`, isError: true })
      }
    })
  })

  return {
    store,
    git,
    github,
    registry,
    runtime,
    hookServer,
    workspaceRepo,
    layouts,
    agents,
    projects,
    workspaces,
    presets,
    settings,
    updates,
    shells,
    extensions,
    chatStore,
    chats,
    browser,
    computer
  }
}
