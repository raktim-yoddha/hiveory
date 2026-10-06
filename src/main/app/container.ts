import { app, BrowserWindow, nativeImage, safeStorage, shell, systemPreferences } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WallpaperService } from '../services/appearance/wallpaper-service'
import { EditorService } from '../services/editors/editor-service'
import { FileService } from '../services/files/file-service'
import { ConnectionService } from '../services/connections/connection-service'
import { McpGateway } from '../services/connections/mcp-gateway'
import { SecretBox } from '../services/connections/secret-box'
import { AgentTools } from '../services/agent-tools/agent-tools'
import { handleBody } from '../services/agent-tools/mcp-protocol'
import { AgentService } from '../services/agents/agent-service'
import { BrowserService } from '../services/browser/browser-service'
import { BrowserTools } from '../services/browser/browser-tools'
import { ComputerService } from '../services/computer/computer-service'
import { ComputerTools } from '../services/computer/computer-tools'
import { ExtensionsService } from '../services/extensions/extensions-service'
import { SessionHistoryService } from '../services/sessions/session-history'
import { ModelTracker } from '../services/sessions/model-tracker'
import { RepositoryService } from '../services/projects/repository-service'
import { BotService } from '../services/bots/bot-service'
import { BotTools } from '../services/bots/bot-tools'
import { ChatService } from '../services/chat/chat-service'
import { ChatStore } from '../services/chat/chat-store'
import { BUILT_IN_ADAPTERS } from '../services/cli/adapters'
import { HookServer } from '../services/cli/hooks/hook-server'
import { hostPtyBackend } from '../services/hosts/host-client'
import { LocalHost } from '../services/hosts/local-host'
import { SshHostConnector } from '../services/hosts/ssh-host'
import { inProcessPty } from '../services/pty/pty-backend'
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
import { QueenBrain } from '../services/queen/queen-brain'
import { GlobalHotkey, loadHook } from '../services/queen/global-hotkey'
import { QueenWatcher } from '../services/queen/queen-watcher'
import { lastWords } from '@shared/queen/updates'
import { VoiceService } from '../services/voice/voice-service'
import { ShellService } from '../services/shell/shell-service'
import { UpdateService, type Updater } from '../services/updates/update-service'
import { ProjectService } from '../services/projects/project-service'
import { WorkspaceRepository } from '../services/workspaces/workspace-repository'
import { WorkspaceService } from '../services/workspaces/workspace-service'
import { guard } from './guard'
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
  let bots: BotService | null = null
  const secrets = new SecretBox(safeStorage)
  const connections = new ConnectionService(store, secrets, emit)
  // Subscription brains run the user's own agent CLIs; their model lists come from the chat catalog.
  const queenBrain = new QueenBrain(store, secrets, fetch, {
    executable: (cliId) => registry.executable(cliId),
    models: async (cliId) => (await chats.catalog(cliId)).models.map((m) => m.id)
  })
  const voice = new VoiceService(paths.voiceDir, emit, log)
  const gateway = new McpGateway(() => connections.enabled(), (c) => connections.spec(c), log, app.getVersion())
  connections.attach(gateway)
  // Agent tools ride on the same loopback server and token as status hooks; route id = agent or chat id.
  const mcpFor = (id: string) => {
    const endpoint = hookServer?.endpoint
    if (!endpoint || !settings) return undefined
    const s = settings.get()
    const apps = connections.appNames()
    const computerOn = s.computerUse && computer.supported
    // A bot's thread always gets its memory and team tools, whatever the other tool settings say.
    const botId = chatStore.get(id)?.botId
    const bot = botId ? bots?.find(botId) : undefined
    if (!s.agentTools && !s.browserUse && !computerOn && !apps.length && !bot) return undefined
    return {
      url: `${endpoint.baseUrl}/mcp/${id}`,
      token: endpoint.token,
      coordination: s.agentTools,
      browser: s.browserUse,
      computer: computerOn,
      ...(apps.length ? { apps } : {}),
      ...(bot ? { bot: bot.chief ? ('chief' as const) : bot.messaging ? ('member' as const) : ('solo' as const) } : {})
    }
  }
  // Agent and shell PTYs run in the host daemon's own process (ADR 0022), in-process if it cannot start.
  const localHost = new LocalHost(join(import.meta.dirname, 'host.js'), log, (message) => emit('app.notice', { level: 'warning', message }))
  const ptyBackend = hostPtyBackend(() => localHost.get(), inProcessPty)
  // The same daemon on other machines, over the user's own OpenSSH (ADR 0022).
  const sshHosts = new SshHostConnector(join(import.meta.dirname, 'host.js'), log)
  const runtime = new CliRuntimeManager(registry, log, paths.runtimeDir, () => hookServer?.endpoint, mcpFor, ptyBackend)
  hookServer = new HookServer((id, event, payload) => runtime.ingestHook(id, event, payload), log)

  const workspaceRepo = new WorkspaceRepository(store)
  const layouts = new LayoutService(store, emit)
  const chatStore = new ChatStore(paths.chatsDir, log)
  const chats = new ChatService(
    chatStore,
    registry,
    workspaceRepo,
    log,
    emit,
    join(paths.chatsDir, 'attachments'),
    mcpFor,
    join(paths.runtimeDir, 'chat'),
    (chat) => bots?.preamble(chat)
  )
  bots = new BotService(store, chats, paths.botsDir, emit, log)
  const botTools = new BotTools(bots, chats)
  // Queen Bee's live updates watch every status change on its way to the renderer.
  const watcher = new QueenWatcher({
    agent: (id) => agents.find(id),
    isShell: (cliId) => registry.adapter(cliId)?.kind === 'shell',
    cliName: (cliId) => registry.displayName(cliId),
    workspaceName: (id) => workspaceRepo.find(id)?.name,
    excerpt: (agent) => lastWords(agent.chatUi ? chats.lastReply(agent.id) : runtime.screenText(agent.id, 60)),
    emit: (update) => emit('queen.update', update)
  })
  const agentEmit: Emit = (event, payload) => {
    emit(event, payload)
    if (event === 'runtime.changed') {
      const { instanceId, runtime: details } = payload as { instanceId: string; runtime: Parameters<QueenWatcher['onRuntime']>[1] }
      watcher.onRuntime(instanceId, details)
    }
  }
  const agents = new AgentService(store, workspaceRepo, layouts, registry, runtime, log, agentEmit, chats)
  const projects = new ProjectService(store, git, agents, emit)
  const workspaces = new WorkspaceService(workspaceRepo, git, worktrees, agents, paths.worktreeRoot, emit)
  const presets = new PresetService(store, emit)
  settings = new SettingsService(store, emit)
  const updates = new UpdateService(updater, log, emit)
  const hotkey = new GlobalHotkey(
    log,
    (signal) => {
      // A tap brings Hiveory forward; holding to talk works from wherever the user is.
      if (signal === 'tap') {
        const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())
        if (w?.isMinimized()) w.restore()
        w?.show()
        w?.focus()
      }
      emit('queen.hotkey', { signal })
    },
    () => BrowserWindow.getFocusedWindow() !== null,
    {
      platform: process.platform,
      wayland: process.env.XDG_SESSION_TYPE === 'wayland',
      trusted: (prompt) => (process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(prompt) : true),
      load: () => loadHook()
    }
  )
  const shells = new ShellService(ptyBackend)
  const sessions = new SessionHistoryService(log)
  const repositories = new RepositoryService(git)
  const models = new ModelTracker(store, workspaceRepo, runtime)
  guard(log, 'Model tracker', () => models.start())
  const extensions = new ExtensionsService(log, homedir(), (path) => shell.trashItem(path))
  const wallpapers = new WallpaperService(paths.wallpapersDir, nativeImage)
  const files = new FileService((path) => shell.trashItem(path), (scope, changed) => emit('files.changed', { scope, paths: changed }))
  const editors = new EditorService(store, layouts, (workspaceId) => agents.paneIds(workspaceId), emit)
  const browser = new BrowserService(store, settings, emit, log)
  const browserTools = new BrowserTools(browser, join(paths.runtimeDir, 'browser'), () => settings?.get().browserViewports ?? [])
  const computerTools = new ComputerTools(computer, (message) => emit('app.notice', { level: 'info', message }))
  // Plugins and Hiveory's MCP servers come through the gateway (ADR 0017).
  const extraTools = () => [...(settings?.get().computerUse && computer.supported ? [computerTools] : []), gateway]
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
    if (!settings) return refuse('Hiveory is starting.')
    const agent = agents.find(instanceId)
    if (agent && settings.get().agentTools) return handleBody(body, new AgentTools(toolDeps, instanceId))
    // A Chat-mode chat, or any agent while coordination tools are off: browser, computer and apps only.
    const chat = agent ? null : chatStore.get(instanceId)
    if (!agent && !chat) return refuse('This agent is no longer registered in Hiveory.')
    const caller = agent
      ? { id: agent.id, workspaceId: agent.workspaceId, petName: agent.petName }
      : { id: chat!.id, workspaceId: chat!.projectId ?? `chat-${chat!.id}`, petName: 'Chat' }
    const families = [
      ...(chat?.botId ? [botTools] : []),
      ...(settings.get().browserUse ? [{ handles: (n: string) => n.startsWith('browser_'), definitions: () => browserTools.definitions(), call: browserTools.call.bind(browserTools) }] : []),
      ...extraTools()
    ]
    return handleBody(body, {
      list: () => families.flatMap((f) => f.definitions()),
      call: (name, args) => {
        const family = families.find((f) => f.handles(name))
        return family ? family.call(caller, name, args) : Promise.resolve({ text: `Unknown tool: ${name}`, isError: true })
      }
    })
  })

  return {
    log,
    emit,
    store,
    git,
    github,
    registry,
    runtime,
    localHost,
    sshHosts,
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
    sessions,
    repositories,
    wallpapers,
    files,
    editors,
    connections,
    gateway,
    chatStore,
    chats,
    bots,
    browser,
    computer,
    queenBrain,
    voice,
    hotkey
  }
}
