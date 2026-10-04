import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { CliInstance, CliInstanceView, CliRuntimeDetails, CliSelection, LayoutNode, Side, Workspace } from '@shared/domain'
import { CHAT_CLI_IDS } from '@shared/domain/chat'
import { AppException, fail } from '@shared/errors'
import { buildGridLayout, dockPane, insertBeside, listPanes } from '@shared/layout/operations'
import { generatePetNames } from '@shared/naming/names'
import { normalizeSelections } from '@shared/presets'
import type { Logger } from '../../app/logger'
import type { ChatService } from '../chat/chat-service'
import type { CliRegistry } from '../cli/registry'
import type { CliRuntimeManager } from '../cli/runtime/runtime-manager'
import { nowIso, type Emit } from '../events'
import type { LayoutService } from '../layout/layout-service'
import type { StateStore } from '../persistence/state-store'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'

export interface Placement {
  targetPaneId: string
  side: Side
}

/** An agent that crashes after running at least this long is restarted automatically… */
const MIN_UPTIME_MS = 10_000
/** …at most this many times within the window, so a CLI that keeps crashing stops for the user to see. */
const MAX_RECOVERIES = 3
const RECOVERY_WINDOW_MS = 5 * 60_000
const RECOVERY_DELAY_MS = 1_000
/** Agents resumed at start-up are started this far apart, so the machine is never flooded. */
const RESUME_STAGGER_MS = 250

const CHAT_CAPABLE = new Set<string>(CHAT_CLI_IDS)

/**
 * Agent instance lifecycle: identity (id + pet name), pane placement and
 * process launch. Each instance is a distinct runtime entity (AGENTS.md rule 16).
 * Agents in chat view run headless through ChatService instead of a terminal.
 */
export class AgentService {
  private readonly startedAt = new Map<string, number>()
  private readonly recoveries = new Map<string, number[]>()
  /** Agents whose current process was started to resume an earlier conversation. */
  private readonly resumed = new Set<string>()

  constructor(
    private readonly store: StateStore,
    private readonly workspaces: WorkspaceRepository,
    private readonly layouts: LayoutService,
    private readonly registry: CliRegistry,
    private readonly runtime: CliRuntimeManager,
    private readonly log: Logger,
    private readonly emit: Emit,
    private readonly chats: ChatService
  ) {
    runtime.on('changed', (instance, runtimeDetails) => {
      if (runtimeDetails.status === 'working') this.markConversationStarted(instance.id)
      this.trackUptime(instance.id, runtimeDetails)
      this.emitRuntime(instance, runtimeDetails)
    })
    runtime.on('session', (instance, sessionId) => {
      this.store.update((s) => {
        const target = s.instances.find((i) => i.id === instance.id)
        if (target) Object.assign(target, { providerSessionId: sessionId, hasConversation: true })
      })
    })
    chats.on('run', (chatId, running) => {
      const instance = this.find(chatId)
      if (!instance?.chatUi) return
      if (running) this.markConversationStarted(instance.id)
      this.emitRuntime(instance, this.details(instance))
    })
  }

  /** Runtime state of any agent: its terminal process, or its chat runs in chat view. */
  details(instance: CliInstance): CliRuntimeDetails {
    if (!instance.chatUi) return this.runtime.details(instance.id)
    // A chat-view agent is always ready for a message; it is "working" while a reply streams.
    return this.chats.isRunning(instance.id) ? { status: 'working', running: true, activity: 'Replying' } : { status: 'idle', running: true }
  }

  instances(workspaceId: string): CliInstance[] {
    return this.store.state.instances.filter((i) => i.workspaceId === workspaceId)
  }

  /** Project-scoped query used by the Kanban (AGENTS.md rule 8). */
  instancesInProject(projectId: string): CliInstance[] {
    return this.store.state.instances.filter((i) => i.projectId === projectId)
  }

  countInWorkspace(workspaceId: string): number {
    return this.instances(workspaceId).length
  }

  list(workspaceId: string): CliInstanceView[] {
    return this.instances(workspaceId).map((i) => this.view(i))
  }

  view(instance: CliInstance): CliInstanceView {
    return { ...instance, runtime: this.details(instance) }
  }

  paneIds(workspaceId: string): string[] {
    return this.instances(workspaceId).map((i) => i.id)
  }

  open(workspaceId: string, cliId: string, placement?: Placement): { agent: CliInstanceView; layout: LayoutNode | null } {
    const workspace = this.workspaces.get(workspaceId)
    if (!this.registry.adapter(cliId)) fail('CLI_UNAVAILABLE', 'Unknown CLI.')
    const [instance] = this.build(workspace, [{ cliId, count: 1 }])
    const tree = this.layouts.get(workspaceId, this.paneIds(workspaceId))
    const next =
      placement && listPanes(tree).includes(placement.targetPaneId)
        ? insertBeside(tree, instance!.id, placement.targetPaneId, placement.side)
        : dockPane(tree, instance!.id, 'right')
    this.persist([instance!])
    this.layouts.set(workspaceId, next)
    this.launchQuietly(instance!, workspace)
    this.emitAgents(workspace)
    return { agent: this.view(instance!), layout: next }
  }

