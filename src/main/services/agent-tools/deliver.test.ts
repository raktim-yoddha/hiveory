import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliInstance } from '@shared/domain'
import type { AgentService } from '../agents/agent-service'
import type { CliRuntimeManager } from '../cli/runtime/runtime-manager'
import { waitReady } from './deliver'

/** An idle, running terminal agent whose screen the test changes over time. */
const agentWith = (screenAt: (ms: number) => string) => {
  const start = Date.now()
  const agent = { id: 'a1', petName: 'Ada', chatUi: false } as CliInstance
  const deps = {
    agents: { details: () => ({ status: 'idle' as const, running: true }) } as unknown as AgentService,
    runtime: { screenText: () => screenAt(Date.now() - start) } as unknown as CliRuntimeManager
  }
  return { agent, deps }
}

describe('waitReady (Schedules and messages type into an agent once it is ready)', () => {
  afterEach(() => vi.useRealTimers())

  it('waits for two quiet seconds after the last change on screen, not after the agent opened', async () => {
    vi.useFakeTimers()
    // Idle from the start, but its start-up text appears at 3 s and its prompt at 3.5 s.
    const { agent, deps } = agentWith((ms) => (ms < 3000 ? '' : ms < 3500 ? 'Starting…' : 'Starting…\n> '))
    let readyAt = 0
    const started = Date.now()
    const ready = waitReady(deps, agent).then((r) => {
      readyAt = Date.now() - started
      return r
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await ready).toBe('ready')
    // Never typed into while it was still drawing: ready no sooner than 2 s after the prompt appeared.
    expect(readyAt).toBeGreaterThanOrEqual(5500)
    expect(readyAt).toBeLessThan(6500)
  })

  it('reads the whole screen: text only at the top of a fresh terminal counts', async () => {
    vi.useFakeTimers()
    const agent = { id: 'a1', petName: 'Ada', chatUi: false } as CliInstance
    // A 32-row screen with its text in the first two rows: its last rows are blank.
    const screen = ['Stand-in agent.', '> ', ...Array(30).fill('')]
    const deps = {
      agents: { details: () => ({ status: 'idle' as const, running: true }) } as unknown as AgentService,
      runtime: { screenText: (_id: string, lines: number) => screen.slice(-lines).join('\n').trimEnd() } as unknown as CliRuntimeManager
    }
    const ready = waitReady(deps, agent)
    await vi.advanceTimersByTimeAsync(6000)
    expect(await ready).toBe('ready')
  })

  it('an agent that keeps redrawing is never taken as ready, and times out', async () => {
    vi.useFakeTimers()
    const { agent, deps } = agentWith((ms) => `frame ${Math.floor(ms / 500)}`)
    const ready = waitReady(deps, agent, 20_000)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(await ready).toBe('timeout')
  })
})
