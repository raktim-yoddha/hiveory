/**
 * Token use read from each CLI's own history on the computer (ADR 0060): Claude Code, Codex and
 * Gemini CLI. Counts only; Hiveory never guesses a price. Dependency-free (the phone imports it).
 */

export interface TokenCounts {
  /** Fresh input (cache reads and writes not included). */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** One CLI's use of one model on one day (the computer's local date, YYYY-MM-DD). */
export interface UsageRow extends TokenCounts {
  cliId: string
  model: string
  day: string
  /** Model replies counted. */
  replies: number
}

export interface UsageReport {
  /** First day counted (YYYY-MM-DD). */
  since: string
  rows: UsageRow[]
  /** Conversations read. */
  sessions: number
}

export const USAGE_DAYS = [1, 7, 30, 90] as const

export const zeroTokens = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
export const totalTokens = (t: TokenCounts): number => t.input + t.output + t.cacheRead + t.cacheWrite

/** Adds `b` into `a`. */
export const addTokens = (a: TokenCounts, b: TokenCounts): TokenCounts => {
  a.input += b.input
  a.output += b.output
  a.cacheRead += b.cacheRead
  a.cacheWrite += b.cacheWrite
  return a
}

export interface UsageGroup extends TokenCounts {
  key: string
  replies: number
}

/** Rows summed by a key (a CLI, a model, a day), biggest first; days stay in date order. */
export const groupUsage = (rows: UsageRow[], by: 'cliId' | 'model' | 'day'): UsageGroup[] => {
  const groups = new Map<string, UsageGroup>()
  for (const row of rows) {
    const key = by === 'model' ? `${row.cliId}\u0000${row.model}` : row[by]
    const group = groups.get(key) ?? { key, replies: 0, ...zeroTokens() }
    addTokens(group, row)
    group.replies += row.replies
    groups.set(key, group)
  }
  const list = [...groups.values()]
  return by === 'day' ? list.sort((a, b) => a.key.localeCompare(b.key)) : list.sort((a, b) => totalTokens(b) - totalTokens(a))
}

/** A model group's key back into its CLI and model. */
export const splitModelKey = (key: string): { cliId: string; model: string } => {
  const [cliId = '', model = ''] = key.split('\u0000')
  return { cliId, model }
}

/** Share of input served from cache, 0–1. */
export const cacheShare = (t: TokenCounts): number => {
  const all = t.input + t.cacheRead + t.cacheWrite
  return all ? t.cacheRead / all : 0
}

/** 1.2M, 34k, 950. */
export const compactTokens = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(Math.round(n))
}

/** A local date as YYYY-MM-DD. */
export const localDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
