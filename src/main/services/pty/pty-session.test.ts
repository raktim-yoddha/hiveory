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

  it("a watching phone's size wins until it stops; the desktop's size comes back (ADR 0048)", () => {
    const { backend } = fakeBackend()
    const session = new PtySession(false, backend)
    session.start({ file: 'x', args: [], cwd: '.', env: {} })
    session.resize(120, 30)
    session.fitViewer('phone', { cols: 40, rows: 20 })
    session.resize(130, 32) // the desktop window changed meanwhile: remembered, not applied
    expect(session.snapshot()).toMatchObject({ cols: 40, rows: 20 })
    session.fitViewer('phone', null)
    expect(session.snapshot()).toMatchObject({ cols: 130, rows: 32 })
    session.stop()
  })
})
