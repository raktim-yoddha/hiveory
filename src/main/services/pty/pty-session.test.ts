import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PtyBackend } from './pty-backend'
import { PtySession } from './pty-session'

const fakeBackend = () => {
  const resizes: Array<[number, number]> = []
  const backend: PtyBackend = {
    spawn: () => ({
      onData: () => undefined,
      onExit: () => undefined,
      onError: () => undefined,
      write: () => undefined,
      resize: (cols, rows) => void resizes.push([cols, rows]),
      kill: () => undefined
    })
  }
  return { backend, resizes }
}

describe('PtySession resize pacing', () => {
  afterEach(() => vi.useRealTimers())

  it('collapses a burst into paced resizes that end on the last size', () => {
    vi.useFakeTimers()
    const { backend, resizes } = fakeBackend()
    const session = new PtySession(false, backend)
    session.start({ file: 'x', args: [], cwd: '.', env: {} })
    session.resize(80, 24) // spawns at this size
    for (let cols = 79; cols >= 50; cols--) {
      session.resize(cols, 24)
      vi.advanceTimersByTime(10)
    }
    vi.advanceTimersByTime(500)
    expect(resizes.at(-1)).toEqual([50, 24])
    // ~300ms of 10ms steps: a handful of resizes, never one per step.
    expect(resizes.length).toBeLessThanOrEqual(3)
    session.stop()
  })
})
