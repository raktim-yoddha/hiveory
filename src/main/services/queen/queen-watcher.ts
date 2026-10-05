import type { CliInstance, CliRuntimeDetails } from '@shared/domain'
import type { QueenUpdate } from '@shared/queen/updates'

export interface WatcherDeps {
  agent(instanceId: string): CliInstance | undefined
  /** Plain shells have no agent status worth announcing. */
  isShell(cliId: string): boolean
  cliName(cliId: string): string
  workspaceName(workspaceId: string): string | undefined
  /** The agent's last chat reply or the last meaningful words on its screen. */
  excerpt(agent: CliInstance): string | undefined
  emit(update: QueenUpdate): void
  now?: () => number
}

/** A turn shorter than this is a blip (a prompt echo, a status flicker), not finished work. */
export const MIN_WORK_MS = 4000

/**
 * Queen Bee's live updates (ADR 0019): watches every agent's real status and
 * reports what matters — it finished, it needs you, it stopped with an error —
 * whether or not Queen Bee started the work. The first status seen for an
 * agent is only recorded, so restarts and app launch stay quiet.
 */
export class QueenWatcher {
  private readonly last = new Map<string, { status: CliRuntimeDetails['status']; running: boolean; since: number }>()

  constructor(private readonly deps: WatcherDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  onRuntime(instanceId: string, runtime: CliRuntimeDetails): void {
    const prev = this.last.get(instanceId)
    const now = this.now()
    const changed = !prev || prev.status !== runtime.status || prev.running !== runtime.running
    if (changed) this.last.set(instanceId, { status: runtime.status, running: runtime.running, since: prev?.status === runtime.status ? prev.since : now })
    if (!prev || !changed) return
    const agent = this.deps.agent(instanceId)
    if (!agent || this.deps.isShell(agent.cliId)) return
    const base = {
      instanceId,
      petName: agent.petName,
      cliName: this.deps.cliName(agent.cliId),
      projectId: agent.projectId,
      workspaceId: agent.workspaceId,
      workspaceName: this.deps.workspaceName(agent.workspaceId) ?? 'its workspace'
    }
    if (prev.running && !runtime.running) {
      if (runtime.error) this.deps.emit({ ...base, kind: 'stopped', reason: runtime.error.slice(0, 200) })
      return
    }
    if (runtime.status === 'waiting-for-you' && prev.status !== 'waiting-for-you') {
      const excerpt = this.deps.excerpt(agent)
      this.deps.emit({ ...base, kind: 'waiting', ...(runtime.waitingReason ? { reason: runtime.waitingReason } : {}), ...(excerpt ? { excerpt } : {}) })
      return
    }
    const worked = now - prev.since
    if (prev.status === 'working' && runtime.status === 'idle' && runtime.running && worked >= MIN_WORK_MS) {
      const excerpt = this.deps.excerpt(agent)
      this.deps.emit({ ...base, kind: 'finished', workedSeconds: Math.round(worked / 1000), ...(excerpt ? { excerpt } : {}) })
    }
  }

  forget(instanceId: string): void {
    this.last.delete(instanceId)
  }
}
