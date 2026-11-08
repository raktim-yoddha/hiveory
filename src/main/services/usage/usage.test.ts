import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { compactTokens, groupUsage, splitModelKey, totalTokens, type UsageRow } from '@shared/domain/usage'
import { claudeUsage, codexUsage, geminiUsage } from './usage-readers'
import { UsageService } from './usage-service'

const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString()

describe('usage readers (ADR 0060)', () => {
  it('counts a Claude reply once though it is written per content part', () => {
    const usage = { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }
    const rows = claudeUsage(
      [
        { type: 'user', timestamp: at(3) },
        { type: 'assistant', timestamp: at(3), message: { id: 'm1', model: 'claude-x', usage } },
        { type: 'assistant', timestamp: at(3), message: { id: 'm1', model: 'claude-x', usage } },
        { type: 'assistant', timestamp: at(3), message: { id: 'm2', model: 'claude-x', usage: { ...usage, output_tokens: 3 } } },
        // Synthetic records (errors, interruptions) and records without usage add nothing.
        { type: 'assistant', timestamp: at(3), message: { id: 'm3', model: '<synthetic>', usage } },
        { type: 'assistant', timestamp: at(3), message: { id: 'm4', model: 'claude-x' } },
        // A bad timestamp or negative count is skipped, never thrown.
        { type: 'assistant', timestamp: 'soon', message: { id: 'm5', model: 'claude-x', usage } },
        { type: 'assistant', timestamp: at(4), message: { id: 'm6', model: 'claude-y', usage: { input_tokens: -9, output_tokens: 'x' } } }
      ],
      ''
    )
    expect(rows).toEqual([
      { cliId: 'claude', model: 'claude-x', day: '2026-10-03', replies: 2, input: 10, output: 10, cacheRead: 200, cacheWrite: 40 },
      { cliId: 'claude', model: 'claude-y', day: '2026-10-04', replies: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    ])
  })

  it("takes Codex's growth between running totals, cached input apart", () => {
    const total = (input: number, cached: number, output: number) => ({ type: 'event_msg', timestamp: at(5), payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } } })
    const rows = codexUsage(
      [
        { type: 'turn_context', payload: { model: 'gpt-x' } },
        total(100, 40, 10),
        total(100, 40, 10), // repeated: nothing new
        total(250, 140, 30),
        { type: 'event_msg', timestamp: at(5), payload: { type: 'token_count', info: null } },
        total(50, 0, 5) // went down: a fresh count, taken whole
      ],
      ''
    )
    expect(rows).toEqual([{ cliId: 'codex', model: 'gpt-x', day: '2026-10-05', replies: 3, input: 60 + 50 + 50, output: 10 + 20 + 5, cacheRead: 40 + 100, cacheWrite: 0 }])
  })

  it("reads Gemini's per-reply tokens and keeps only days from `since`", () => {
    const rows = geminiUsage(
      [
        { type: 'user', timestamp: at(1) },
        { type: 'gemini', timestamp: at(1), model: 'gemini-x', tokens: { input: 50, cached: 20, output: 5, thoughts: 2 } },
        { type: 'gemini', timestamp: at(9), model: 'gemini-x', tokens: { input: 10, cached: 0, output: 1 } }
      ],
      '2026-10-02'
    )
    expect(rows).toEqual([{ cliId: 'gemini', model: 'gemini-x', day: '2026-10-09', replies: 1, input: 10, output: 1, cacheRead: 0, cacheWrite: 0 }])
  })
})

describe('usage summaries (ADR 0060)', () => {
  const row = (cliId: string, model: string, day: string, input: number): UsageRow => ({ cliId, model, day, replies: 1, input, output: 0, cacheRead: 0, cacheWrite: 0 })
  const rows = [row('claude', 'a', '2026-10-02', 5), row('codex', 'a', '2026-10-01', 50), row('claude', 'a', '2026-10-01', 7)]

  it('groups by CLI (biggest first), model (per CLI) and day (in order)', () => {
    expect(groupUsage(rows, 'cliId').map((g) => [g.key, g.input])).toEqual([['codex', 50], ['claude', 12]])
    expect(groupUsage(rows, 'model').map((g) => splitModelKey(g.key))).toEqual([{ cliId: 'codex', model: 'a' }, { cliId: 'claude', model: 'a' }])
    expect(groupUsage(rows, 'day').map((g) => [g.key, totalTokens(g)])).toEqual([['2026-10-01', 57], ['2026-10-02', 5]])
    expect(groupUsage([], 'day')).toEqual([])
  })

  it('writes counts short', () => {
    expect([0, 950, 1000, 12_345, 1_500_000, 25_000_000, 3_200_000_000].map(compactTokens)).toEqual(['0', '950', '1k', '12k', '1.5M', '25M', '3.2B'])
  })
})

describe('usage from history files (ADR 0060)', () => {
  const home = mkdtempSync(join(tmpdir(), 'hv-usage-'))
  afterAll(() => rmSync(home, { recursive: true, force: true }))
  const now = new Date(2026, 9, 10, 15)

  it('reads Claude sessions and their subagents, skips old files and broken lines, and caches', async () => {
    const folder = join(home, '.claude', 'projects', 'C--work-app')
    mkdirSync(join(folder, 'session-1', 'subagents'), { recursive: true })
    const line = (id: string, day: number) => JSON.stringify({ type: 'assistant', timestamp: at(day), message: { id, model: 'claude-x', usage: { input_tokens: 1, output_tokens: 2 } } })
    writeFileSync(join(folder, 'session-1.jsonl'), [line('a', 9), '{broken', line('b', 10), ''].join('\n'))
    writeFileSync(join(folder, 'session-1', 'subagents', 'agent-1.jsonl'), line('c', 10))
    writeFileSync(join(folder, 'old.jsonl'), line('d', 1))
    const old = new Date(2026, 9, 1)
    utimesSync(join(folder, 'old.jsonl'), old, old)

    const service = new UsageService({ warn: () => undefined } as never, home, () => new Date(now))
    const week = await service.report(7)
    expect(week.since).toBe('2026-10-04')
    expect(week.sessions).toBe(2)
    expect(groupUsage(week.rows, 'day').map((g) => [g.key, g.replies])).toEqual([['2026-10-09', 1], ['2026-10-10', 2]])
    expect((await service.report(1)).rows.reduce((n, r) => n + r.replies, 0)).toBe(2)
  })

  it('is empty with no CLI history at all', async () => {
    const service = new UsageService({ warn: () => undefined } as never, join(home, 'nobody'), () => new Date(now))
    expect(await service.report(30)).toEqual({ since: '2026-09-11', rows: [], sessions: 0 })
  })
})
