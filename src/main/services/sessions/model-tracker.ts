import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CliInstance } from '@shared/domain'
import type { CliRuntimeManager } from '../cli/runtime/runtime-manager'
import type { StateStore } from '../persistence/state-store'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import { headAndTail, newestFiles } from './readers'

const TICK_MS = 5000
/** Looking up an unknown Codex thread walks its sessions folder: at most this often. */
const CODEX_WALK_MS = 30_000

type Line = Record<string, unknown>
const obj = (v: unknown): Line => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() && v !== '<synthetic>' ? v : undefined)

/**
 * Live model tracking for the Kanban cards: which model each running agent is
 * using right now (it changes when the user runs /model). Read every few seconds
 * from the tail of the agent's own session file, which the CLI keeps anyway: the
 * last assistant reply's model for Claude Code, the last turn's for Codex.
 */
export class ModelTracker {
  private timer: NodeJS.Timeout | null = null
  private readonly codexFiles = new Map<string, string>()
  private codexWalkedAt = 0
  private readonly seen = new Map<string, number>()

  constructor(
    private readonly store: StateStore,
    private readonly workspaces: WorkspaceRepository,
    private readonly runtime: CliRuntimeManager,
    private readonly home = homedir()
  ) {}

  start(): void {
    this.timer ??= setInterval(() => void this.tick().catch(() => undefined), TICK_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    for (const instance of this.store.state.instances) {
      if (instance.chatUi || !this.runtime.details(instance.id).running) continue
      const cwd = this.workspaces.find(instance.workspaceId)?.path
      const file = cwd ? await this.sessionFile(instance, cwd) : undefined
      if (!file) continue
      const info = await stat(file).catch(() => null)
      // Unchanged file, unchanged model.
      if (!info || this.seen.get(file) === info.mtimeMs) continue
      this.seen.set(file, info.mtimeMs)
      const model = await this.modelIn(instance.cliId, file, info.size)
      if (model) this.runtime.setModel(instance.id, model)
    }
  }

  private async sessionFile(instance: CliInstance, cwd: string): Promise<string | undefined> {
    if (instance.cliId === 'claude') {
      // Claude Code keeps sessions under its projects folder, named by the working folder with every other character as "-".
      return join(this.home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${instance.conversationId}.jsonl`)
    }
    if (instance.cliId === 'codex' && instance.providerSessionId) {
      const id = instance.providerSessionId
      if (!this.codexFiles.has(id) && Date.now() - this.codexWalkedAt > CODEX_WALK_MS) {
        this.codexWalkedAt = Date.now()
        for (const f of await newestFiles(join(this.home, '.codex', 'sessions'), (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), 3, 200)) {
          const match = /([0-9a-f-]{36})\.jsonl$/i.exec(f.file)
          if (match) this.codexFiles.set(match[1]!, f.file)
        }
      }
      return this.codexFiles.get(id)
    }
    return undefined
  }

  private async modelIn(cliId: string, file: string, size: number): Promise<string | undefined> {
    const { tail } = await headAndTail(file, size)
    for (const line of [...tail].reverse()) {
      if (cliId === 'claude' && line.type === 'assistant' && !line.isSidechain) {
        const model = str(obj(line.message).model)
        if (model) return model
      }
      if (cliId === 'codex' && line.type === 'turn_context') {
        const model = str(obj(line.payload).model)
        if (model) return model
      }
    }
    return undefined
  }
}
