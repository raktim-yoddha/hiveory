import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PtyBackend } from './pty-backend'
import { FLOW_HIGH, FLOW_LOW, FLOW_STALL_MS, PtySession } from './pty-session'

const fakeBackend = () => {
  const resizes: Array<[number, number]> = []
  const backend: PtyBackend = {
    spawn: () => ({
      onData: () => undefined,
      onExit: () => undefined,
      onError: () => undefined,
      write: () => undefined,
      resize: (cols, rows) => void resizes.push([cols, rows]),
      kill: () => undefined,
      pause: () => undefined,
      resume: () => undefined
    })
  }
  return { backend, resizes }
}

/** A terminal the test prints into, recording when its program is made to wait and to carry on. */
const printingBackend = () => {
  const flow: string[] = []
  let print: (data: string) => void = () => undefined
  let exit: () => void = () => undefined
  const backend: PtyBackend = {
    spawn: () => ({
      onData: (l) => void (print = l),
      onExit: (l) => void (exit = () => l({ exitCode: 0, signal: null })),
      onError: () => undefined,
      write: () => undefined,
      resize: () => undefined,
      kill: () => undefined,
      pause: () => void flow.push('pause'),
      resume: () => void flow.push('resume')
    })
  }
  const session = new PtySession(false, backend)
  session.start({ file: 'x', args: [], cwd: '.', env: {} })
  session.resize(80, 24)
  /** Prints `chars` characters and lets them go out to the window. */
  const out = (chars: number): void => {
    print('x'.repeat(chars))
    vi.advanceTimersByTime(10)
  }
  return { session, flow, out, exit: () => exit() }
}

describe('PtySession flow control (ADR 0067)', () => {
  afterEach(() => vi.useRealTimers())

  it('never makes a program wait while no window draws its output', () => {
    vi.useFakeTimers()
    const { flow, out } = printingBackend()
    for (let i = 0; i < 50; i++) out(FLOW_HIGH)
    expect(flow).toEqual([])
  })

  it('makes the program wait once the window is far behind, and lets it carry on when the window has caught up', () => {
    vi.useFakeTimers()
    const { session, flow, out } = printingBackend()
    session.ack(1) // a window draws this terminal
    out(FLOW_HIGH)
    expect(flow).toEqual([])
    out(1)
    expect(flow).toEqual(['pause'])
    // Still far behind: it keeps waiting.
    session.ack(FLOW_HIGH / 2)
    expect(flow).toEqual(['pause'])
    session.ack(FLOW_HIGH / 2 - FLOW_LOW + 2)
    expect(flow).toEqual(['pause', 'resume'])
  })

  it('does not count what was printed before a window watched', () => {
    vi.useFakeTimers()
    const { session, flow, out } = printingBackend()
    out(FLOW_HIGH * 3)
    session.ack(5000)
    out(FLOW_HIGH)
    expect(flow).toEqual([])
  })

  it('lets the program carry on when the window stays silent, and waits again once the window answers', () => {
    vi.useFakeTimers()
    const { session, flow, out } = printingBackend()
    session.ack(1)
    out(FLOW_HIGH + 1)
    expect(flow).toEqual(['pause'])
    vi.advanceTimersByTime(FLOW_STALL_MS + 10)
    expect(flow).toEqual(['pause', 'resume'])
    // Nobody is drawing: it prints freely.
    out(FLOW_HIGH * 2)
    expect(flow).toEqual(['pause', 'resume'])
    session.ack(5000)
    out(FLOW_HIGH + 1)
    expect(flow).toEqual(['pause', 'resume', 'pause'])
  })

  it('a slow window that keeps answering is waited for', () => {
    vi.useFakeTimers()
    const { session, flow, out } = printingBackend()
    session.ack(1)
    out(FLOW_HIGH * 2)
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(FLOW_STALL_MS - 100)
      session.ack(5000)
    }
    expect(flow).toEqual(['pause'])
  })

  it('lets the program carry on when the window closes', () => {
    vi.useFakeTimers()
    const { session, flow, out } = printingBackend()
    session.ack(1)
    out(FLOW_HIGH + 1)
    session.unwatch()
    expect(flow).toEqual(['pause', 'resume'])
    out(FLOW_HIGH * 2)
    expect(flow).toEqual(['pause', 'resume'])
  })

  it('starts the next program with a clean count', () => {
    vi.useFakeTimers()
    const { session, flow, out, exit } = printingBackend()
    session.ack(1)
    out(FLOW_HIGH + 1)
    exit()
    session.start({ file: 'x', args: [], cwd: '.', env: {} })
    out(FLOW_HIGH)
    expect(flow).toEqual(['pause'])
    out(1)
    expect(flow).toEqual(['pause', 'pause'])
  })
})

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

describe("PtySession answers a program's questions while no window does (ADR 0070)", () => {
  /** A mirrored terminal whose program asks for the cursor position; what it is sent back is recorded. */
  const asking = () => {
    const sent: string[] = []
    let print: (data: string, replay?: boolean) => void = () => undefined
    const backend: PtyBackend = {
      spawn: () => ({
        onData: (l) => void (print = l),
        onExit: () => undefined,
        onError: () => undefined,
        write: (d) => void sent.push(d),
        resize: () => undefined,
        kill: () => undefined,
        pause: () => undefined,
        resume: () => undefined
      })
    }
    const session = new PtySession(true, backend)
    session.start({ file: 'x', args: [], cwd: '.', env: {} })
    session.resize(80, 24)
    /** Lets the copy of the screen parse what was printed. */
    const parsed = (): Promise<void> => new Promise((r) => setTimeout(r, 30))
    return { session, sent, print: (d: string, replay?: boolean) => print(d, replay), parsed }
  }

  it('answers while no window shows the terminal', async () => {
    const { sent, print, parsed } = asking()
    print('hi\x1b[6n')
    await parsed()
    expect(sent).toEqual(['\x1b[1;3R'])
  })

  it('leaves answering to the window that shows it, so the program never gets two answers', async () => {
    const { session, sent, print, parsed } = asking()
    session.setShown(true)
    print('\x1b[6n')
    await parsed()
    expect(sent).toEqual([])
    session.setShown(false)
    print('\x1b[6n')
    await parsed()
    expect(sent).toHaveLength(1)
  })

  it('leaves it to a paired desktop while one is connected', async () => {
    const { session, sent, print, parsed } = asking()
    session.answeredElsewhere = () => true
    print('\x1b[6n')
    await parsed()
    expect(sent).toEqual([])
  })

  it('never answers questions in output shown again (taken back, or restored from last time)', async () => {
    const { session, sent, print, parsed } = asking()
    print('old\x1b[6n', true)
    session.annotate('saved\x1b[6n')
    await parsed()
    expect(sent).toEqual([])
    print('\x1b[6n')
    await parsed()
    expect(sent).toHaveLength(1)
  })
})
