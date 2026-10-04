import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { CliInstance, CliInstanceView, CliSelection, LayoutNode, Side, Workspace } from '@shared/domain'
import { AppException, fail } from '@shared/errors'
import { buildGridLayout, dockPane, insertBeside, listPanes } from '@shared/layout/operations'
import { generatePetNames } from '@shared/naming/names'
import { normalizeSelections } from '@shared/presets'
import type { Logger } from '../../app/logger'
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

/**
 * Agent instance lifecycle: identity (id + pet name), pane placement and
 * process launch. Each instance is a distinct runtime entity (AGENTS.md rule 16).
 */
export class AgentService {
  constructor(
    private readonly store: StateStore,
    private readonly workspaces: WorkspaceRepository,
    private readonly layouts: LayoutService,
    private readonly registry: CliRegistry,
    private readonly runtime: CliRuntimeManager,
    private readonly log: Logger,
    private readonly emit: Emit
  ) {
    runtime.on('changed', (instance, runtimeDetails) => {
      if (runtimeDetails.status === 'working') this.markConversationStarted(instance.id)
      this.emit('runtime.changed', {
        instanceId: instance.id,
        projectId: instance.projectId,
        workspaceId: instance.workspaceId,
        runtime: runtimeDetails
      })
    })
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
    return { ...instance, runtime: this.runtime.details(instance.id) }
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
  applyPreset(workspaceId: string, selections: CliSelection[], autoApprove: boolean): void {
    const workspace = this.workspaces.get(workspaceId)
    if (this.countInWorkspace(workspaceId) > 0) {
      fail('FORBIDDEN', 'Presets can only be loaded into an empty workspace.', {
        hint: 'Close the open agents first.'
      })
    }
    const updated = { ...workspace, autoApprove, updatedAt: nowIso() }
    this.workspaces.save(updated)
    this.createInstances(updated, selections)
  }

  close(instanceId: string): LayoutNode | null {
    const instance = this.get(instanceId)
    this.runtime.dispose(instanceId)
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
    this.runtime.stop(instanceId)
    this.launch(instance, this.workspaces.get(instance.workspaceId))
  }

  stopWorkspace(workspaceId: string): void {
    for (const instance of this.instances(workspaceId)) this.runtime.stop(instance.id)
  }

  forgetWorkspace(workspaceId: string): void {
    for (const instance of this.instances(workspaceId)) this.runtime.dispose(instance.id)
    this.store.update((s) => {
      s.instances = s.instances.filter((i) => i.workspaceId !== workspaceId)
    })
  }

  forgetProject(projectId: string): void {
    for (const instance of this.instancesInProject(projectId)) this.runtime.dispose(instance.id)
    this.store.update((s) => {
      s.instances = s.instances.filter((i) => i.projectId !== projectId)
    })
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
    this.runtime.launch(instance, workspace.path)
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