  /** Creates and launches instances for a fresh configuration, laid out as a grid. */
  createInstances(workspace: Workspace, selections: CliSelection[]): void {
    const instances = this.build(workspace, selections)
    if (instances.length === 0) return
    this.persist(instances)
    this.layouts.set(workspace.id, buildGridLayout(instances.map((i) => i.id)))
    for (const instance of instances) this.launchQuietly(instance, workspace)
    this.emitAgents(workspace)
  }

  /** Presets replace the configuration of an empty Workspace; they never merge (STARTER_PROMPT §10). */
  applyPreset(workspaceId: string, selections: CliSelection[], autoApprove: boolean, chatUi = false): void {
    const workspace = this.workspaces.get(workspaceId)
    if (this.countInWorkspace(workspaceId) > 0) {
      fail('FORBIDDEN', 'Presets can only be loaded into an empty workspace.', {
        hint: 'Close the open agents first.'
      })
    }
    const updated = { ...workspace, autoApprove, chatUi, updatedAt: nowIso() }
    this.workspaces.save(updated)
    this.createInstances(updated, selections)
  }

  close(instanceId: string): LayoutNode | null {
    const instance = this.get(instanceId)
    this.disposeRuntime(instance)
    this.store.update((s) => {
      s.instances = s.instances.filter((i) => i.id !== instanceId)
    })
    const workspace = this.workspaces.get(instance.workspaceId)
    const layout = this.layouts.get(workspace.id, this.paneIds(workspace.id))
    this.emitAgents(workspace)
    return layout
  }

  restart(instanceId: string): void {
    const instance = this.get(instanceId)
    // Chat view: stop a streaming reply (and make sure the agent's chat exists).
    if (instance.chatUi) this.chats.stop(instanceId)
    else this.runtime.stop(instanceId)
    this.launch(instance, this.workspaces.get(instance.workspaceId))
  }

  /**
   * Brings every terminal agent back after Hiveory starts (or the machine
   * rebooted), each resuming its own conversation where its CLI allows.
   * Sessions are durable: nobody has to press Start.
   */
  resumeAll(): void {
    const agents = this.store.state.instances.filter((i) => !i.chatUi)
    agents.forEach((agent, index) => {
      setTimeout(() => {
        const instance = this.find(agent.id)
        const workspace = instance && this.workspaces.find(instance.workspaceId)
        if (!instance || !workspace || this.runtime.details(instance.id).running) return
        this.launchQuietly(instance, workspace)
      }, index * RESUME_STAGGER_MS)
    })
  }

  stopWorkspace(workspaceId: string): void {
    for (const instance of this.instances(workspaceId)) {
      if (instance.chatUi) this.chats.stop(instance.id)
      else this.runtime.stop(instance.id)
    }
  }

  forgetWorkspace(workspaceId: string): void {
    for (const instance of this.instances(workspaceId)) this.disposeRuntime(instance)
    this.store.update((s) => {
      s.instances = s.instances.filter((i) => i.workspaceId !== workspaceId)
    })
  }

  forgetProject(projectId: string): void {
    for (const instance of this.instancesInProject(projectId)) this.disposeRuntime(instance)
    this.store.update((s) => {
      s.instances = s.instances.filter((i) => i.projectId !== projectId)
    })
  }

  find(instanceId: string): CliInstance | undefined {
    return this.store.state.instances.find((i) => i.id === instanceId)
  }

  private get(instanceId: string): CliInstance {
    const instance = this.store.state.instances.find((i) => i.id === instanceId)
    if (!instance) fail('NOT_FOUND', 'Agent not found.')
    return instance!
  }

  private build(workspace: Workspace, selections: CliSelection[]): CliInstance[] {
    const wanted = normalizeSelections(selections).filter((s) => this.registry.adapter(s.cliId))
    const total = wanted.reduce((n, s) => n + s.count, 0)
    // Unique among every configured instance, across all projects.
    const names = generatePetNames(total, this.store.state.instances.map((i) => i.petName))
    const now = nowIso()
    return wanted.flatMap(({ cliId, count }) =>
      Array.from({ length: count }, () => ({
        id: randomUUID(),
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        cliId,
        petName: names.shift() as string,
        conversationId: randomUUID(),
        hasConversation: false,
        autoApprove: workspace.autoApprove && (this.registry.adapter(cliId)?.supportsAutoApprove ?? false),
        // Chat view only for CLIs with a headless mode; the rest keep their terminal.
        chatUi: Boolean(workspace.chatUi) && CHAT_CAPABLE.has(cliId),
        createdAt: now
      }))
    )
  }

