import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { localDay, type UsageReport, type UsageRow } from '@shared/domain/usage'
import type { Logger } from '../../app/logger'
import { newestFiles } from '../sessions/readers'
import { claudeUsage, codexUsage, geminiUsage, type UsageReader } from './usage-readers'

type Json = Record<string, unknown>
/** A conversation file past this is skipped (it would take long to read and is almost never real). */
const MAX_FILE_BYTES = 256 * 1024 * 1024
const MAX_FILES = 5000

interface Source {
  root: (home: string) => string
  depth: number
  match: (name: string) => boolean
  read: UsageReader
}

/** Where each CLI keeps its conversations; Claude's subagents sit in a folder next to theirs. */
const SOURCES: Source[] = [
  { root: (h) => join(h, '.claude', 'projects'), depth: 3, match: (n) => n.endsWith('.jsonl'), read: claudeUsage },
  { root: (h) => join(h, '.codex', 'sessions'), depth: 3, match: (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), read: codexUsage },
  { root: (h) => join(h, '.gemini', 'tmp'), depth: 2, match: (n) => n.startsWith('session-') && (n.endsWith('.json') || n.endsWith('.jsonl')), read: geminiUsage }
]

async function* jsonLines(file: string): AsyncGenerator<Json> {
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.startsWith('{')) continue
    try {
      const value: unknown = JSON.parse(line)
      if (value && typeof value === 'object' && !Array.isArray(value)) yield value as Json
    } catch {
      // A half-written last line, or not JSON.
    }
  }
}

const collect = async (lines: AsyncGenerator<Json>): Promise<Json[]> => {
  const out: Json[] = []
  for await (const line of lines) out.push(line)
  return out
}

/**
 * Settings › Usage and the phone's Usage (ADR 0060): token counts per CLI, model and day, read from
 * the CLIs' own history on the machine Hiveory runs on. Read-only; a file is parsed again only when
 * its size or modification time changed.
 */
export class UsageService {
  private readonly cache = new Map<string, { mtimeMs: number; size: number; rows: UsageRow[] }>()

  constructor(
    private readonly log: Logger,
    private readonly home = homedir(),
    private readonly now = () => new Date()
  ) {}

  async report(days: number): Promise<UsageReport> {
    const start = this.now()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (days - 1))
    const since = localDay(start)
    const rows: UsageRow[] = []
    let sessions = 0
    for (const source of SOURCES) {
      const files = (await newestFiles(source.root(this.home), source.match, source.depth, MAX_FILES)).filter((f) => f.mtimeMs >= start.getTime())
      for (const file of files) {
        const own = (await this.rowsOf(source, file)).filter((r) => r.day >= since)
        if (own.length) sessions++
        rows.push(...own)
      }
    }
    return { since, rows, sessions }
  }

  private async rowsOf(source: Source, f: { file: string; mtimeMs: number; size: number }): Promise<UsageRow[]> {
    const hit = this.cache.get(f.file)
    if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return hit.rows
    let rows: UsageRow[] = []
    if (f.size <= MAX_FILE_BYTES) {
      try {
        const lines = f.file.endsWith('.json') ? ((JSON.parse(await readFile(f.file, 'utf8')) as Json).messages as Json[] | undefined) ?? [] : await collect(jsonLines(f.file))
        rows = source.read(Array.isArray(lines) ? lines : [], '')
      } catch (error) {
        this.log.warn(`Skipping unreadable usage in ${f.file}`, error)
      }
    }
    this.cache.set(f.file, { mtimeMs: f.mtimeMs, size: f.size, rows })
    return rows
  }
}
