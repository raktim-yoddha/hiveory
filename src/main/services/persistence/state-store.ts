import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Logger } from '../../app/logger'
import { emptyState, parseState, type PersistedState } from './schema'

/**
 * Single JSON document with atomic writes (temp file + rename). A corrupt
 * file is backed up and replaced instead of crashing the app.
 */
export class StateStore {
  private current: PersistedState = emptyState()
  private timer: NodeJS.Timeout | null = null
  private failing = false

  constructor(
    private readonly file: string,
    private readonly log: Logger,
    private readonly onNotice: (level: 'warning' | 'error', message: string) => void = () => undefined
  ) {}

  /** Loads from disk. Returns a user-facing notice when data had to be recovered. */
  load(): string | undefined {
    if (!existsSync(this.file)) return undefined
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (error) {
      const backup = `${this.file}.corrupt-${Date.now()}`
      try {
        copyFileSync(this.file, backup)
      } catch {
        // Backup is best effort; starting fresh must still work.
      }
      this.log.error('State file unreadable; starting fresh', error)
      return `Saved data could not be read and was reset. A backup was kept at ${backup}.`
    }
    const { state, rejected } = parseState(raw)
    this.current = state
    if (rejected > 0) {
      this.log.warn(`Dropped ${rejected} invalid record(s) from state file`)
      return `${rejected} saved item(s) were invalid and skipped.`
    }
    return undefined
  }

  get state(): Readonly<PersistedState> {
    return this.current
  }

  update(mutate: (draft: PersistedState) => void): void {
    const draft = structuredClone(this.current)
    mutate(draft)
    this.current = draft
    this.schedule()
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp`
      writeFileSync(temp, JSON.stringify(this.current, null, 2), 'utf8')
      renameSync(temp, this.file)
      this.failing = false
    } catch (error) {
      this.log.error('Failed to save state', error)
      if (!this.failing) this.onNotice('error', 'Hiveory could not save your data. Changes may be lost on restart.')
      this.failing = true
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 200)
  }
}