  private persist(instances: CliInstance[]): void {
    this.store.update((s) => {
      s.instances.push(...instances)
    })
  }

  private launch(instance: CliInstance, workspace: Workspace): void {
    if (!existsSync(workspace.path)) {
      const message = 'The workspace folder is missing.'
      this.runtime.markFailed(instance, message)
      fail('NOT_FOUND', message, { hint: 'Delete this workspace and create a new one.' })
    }
    if (instance.chatUi) return this.chats.ensureAgentChat(instance, workspace.path)
    const soleOfCli = this.instances(workspace.id).filter((i) => i.cliId === instance.cliId && !i.chatUi).length === 1
    if (instance.hasConversation) this.resumed.add(instance.id)
    else this.resumed.delete(instance.id)
    this.runtime.launch(instance, workspace.path, { soleOfCli })
  }

  private disposeRuntime(instance: CliInstance): void {
    this.startedAt.delete(instance.id)
    this.recoveries.delete(instance.id)
    if (instance.chatUi) this.chats.delete(instance.id)
    else this.runtime.dispose(instance.id)
  }

  private emitRuntime(instance: CliInstance, runtime: CliRuntimeDetails): void {
    this.emit('runtime.changed', { instanceId: instance.id, projectId: instance.projectId, workspaceId: instance.workspaceId, runtime })
  }

  /** Notices processes that end with an error after running a while, and brings them back. */
  private trackUptime(instanceId: string, details: CliRuntimeDetails): void {
    if (details.running) {
      if (!this.startedAt.has(instanceId)) this.startedAt.set(instanceId, Date.now())
      return
    }
    const since = this.startedAt.get(instanceId)
    this.startedAt.delete(instanceId)
    // A clean exit (the user quit, or Hiveory stopped it) carries no error and is left alone.
    if (since === undefined || !details.error) return
    if (Date.now() - since >= MIN_UPTIME_MS) return this.recover(instanceId, details.error)
    // Failing right after a resume usually means the CLI no longer has that session: start it fresh instead.
    if (this.resumed.has(instanceId)) this.startFresh(instanceId, details.error)
  }

  /** Forgets an unresumable conversation and starts the agent anew (once). */
  private startFresh(instanceId: string, error: string): void {
    this.resumed.delete(instanceId)
    this.store.update((s) => {
      const target = s.instances.find((i) => i.id === instanceId)
      if (target) Object.assign(target, { hasConversation: false, providerSessionId: undefined })
    })
    setTimeout(() => {
      const instance = this.find(instanceId)
      const workspace = instance && this.workspaces.find(instance.workspaceId)
      if (!instance || !workspace || this.runtime.details(instanceId).running) return
      this.log.warn(`Agent ${instance.petName} (${instance.cliId}) could not resume (${error}); starting a new session.`)
      this.launchQuietly(instance, workspace)
    }, RECOVERY_DELAY_MS)
  }

  /**
   * Agents must never silently die: a CLI that crashes (self-update, native
   * crash, lost console) is restarted, resuming its conversation where the
   * CLI supports it. Crash loops stop after MAX_RECOVERIES so the error shows.
   */
  private recover(instanceId: string, error: string): void {
    const now = Date.now()
    const recent = (this.recoveries.get(instanceId) ?? []).filter((t) => now - t < RECOVERY_WINDOW_MS)
    if (recent.length >= MAX_RECOVERIES) {
      this.log.warn(`Agent ${instanceId} keeps crashing (${error}); leaving it stopped.`)
      return
    }
    this.recoveries.set(instanceId, [...recent, now])
    setTimeout(() => {
      const instance = this.find(instanceId)
      const workspace = instance && this.workspaces.find(instance.workspaceId)
      if (!instance || !workspace || this.runtime.details(instanceId).running) return
      this.log.warn(`Agent ${instance.petName} (${instance.cliId}) crashed: ${error}. Restarting it.`)
      this.launchQuietly(instance, workspace)
    }, RECOVERY_DELAY_MS)
  }

  /** Launch failures are reflected in the instance's runtime details, not thrown. */
  private launchQuietly(instance: CliInstance, workspace: Workspace): void {
    try {
      this.launch(instance, workspace)
    } catch (error) {
      const detail = error instanceof AppException ? error.error.message : String(error)
      this.log.warn(`Launch failed for ${instance.cliId} (${instance.id}): ${detail}`)
    }
  }

  private markConversationStarted(instanceId: string): void {
    const instance = this.store.state.instances.find((i) => i.id === instanceId)
    if (!instance || instance.hasConversation) return
    this.store.update((s) => {
      const target = s.instances.find((i) => i.id === instanceId)
      if (target) target.hasConversation = true
    })
  }

  private emitAgents(workspace: Workspace): void {
    this.emit('state.changed', { topic: 'agents', projectId: workspace.projectId, workspaceId: workspace.id })
  }
}
