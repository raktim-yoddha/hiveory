import { app, BrowserWindow, nativeImage, net, Notification, powerMonitor, powerSaveBlocker, safeStorage, shell, systemPreferences } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WallpaperService } from '../services/appearance/wallpaper-service'
import { ThemeService } from '../services/appearance/theme-service'
import { EditorService } from '../services/editors/editor-service'
import { FileService } from '../services/files/file-service'
import { ConnectionService } from '../services/connections/connection-service'
import { McpGateway } from '../services/connections/mcp-gateway'
import { startWorkRun } from '../services/routines/work-run'
import { RoutineFiles } from '../services/routines/routine-files'
import { PromptLibrary } from '../services/chat/prompt-library'
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
import { ChatService } from '../services/chat/chat-service'
import { ChatStore } from '../services/chat/chat-store'
import { BUILT_IN_ADAPTERS } from '../services/cli/adapters'
import { HookServer } from '../services/cli/hooks/hook-server'
import { hostPtyBackend } from '../services/hosts/host-client'
import { hostedChatProcesses } from '../services/chat/chat-process'
import { stageRuntime } from '../services/hosts/daemon-runtime'
import { LocalHost } from '../services/hosts/local-host'
import { SshHostConnector } from '../services/hosts/ssh-host'
import { SshAuth } from '../services/hosts/ssh-auth'
import { HostRegistry, localKit } from '../services/hosts/host-kit'
import { PortForwards } from '../services/hosts/ports'
import { appById, COMPOSIO, DETACHED_GRACE_MS, hostKey, type DetachedGrace, type HostLinkStatus, type HostRef } from '@shared/domain'
import { KeepAwake, wantsAwake } from '../services/routines/keep-awake'
import { RoutineService } from '../services/routines/routine-service'
import { runNotice } from '../services/routines/run-notice'
import { inProcessPty } from '../services/pty/pty-backend'
import { CliRegistry } from '../services/cli/registry'
import { CliRuntimeManager } from '../services/cli/runtime/runtime-manager'
import type { Emit } from '../services/events'
import { GithubService } from '../services/git/github-service'
import { GitlabService } from '../services/git/gitlab-service'
import { IntegrationService } from '../services/integrations/integration-service'
import { TrackerService } from '../services/integrations/tracker-service'
import { StoreService } from '../services/extensions/store-service'
import { AboutTools } from '../services/agent-tools/about-tools'
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
import { PetLink } from '../services/pet/pet-link'
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
  const secrets = new SecretBox(safeStorage)
  const openBrowser = (url: string): void => void shell.openExternal(url)
  const connections = new ConnectionService(store, secrets, emit)
  const integrations = new IntegrationService(git, { github, gitlab: new GitlabService(git) }, new TrackerService(store, secrets))
  // Subscription brains run the user's own agent CLIs; their model lists come from the chat catalog.
  // Provider calls use Chromium's network stack (system proxy, reliable connects): Node's fetch
  // intermittently hit 10 s connect timeouts to Cloudflare-fronted APIs (Groq, OpenRouter).
  const queenBrain = new QueenBrain(store, secrets, net.fetch as typeof fetch, {
    executable: (cliId) => registry.executable(cliId),
    models: async (cliId) => (await chats.catalog(cliId)).models.map((m) => m.id)
  })
  const voice = new VoiceService(paths.voiceDir, emit, log)
  const gateway = new McpGateway(() => connections.enabled(), (c) => connections.spec(c), log, app.getVersion())
  connections.attach(gateway)
  const appService = new AppService(connections, openBrowser)
  // Hooks and agent tools go through the terminal host's relay when it serves this app, so they
  // outlive a restart (ADR 0050 §6); else through Hiveory's own hook server.
  const agentEndpoint = () => localHost.relayEndpoint ?? hookServer?.endpoint
  // Agent tools ride on the same loopback server and token as status hooks; route id = agent or chat id.
  const mcpFor = (id: string, baseUrl?: string) => {
    const endpoint = agentEndpoint()
    if (!endpoint || !settings) return undefined
    const s = settings.get()
    const apps = connections.appNames()
    const computerOn = s.computerUse && computer.supported
    if (!s.agentTools && !s.browserUse && !computerOn && !apps.length) return undefined
    return {
      // Agents on another machine reach the same server through their SSH tunnel.
      url: `${baseUrl ?? endpoint.baseUrl}/mcp/${id}`,
      token: endpoint.token,
      coordination: s.agentTools,
      browser: s.browserUse,
      computer: computerOn,
      ...(apps.length ? { apps } : {})
    }
  }
  // Agent and shell PTYs run in the host daemon (ADR 0022), which outlives Hiveory (ADR 0050); a
  // utility process, or in-process, when it cannot start.
  const localHost = new LocalHost(
    join(import.meta.dirname, 'host.js'),
    join(paths.runtimeDir, 'hiveoryd'),
    log,
    (message) => emit('app.notice', { level: 'warning', message }),
    process.env.HIVEORY_STOP_AGENTS_ON_QUIT !== '1',
    // Installed builds run the daemon from its own copy of this version, so updates never end it (ADR 0050 §8).
    app.isPackaged
      ? {
          version: app.getVersion(),
          stage: () => stageRuntime(join(paths.runtimeDir, 'hiveoryd'), app.getVersion(), process.execPath, join(import.meta.dirname, 'host.js'))
        }
      : undefined
  )
  // Terminals an older daemon kept come back from it (ADR 0050 §8).
  const ptyBackend = hostPtyBackend(() => localHost.get(), inProcessPty, (adopt) => localHost.route(adopt))
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
  const runtime = new CliRuntimeManager(registry, log, paths.runtimeDir, agentEndpoint, mcpFor, ptyBackend, (id) => localHost.take(id))
  hookServer = new HookServer((id, event, payload) => runtime.ingestHook(id, event, payload), log, join(paths.runtimeDir, 'hook-endpoint.json'))

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
    // Chat-view agents run their CLI in the terminal host too (ADR 0051).
    hostedChatProcesses(() => localHost.get(), (chatId) => localHost.takeRun(chatId))
  )
  // Every project's machine: this computer, or an SSH host reached through hiveoryd (ADR 0022).
  let hosts: HostRegistry | null = null
  const kits = { kit: (host?: HostRef) => hosts!.kit(host) }
  /** A desktop notification, only while no Hiveory window is focused; clicking it brings Hiveory forward. */
  const notifyDesktop = (notice: { title: string; body: string }): void => {
    const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (!window || BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return
    const shown = new Notification(notice)
    shown.on('click', () => {
      if (window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    })
    shown.show()
  }
  // Worktrees' scheduled work (ADR 0028, 0040); while plugged in, the computer stays awake around due runs.
  const keepAwake = new KeepAwake({ start: () => powerSaveBlocker.start('prevent-app-suspension'), stop: (id) => powerSaveBlocker.stop(id) })
  const routineFiles = new RoutineFiles(join(paths.chatsDir, 'routine-files'))
  const routines = new RoutineService({
    store,
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
    // A run that ended or was missed while the user is elsewhere: a desktop notification.
    files: routineFiles,
    outcome: (run) => {
      notifyDesktop(runNotice(run))
      // Paired phones hear it too (ADR 0053): ids only.
      if (run.status !== 'skipped') sharing.notifyPhones(run.status === 'completed' ? 'A schedule finished.' : 'A schedule needs a look.', { kind: 'run' })
    },
    // Each run opens an agent in the routine's Worktree (ADR 0040).
    targets: {
      describe: (target) => {
        const cli = registry.list().find((c) => c.id === target.cliId)?.displayName ?? target.cliId
        const workspace = workspaceRepo.find(target.workspaceId)
        return workspace ? `${cli} in ${workspaceRepo.project(target.projectId).name} · ${workspace.name}` : `${cli} in a removed worktree`
      },
      workspace: (target, prompt) => {
        if (!workspaceRepo.find(target.workspaceId)) throw new Error('That worktree no longer exists.')
        return startWorkRun({ agents, runtime, chats }, target, prompt)
      }
    }
  })
  const prompts = new PromptLibrary(store, emit)
  // Queen Bee's live updates watch every status change on its way to the renderer.
  const watcher = new QueenWatcher({
    agent: (id) => agents.find(id),
    isShell: (cliId) => registry.adapter(cliId)?.kind === 'shell',
    cliName: (cliId) => registry.displayName(cliId),
    workspaceName: (id) => workspaceRepo.find(id)?.name,
    excerpt: (agent) => lastWords(agent.chatUi ? chats.lastReply(agent.id) : runtime.screenText(agent.id, 60)),
    // A Workspace with alerts off stays quiet: no Queen Bee update, no phone push (ADR 0037).
    emit: (update) => {
      if (workspaceRepo.findProject(update.projectId)?.settings?.alerts === false) return
      emit('queen.update', update)
    }
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
  // Pluto (formerly Hiveory Pet), the separate desktop pet app, follows the agents that run (ADR 0054): names and status only.
  const petLink = new PetLink(
    join(paths.runtimeDir, 'pet-link.json'),
    () =>
      store.state.instances
        .filter((i) => registry.adapter(i.cliId)?.kind !== 'shell')
        .map((i) => ({ i, runtime: agents.details(i) }))
        .filter(({ runtime }) => runtime.running || runtime.status !== 'idle')
        .map(({ i, runtime }) => ({
          id: i.id,
          name: i.petName,
          cli: registry.displayName(i.cliId),
          cliId: i.cliId,
          workspace: workspaceRepo.findProject(i.projectId)?.name ?? '',
          worktree: workspaceRepo.find(i.workspaceId)?.name ?? '',
          status: runtime.status
        })),
    log,
    app.getVersion()
  )
  const workspaces = new WorkspaceService(workspaceRepo, kits, agents, emit)
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
  const shells = new ShellService(ptyBackend, (id) => localHost.take(id)?.ptyId)
  const sessions = new SessionHistoryService(log)
  const repositories = new RepositoryService(git)
  const models = new ModelTracker(store, workspaceRepo, runtime)
  guard(log, 'Model tracker', () => models.start())
  const extensions = new ExtensionsService(log, homedir(), (path) => shell.trashItem(path))
  const wallpapers = new WallpaperService(paths.wallpapersDir, nativeImage)
  const themes = new ThemeService(paths.themesDir)
  const files = new FileService((path) => shell.trashItem(path), (scope, changed) => emit('files.changed', { scope, paths: changed }))
  hosts = new HostRegistry(
    localKit({
      git,
      worktrees,
      files,
      sessions,
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
  // One keep-for rule for kept terminals, on this computer and remote machines (ADR 0050 §7).
  const applyGrace = (grace: DetachedGrace): void => {
    localHost.setGrace(DETACHED_GRACE_MS[grace])
    hosts!.setGrace(DETACHED_GRACE_MS[grace])
  }
  applyGrace(store.state.settings.detachedGrace)
  settings.on('changed', (next, previous) => {
    if (next.detachedGrace !== previous.detachedGrace) applyGrace(next.detachedGrace)
  })
  // Remote projects' ports, forwarded to this computer on request (ADR 0025).
  const ports = new PortForwards((host) => hosts!.kit(host))
  const editors = new EditorService(store, layouts, (workspaceId) => agents.paneIds(workspaceId), emit)
  const browser: BrowserService = new BrowserService(store, settings, emit, log)
  // A worktree's browser pages are panes of its layout (ADR 0042): they join and leave it as they open and close.
  agents.setExtraPanes((workspaceId) => browser.pageIdsIn(workspaceId))
  agents.onForgetWorkspace((workspaceId) => browser.closeScope(workspaceId))
  browser.onScopeChange((scope, opened) => {
    if (!workspaceRepo.find(scope)) return
    const panes = agents.paneIds(scope)
    // An agent's page, or a popup, opens beside its agent or opener, not at the far right: a tab in
    // its area (ADR 0042).
    if (opened && panes.includes(opened.beside)) layouts.apply(scope, panes, { type: 'stack', paneId: opened.pageId, targetPaneId: opened.beside })
    else layouts.get(scope, panes)
    emit('state.changed', { topic: 'layout', workspaceId: scope })
  })
  const browserTools = new BrowserTools(browser, join(paths.runtimeDir, 'browser'), () => settings?.get().browserViewports ?? [])
  const computerTools = new ComputerTools(computer, (message) => emit('app.notice', { level: 'info', message }))
  // Every agent can ask Hiveory about itself (ADR 0041).
  const aboutTools = new AboutTools({
    settings: () => settings!.get(),
    worktree: (workspaceId) => {
      const worktree = workspaceRepo.find(workspaceId)
      return worktree ? { worktree, project: workspaceRepo.project(worktree.projectId) } : undefined
    },
    connections: () => connections.enabled().flatMap((c) => (c.provider === COMPOSIO.id ? (c.apps ?? []).map((id) => appById(id)?.name ?? id) : [c.name]))
  })
  // Apps and Hiveory's MCP servers come through the gateway (ADR 0017, 0023).
  const extraTools = () => [aboutTools, ...(settings?.get().computerUse && computer.supported ? [computerTools] : []), gateway]
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
  const handleMcp = async (instanceId: string, body: unknown): Promise<unknown> => {
    const refuse = (message: string) => ({ jsonrpc: '2.0', id: null, error: { code: -32001, message } })
    if (!settings) return refuse('Hiveory is starting.')
    const agent = agents.find(instanceId)
    if (agent && settings.get().agentTools) return handleBody(body, new AgentTools(toolDeps, instanceId))
    // Any agent while coordination tools are off: browser, computer and apps only.
    if (!agent) return refuse('This agent is no longer registered in Hiveory.')
    const caller = { id: agent.id, workspaceId: agent.workspaceId, petName: agent.petName }
    const browserFamily = { handles: (n: string) => n.startsWith('browser_'), definitions: () => browserTools.definitions(), call: browserTools.call.bind(browserTools) }
    const families = [...(settings.get().browserUse ? [browserFamily] : []), ...extraTools()]
    return handleBody(body, {
      list: () => families.flatMap((f) => f.definitions()),
      call: (name, args) => {
        const family = families.find((f) => f.handles(name))
        return family ? family.call(caller, name, args) : Promise.resolve({ text: `Unknown tool: ${name}`, isError: true })
      }
    })
  }
  hookServer.setMcpHandler(handleMcp)
  // The terminal host's relay hands its agents' hooks and tool calls to the same handlers (ADR 0050 §6).
  localHost.setRelayHandlers({ hook: (id, event, payload) => runtime.ingestHook(id, event, payload), mcp: handleMcp })

  return {
    paths,
    log,
    emit,
    store,
    git,
    github,
    integrations,
    stores: new StoreService(),
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
    petLink,
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
    themes,
    files,
    editors,
    connections,
    gateway,
    apps: appService,
    chatStore,
    chats,
    routines,
    routineFiles,
    prompts,
    browser,
    computer,
    queenBrain,
    voice,
    hotkey
  }
}
