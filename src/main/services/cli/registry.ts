import type { CliDescriptor } from '@shared/domain'
import { CHAT_CLI_IDS } from '@shared/domain/chat'
import type { CliAdapter } from './adapters'
import { findExecutable, processDiscoveryEnv, type DiscoveryEnv } from './discovery'
import type { Logger } from '../../app/logger'

/**
 * Dynamic CLI discovery (AGENTS.md rule 15). One adapter failing detection
 * never hides the others.
 */
export class CliRegistry {
  private cache: CliDescriptor[] | null = null
  private readonly executables = new Map<string, string>()

  constructor(
    private readonly adapters: CliAdapter[],
    private readonly log: Logger,
    private readonly env: () => DiscoveryEnv = processDiscoveryEnv
  ) {}

  list(refresh = false): CliDescriptor[] {
    if (this.cache && !refresh) return this.cache
    const env = this.env()
    this.cache = this.adapters.map((adapter) => {
      let executable: string | undefined
      try {
        executable = adapter.locate?.(env) ?? adapter.executables.map((name) => findExecutable(name, env)).find(Boolean)
      } catch (error) {
        this.log.warn(`CLI detection failed for ${adapter.id}`, error)
      }
      if (executable) this.executables.set(adapter.id, executable)
      else this.executables.delete(adapter.id)
      return {
        id: adapter.id,
        displayName: adapter.displayName,
        kind: adapter.kind ?? 'agent',
        icon: adapter.icon,
        supportsAutoApprove: adapter.supportsAutoApprove,
        resumesById: Boolean(adapter.adoptSession),
        supportsChat: (CHAT_CLI_IDS as readonly string[]).includes(adapter.id),
        available: Boolean(executable),
        executable
      }
    })
    return this.cache
  }

  adapter(cliId: string): CliAdapter | undefined {
    return this.adapters.find((a) => a.id === cliId)
  }

  executable(cliId: string): string | undefined {
    if (!this.cache) this.list()
    return this.executables.get(cliId)
  }

  displayName(cliId: string): string {
    return this.adapter(cliId)?.displayName ?? cliId
  }
}
