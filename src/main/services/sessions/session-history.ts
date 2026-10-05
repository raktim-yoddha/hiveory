import { homedir } from 'node:os'
import { resolve, sep } from 'node:path'
import type { AgentSession } from '@shared/domain'
import type { Logger } from '../../app/logger'
import { claudeReader, codexReader, geminiReader, type SessionReader } from './readers'

const norm = (path: string): string => {
  const full = resolve(path)
  return process.platform === 'win32' ? full.toLowerCase() : full
}

/** The folder itself or anything inside it. */
export const isWithin = (path: string, folder: string): boolean => {
  const p = norm(path)
  const f = norm(folder)
  return p === f || p.startsWith(f.endsWith(sep) ? f : f + sep)
}

/**
 * Every agent conversation the CLIs keep on this computer (the side panel's
 * Sessions tab). Read-only: the CLIs own these files and their history lasts
 * across restarts and reboots on its own. Parsed summaries are cached by file
 * size and modification time, so a refresh only re-reads what changed.
 */
export class SessionHistoryService {
  private readonly cache = new Map<string, { mtimeMs: number; size: number; session: AgentSession | null }>()
  private readonly readers: SessionReader[] = [claudeReader, codexReader(), geminiReader()]

  constructor(
    private readonly log: Logger,
    private readonly home = homedir()
  ) {}

  /** Sessions that ran in one of `folders` (all of them when `folders` is undefined), newest first. */
  async list(folders?: string[]): Promise<AgentSession[]> {
    const all = (await Promise.all(this.readers.map((r) => this.readAll(r)))).flat()
    const wanted = folders ? all.filter((s) => folders.some((f) => isWithin(s.cwd, f))) : all
    return wanted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  private async readAll(reader: SessionReader): Promise<AgentSession[]> {
    const out: AgentSession[] = []
    for (const { file, mtimeMs, size } of await reader.files(this.home)) {
      const hit = this.cache.get(file)
      if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
        if (hit.session) out.push(hit.session)
        continue
      }
      let session: AgentSession | null = null
      try {
        session = await reader.read(file, size, mtimeMs, this.home)
      } catch (error) {
        this.log.warn(`Skipping unreadable ${reader.cliId} session ${file}`, error)
      }
      this.cache.set(file, { mtimeMs, size, session })
      if (session) out.push(session)
    }
    return out
  }
}
