import { app, BrowserWindow, nativeImage, Notification, powerMonitor, powerSaveBlocker, safeStorage, shell, systemPreferences } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WallpaperService } from '../services/appearance/wallpaper-service'
import { EditorService } from '../services/editors/editor-service'
import { FileService } from '../services/files/file-service'
import { ConnectionService } from '../services/connections/connection-service'
import { McpGateway } from '../services/connections/mcp-gateway'
import { AppService } from '../services/connections/app-service'
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
import { BotComputers } from '../services/bots/bot-computer'
import { DesktopTools } from '../services/bots/desktop-tools'
import { ChatService } from '../services/chat/chat-service'
import { ChatStore } from '../services/chat/chat-store'
import { BUILT_IN_ADAPTERS } from '../services/cli/adapters'
import { HookServer } from '../services/cli/hooks/hook-server'
import { hostPtyBackend } from '../services/hosts/host-client'
import { LocalHost } from '../services/hosts/local-host'
import { SshHostConnector } from '../services/hosts/ssh-host'
import { SshAuth } from '../services/hosts/ssh-auth'
import { HostRegistry, localKit } from '../services/hosts/host-kit'
import { PortForwards } from '../services/hosts/ports'
import { hostKey, type HostLinkStatus, type HostRef } from '@shared/domain'
import { botScope } from '@shared/domain/bot'
import { botReach } from '@shared/domain/bot-reach'
import { KeepAwake, wantsAwake } from '../services/routines/keep-awake'
import { RoutineService } from '../services/routines/routine-service'
import { RoutineTools } from '../services/routines/routine-tools'
import { replyNotice, runNotice } from '../services/routines/run-notice'
import { TeamService } from '../services/bots/team-service'
import { TriggerService } from '../services/triggers/trigger-service'
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
import { Sharing } from './sharing'
import { Tailscale } from '../services/tailscale/tailscale'

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
  const openBrowser = (url: string): void => void shell.openExternal(url)
  const connections = new ConnectionService(store, secrets, emit)
  // Subscription brains run the user's own agent CLIs; their model lists come from the chat catalog.
  const queenBrain = new QueenBrain(store, secrets, fetch, {
    executable: (cliId) => registry.executable(cliId),
    models: async (cliId) => (await chats.catalog(cliId)).models.map((m) => m.id)
  })
  const voice = new VoiceService(paths.voiceDir, emit, log)
  const gateway = new McpGateway(() => connections.enabled(), (c) => connections.spec(c), log, app.getVersion())
  connections.attach(gateway)
  const appService = new AppService(connections, openBrowser)
  // Agent tools ride on the same loopback server and token as status hooks; route id = agent or chat id.
  const mcpFor = (id: string, baseUrl?: string) => {
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
      // Agents on another machine reach the same server through their SSH tunnel.
      url: `${baseUrl ?? endpoint.baseUrl}/mcp/${id}`,
      token: endpoint.token,
      coordination: s.agentTools,
      browser: s.browserUse,
      computer: computerOn,
      ...(apps.length ? { apps } : {}),
      ...(bot ? { bot: bot.chief ? ('chief' as const) : bot.messaging ? ('member' as const) : ('solo' as const), botComputer: Boolean(bot.computer) } : {})
    }
  }
  // Agent and shell PTYs run in the host daemon's own process (ADR 0022), in-process if it cannot start.
  const localHost = new LocalHost(join(import.meta.dirname, 'host.js'), log, (message) => emit('app.notice', { level: 'warning', message }))
  const ptyBackend = hostPtyBackend(() => localHost.get(), inProcessPty)
  // The same daemon on other machines, over the user's own OpenSSH (ADR 0022).
  // HIVEORY_SSH_CONFIG points automated runs at their own ssh config (like HIVEORY_USER_DATA); users rely on ~/.ssh/config.
  // Its questions (passwords, passphrases, codes, new host keys) are asked in the window (ADR 0025).
  const sshAuth = new SshAuth(paths.runtimeDir, (event, payload) => emit(event, payload as never), log)
  const sshHosts = new SshHostConnector(
    join(import.meta.dirname, 'host.js'),
    log,
    process.env.HIVEORY_SSH_CONFIG ? ['-F', process.env.HIVEORY_SSH_CONFIG] : [],
    undefined,
    sshAuth
  )
  // A dropped host reconnects on its own while its terminals wait there (ADR 0025); say so once per change.
  const hostStatus = new Map<string, HostLinkStatus>()
  const onHostStatus = (host: HostRef, status: HostLinkStatus): void => {
    const before = hostStatus.get(hostKey(host))
    hostStatus.set(hostKey(host), status)
    emit('hosts.changed', { key: hostKey(host), status })
    if (status === 'reconnecting') emit('app.notice', { level: 'warning', message: `Lost the connection to ${host.destination}. Reconnecting; its agents keep running there meanwhile.` })
    if (status === 'connected' && before === 'reconnecting') emit('app.notice', { level: 'info', message: `Reconnected to ${host.destination}.` })
    if (status === 'offline' && before === 'reconnecting') {
      emit('app.notice', { level: 'warning', message: `Could not reconnect to ${host.destination}. Its agents stopped; they resume when you open them again.` })
    }
  }
  // The user's own Tailscale (ADR 0025): finding their devices, and serving this one to them.
  const tailscale = new Tailscale()
  const sharing = new Sharing(tailscale, log, paths.serverDevicesFile, app.getVersion())
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
  // Every project's machine: this computer, or an SSH host reached through hiveoryd (ADR 0022).
  let hosts: HostRegistry | null = null
  const kits = { kit: (host?: HostRef) => hosts!.kit(host) }
  bots = new BotService(store, chats, paths.botsDir, emit, log)
  const botTools = new BotTools(bots, chats)
  const teams = new TeamService(store, emit, (botId) => chats.threads(botId).some((t) => t.running))
  // Each bot's own Linux computer, in Docker here or on an SSH host (ADR 0022).
  const computers = new BotComputers((id) => bots!.get(id), kits, (id) => bots!.home(id), log)
  const desktopTools = new DesktopTools(computers, chats)
  /** A desktop notification, only while no Hiveory window is focused; clicking it opens the bot's thread. */
  const notifyDesktop = (notice: { title: string; body: string }, botId: string, threadId?: string): void => {
    const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (!window || BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return
    const shown = new Notification(notice)
    shown.on('click', () => {
      if (window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      if (threadId) emit('bots.open', { botId, threadId })
    })
    shown.show()
  }
  // Bots' scheduled work (ADR 0028); while plugged in, the computer stays awake around due runs.
  const keepAwake = new KeepAwake({ start: () => powerSaveBlocker.start('prevent-app-suspension'), stop: (id) => powerSaveBlocker.stop(id) })
  const routines = new RoutineService({
    store,
    bots,
    chats,
    emit,
    log,
    activity: (running, nextDueAt) =>
      keepAwake.set(
        wantsAwake({
          enabled: settings?.get().keepAwakeForRoutines ?? true,
          onBattery: powerMonitor.isOnBatteryPower(),
          running,
          untilNextMs: nextDueAt === undefined ? undefined : nextDueAt - Date.now()
        })
      ),
    // A run that ended or was missed while the user is elsewhere: a desktop notification that opens its thread.
    outcome: (run) => {
      const bot = bots?.find(run.botId)
      if (bot?.notify !== false) notifyDesktop(runNotice(run, bot?.name), run.botId, run.threadId)
    }
  })
  // A bot replied in a thread the user started, while they are elsewhere. Routine runs announce
  // themselves above; handed-down work goes back to the bot that asked, not to the user.
  chats.on('run', (chatId, running) => {
    if (running) return
    const chat = chats.find(chatId)
    const bot = chat?.botId ? bots?.find(chat.botId) : undefined
    if (!chat || !bot?.notify || chat.delegation || routines.isRunThread(chatId)) return
    notifyDesktop(replyNotice(bot.name, chats.lastReply(chatId)), bot.id, chatId)
  })
  // Outside events start read-only runs (ADR 0028): Composio's webhook, over Tailscale Funnel, to a loopback listener.
  const triggers = new TriggerService({
    store,
    emit,
    log,
    composio: (path, options) => appService.request(path, options),
    tailscale,
    secrets,
    bots: { find: (id) => bots?.find(id) },
    run: (trigger, data) => void routines.runEvent(trigger, data)
  })
  // A bot allowed to run on a schedule can see its routines and save new ones, always paused.
  const routineTools = new RoutineTools(() => routines, (chatId) => chats.find(chatId)?.botId)
  chats.on('run', (chatId, running) => {
    if (!running) computers.release(chatId)
  })
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
      // A turn started: real work, so the project rises in the sidebar.
      if (details.status === 'working') projects.markActive(agents.find(instanceId)?.projectId)
    }
  }
  const agents = new AgentService(store, workspaceRepo, layouts, registry, runtime, log, agentEmit, chats, kits)
  const projects = new ProjectService(store, kits, agents, emit)
  const workspaces = new WorkspaceService(workspaceRepo, kits, agents, paths.worktreeRoot, emit)
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
  hosts = new HostRegistry(
    localKit({
      git,
      worktrees,
      files,
      pty: ptyBackend,
      registry,
      hook: () => hookServer?.endpoint,
      worktreeRoot: paths.worktreeRoot,
      runtimeRoot: paths.runtimeDir,
      home: homedir()
    }),
    sshHosts,
    BUILT_IN_ADAPTERS,
    log,
    () => hookServer?.endpoint,
    (scope, changed) => emit('files.changed', { scope, paths: changed }),
    (host, status) => onHostStatus(host, status)
  )
  // Remote projects' ports, forwarded to this computer on request (ADR 0025).
  const ports = new PortForwards((host) => hosts!.kit(host))
  const editors = new EditorService(store, layouts, (workspaceId) => agents.paneIds(workspaceId), emit)
  // A bot's pages open in its own profile (made on first use), so its logins stay apart from the user's.
  const browser: BrowserService = new BrowserService(store, settings, emit, log, (scope) => {
    const bot = scope.startsWith(botScope('')) ? bots?.find(scope.slice(botScope('').length)) : undefined
    return bot ? bots!.browserProfile(bot.id, { list: () => browser.profiles(), create: (name) => browser.createProfile(name) }) : undefined
  })
  const browserTools = new BrowserTools(browser, join(paths.runtimeDir, 'browser'), () => settings?.get().browserViewports ?? [])
  const computerTools = new ComputerTools(computer, (message) => emit('app.notice', { level: 'info', message }))
  // Apps and Hiveory's MCP servers come through the gateway (ADR 0017, 0023).
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
    // A bot's thread: it reaches the computers its "Works on" choice allows, within the app's own switches.
    const bot = chat?.botId ? bots?.find(chat.botId) : undefined
    const caller = agent
      ? { id: agent.id, workspaceId: agent.workspaceId, petName: agent.petName }
      : bot
        ? // Every thread of a bot shares its browser pages (the bot panel's Browser tab).
          { id: chat!.id, workspaceId: botScope(bot.id), petName: bot.name }
        : { id: chat!.id, workspaceId: chat!.projectId ?? `chat-${chat!.id}`, petName: 'Chat' }
    const browserFamily = { handles: (n: string) => n.startsWith('browser_'), definitions: () => browserTools.definitions(), call: browserTools.call.bind(browserTools) }
    const reach = bot ? botReach(bot, { browser: settings.get().browserUse, computer: settings.get().computerUse && computer.supported }) : []
    const families = bot
      ? [botTools, ...(bot.routines ? [routineTools] : []), ...reach.map((f) => ({ browser: browserFamily, desktop: desktopTools, computer: computerTools })[f]), gateway]
      : [...(settings.get().browserUse ? [browserFamily] : []), ...extraTools()]
    return handleBody(body, {
      list: () => families.flatMap((f) => f.definitions()),
      call: (name, args) => {
        const family = families.find((f) => f.handles(name))
        return family ? family.call(caller, name, args) : Promise.resolve({ text: `Unknown tool: ${name}`, isError: true })
      }
    })
  })

  return {
    paths,
    log,
    emit,
    store,
    git,
    github,
    registry,
    runtime,
    localHost,
    sshHosts,
    sshAuth,
    ports,
    tailscale,
    sharing,
    hosts,
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
    apps: appService,
    chatStore,
    chats,
    bots,
    teams,
    routines,
    triggers,
    computers,
    browser,
    computer,
    queenBrain,
    voice,
    hotkey
  }
}
