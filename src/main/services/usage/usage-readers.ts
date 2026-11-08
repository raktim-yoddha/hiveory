import { localDay, type TokenCounts, type UsageRow } from '@shared/domain/usage'

/**
 * Token counts in each CLI's own history (ADR 0060). Every format is the CLI's private one, so a
 * line that does not fit is skipped, never an error. Each reader sees one conversation file's
 * lines in order and returns its rows per day and model.
 */

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {})
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

export type UsageReader = (lines: Iterable<Json>, sinceDay: string) => UsageRow[]

/** Sums replies into rows keyed by day and model. */
class Rows {
  private readonly rows = new Map<string, UsageRow>()
  constructor(private readonly cliId: string) {}

  add(at: unknown, model: string | undefined, tokens: TokenCounts, sinceDay: string): void {
    const when = typeof at === 'string' ? new Date(at) : undefined
    if (!when || Number.isNaN(when.getTime())) return
    const day = localDay(when)
    if (day < sinceDay) return
    const name = model ?? 'unknown'
    const key = `${day}\u0000${name}`
    const row = this.rows.get(key) ?? { cliId: this.cliId, model: name, day, replies: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    row.input += tokens.input
    row.output += tokens.output
    row.cacheRead += tokens.cacheRead
    row.cacheWrite += tokens.cacheWrite
    row.replies++
    this.rows.set(key, row)
  }

  list(): UsageRow[] {
    return [...this.rows.values()]
  }
}

/**
 * Claude Code: an assistant record's `message.usage`. One reply is written as several records (one
 * per content part) that repeat the same usage, so each message id counts once.
 */
export const claudeUsage: UsageReader = (lines, sinceDay) => {
  const rows = new Rows('claude')
  const seen = new Set<string>()
  for (const line of lines) {
    if (line.type !== 'assistant') continue
    const message = obj(line.message)
    const usage = obj(message.usage)
    const id = str(message.id) ?? str(line.requestId)
    if (!Object.keys(usage).length || (id && seen.has(id))) continue
    if (id) seen.add(id)
    const model = str(message.model)
    if (model === '<synthetic>') continue
    rows.add(line.timestamp, model, {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens)
    }, sinceDay)
  }
  return rows.list()
}

/**
 * Codex: `token_count` events carry the conversation's running total; each event's own use is the
 * growth since the one before (repeated events add nothing). Its input count includes cached input.
 */
export const codexUsage: UsageReader = (lines, sinceDay) => {
  const rows = new Rows('codex')
  let model: string | undefined
  let last = { input: 0, cached: 0, output: 0 }
  for (const line of lines) {
    const payload = obj(line.payload)
    if (line.type === 'turn_context') model = str(payload.model) ?? model
    if (line.type !== 'event_msg' || payload.type !== 'token_count') continue
    const total = obj(obj(payload.info).total_token_usage)
    const now = { input: num(total.input_tokens), cached: num(total.cached_input_tokens), output: num(total.output_tokens) }
    const grew = { input: now.input - last.input, cached: now.cached - last.cached, output: now.output - last.output }
    // A total that went down is a new count (a compacted or resumed conversation): take it whole.
    const step = grew.input < 0 || grew.output < 0 || grew.cached < 0 ? now : grew
    last = now
    if (step.input + step.output === 0) continue
    rows.add(line.timestamp, model, { input: Math.max(0, step.input - step.cached), output: step.output, cacheRead: step.cached, cacheWrite: 0 }, sinceDay)
  }
  return rows.list()
}

/** Gemini CLI: each reply's `tokens` (its input includes the cached part). */
export const geminiUsage: UsageReader = (lines, sinceDay) => {
  const rows = new Rows('gemini')
  for (const line of lines) {
    if (line.type !== 'gemini') continue
    const tokens = obj(line.tokens)
    if (!Object.keys(tokens).length) continue
    const cached = num(tokens.cached)
    rows.add(line.timestamp, str(line.model), { input: Math.max(0, num(tokens.input) - cached), output: num(tokens.output) + num(tokens.thoughts), cacheRead: cached, cacheWrite: 0 }, sinceDay)
  }
  return rows.list()
}
