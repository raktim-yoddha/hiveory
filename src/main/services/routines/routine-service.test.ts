import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatAttachment } from '@shared/domain/chat'
import { MAX_ROUTINE_RUNS, type RoutineRun } from '@shared/domain/routine'
import { parseState } from '../persistence/schema'
import { StateStore } from '../persistence/state-store'
import { KEEP_AWAKE_LEAD_MS, KeepAwake, wantsAwake } from './keep-awake'
import { RoutineService, type RoutineDeps, type RoutineInput } from './routine-service'
import { runNotice } from './run-notice'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const HOUR = 60 * 60 * 1000
const T0 = Date.parse('2026-10-07T08:00:00.000Z')
const TARGET = { kind: 'workspace' as const, projectId: 'p1', workspaceId: 'w1', cliId: 'claude' }

/** Each run opens an agent that works until the test ends it (or it fails to start). */
const setup = (extra: Partial<RoutineDeps> = {}) => {
  const store = new StateStore(join(mkdtempSync(join(tmpdir(), 'hv-routines-')), 'state.json'), log)
  let clock = T0
  let n = 0
  const timers: Array<{ fn: () => void; at: number; live: boolean }> = []
  const activity: Array<[number, number | undefined]> = []
  const told: string[] = []
  const prompts: string[] = []
  const agents = new Map<string, (r: { ok: boolean; detail?: string }) => void>()
  let failStart = false
  const service = new RoutineService({
    store,
    log,
    emit: () => undefined,
    now: () => clock,
    timers: {
      set: (fn, ms) => {
        const t = { fn, at: clock + ms, live: true }
        timers.push(t)
        return t
      },
      clear: (t) => void ((t as { live: boolean }).live = false)
    },
    activity: (running, next) => activity.push([running, next]),
    outcome: (run) => told.push(`${run.routineName}:${run.status}`),
    targets: {
      describe: () => 'Claude Code in demo-app · main',
      workspace: (_t, prompt) => {
        if (failStart) throw new Error('That worktree no longer exists.')
        prompts.push(prompt)
        const agentId = `a${++n}`
        return { agentId, done: new Promise((r) => agents.set(agentId, r)) }
      }
    },
    ...extra
  })
  /** Moves the clock and fires every live timer that is due, the way setTimeout would. */
  const advance = (ms: number): void => {
    const until = clock + ms
    for (;;) {
      const next = timers.filter((t) => t.live && t.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      next.live = false
      clock = Math.max(clock, next.at)
      next.fn()
    }
    clock = until
  }
  /** The agent stops working; its run settles on the next microtask. */
  const end = async (agentId: string, ok = true, detail?: string): Promise<void> => {
    agents.get(agentId)!({ ok, ...(detail ? { detail } : {}) })
    await Promise.resolve()
    await Promise.resolve()
  }
  const daily9 = (over: Partial<RoutineInput> = {}): RoutineInput => ({
    name: 'Morning report',
    target: TARGET,
    prompt: 'Summarise the inbox.',
    schedule: { kind: 'cron', expr: '0 9 * * *', preset: 'daily' },
    startsAt: '2026-10-07T00:00:00.000Z',
    timezone: 'UTC',
    ...over
  })
  return {
    store,
    service,
    advance,
    end,
    daily9,
    activity,
    told,
    prompts,
    failStart: (on: boolean) => (failStart = on),
    setClock: (ms: number) => (clock = ms),
    runs: (): RoutineRun[] => service.runs()
  }
}

describe('routines', () => {
  it('runs a due routine on a fresh agent in its Worktree, then logs how it went', async () => {
    const { service, advance, end, daily9, runs, prompts } = setup()
    const routine = service.create(daily9())
    expect(routine.nextRunAt).toBe('2026-10-07T09:00:00.000Z')
    advance(HOUR)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('scheduled run of the schedule "Morning report"')
    expect(prompts[0]).toContain('Summarise the inbox.')
    expect(runs()[0]).toMatchObject({ status: 'running', trigger: 'schedule', scheduledFor: '2026-10-07T09:00:00.000Z', agentId: 'a1', where: 'Claude Code in demo-app · main' })
    await end('a1')
    expect(runs()[0]!.status).toBe('completed')
    advance(24 * HOUR)
    await end('a2', false, 'It stopped with an error.')
    expect(runs()[0]).toMatchObject({ status: 'failed', detail: 'It stopped with an error.' })
  })

  it('catches up one run missed less than 12 hours ago, and logs older ones as missed', async () => {
    const { service, end, daily9, setClock, runs, prompts } = setup()
    service.create(daily9())
    setClock(T0 + 5 * HOUR) // 13:00: the 09:00 run was missed while asleep
    service.tick()
    expect(prompts).toHaveLength(1)
    expect(runs()[0]!.scheduledFor).toBe('2026-10-07T09:00:00.000Z')
    await end('a1')
    setClock(T0 + 3 * 24 * HOUR + 10 * HOUR) // three days later at 18:00: only the latest counts, and it is 9 h old
    service.tick()
    expect(prompts).toHaveLength(2)
    expect(runs()[0]!.scheduledFor).toBe('2026-10-10T09:00:00.000Z')
    await end('a2')
    setClock(T0 + 5 * 24 * HOUR + 14 * HOUR) // 22:00 on the 12th, 13 hours after its 09:00 run
    service.tick()
    expect(prompts).toHaveLength(2)
    expect(runs()[0]).toMatchObject({ status: 'missed', scheduledFor: '2026-10-12T09:00:00.000Z' })
  })

  it('never overlaps itself: a run due while the last one is going is skipped', () => {
    const { service, advance, runs, prompts } = setup()
    service.create({ name: 'Watch', target: TARGET, prompt: 'Check.', schedule: { kind: 'interval', everyMinutes: 30 }, startsAt: '2026-10-07T08:30:00.000Z', timezone: 'UTC' })
    advance(30 * 60 * 1000)
    advance(30 * 60 * 1000)
    expect(prompts).toHaveLength(1)
    expect(runs().map((r) => r.status)).toEqual(['skipped', 'running'])
  })

  it('runs "once" a single time, then switches itself off; Run now works while paused', () => {
    const { service, advance, prompts } = setup()
    const r = service.create({ name: 'Once', target: TARGET, prompt: 'Go.', schedule: { kind: 'once' }, startsAt: '2026-10-07T08:10:00.000Z', timezone: 'UTC' })
    advance(HOUR)
    expect(prompts).toHaveLength(1)
    expect(service.get(r.id).enabled).toBe(false)
    expect(() => service.create({ name: 'Past', target: TARGET, prompt: 'Go.', schedule: { kind: 'once' }, startsAt: '2026-10-07T07:00:00.000Z', timezone: 'UTC' })).toThrow(
      'future'
    )
    const paused = service.create({ name: 'Later', target: TARGET, prompt: 'Go.', schedule: { kind: 'once' }, startsAt: '2026-10-08T08:10:00.000Z', timezone: 'UTC', enabled: false })
    expect(service.runNow(paused.id)).toMatchObject({ status: 'running', trigger: 'manual' })
  })

  it('stops a run at its time limit once, even when the agent finishes later, and reports one that could not start', async () => {
    const { service, advance, end, daily9, runs, failStart } = setup()
    service.create(daily9({ timeoutMinutes: 10 }))
    advance(HOUR)
    advance(10 * 60 * 1000)
    expect(runs()[0]).toMatchObject({ status: 'failed' })
    expect(runs()[0]!.detail).toBe('Stopped after 10 minutes, its time limit. The agent is still open in Work.')
    await end('a1')
    expect(runs()[0]!.status).toBe('failed')
    failStart(true)
    advance(24 * HOUR)
    expect(runs()[0]!.detail).toContain('could not start: That worktree no longer exists.')
  })

  it('ends runs a closed app left going, and keeps the run log bounded', () => {
    const { store, service, daily9 } = setup()
    const r = service.create(daily9())
    store.update((s) => {
      s.routineRuns = Array.from({ length: MAX_ROUTINE_RUNS }, (_, i) => ({
        id: `r${i}`,
        routineId: r.id,
        routineName: r.name,
        trigger: 'schedule' as const,
        prompt: 'x',
        scheduledFor: '2026-10-06T09:00:00.000Z',
        status: i === 0 ? ('running' as const) : ('completed' as const)
      }))
    })
    service.start()
    expect(service.runs()[0]).toMatchObject({ status: 'failed', detail: 'Hiveory closed while it ran.' })
    service.runNow(r.id)
    expect(service.runs()).toHaveLength(MAX_ROUTINE_RUNS)
  })

  it('rejects a bad timezone or cron rule, and starts a changed schedule from now', () => {
    const { service, daily9, setClock, prompts } = setup()
    expect(() => service.create(daily9({ timezone: 'Mars/Base' }))).toThrow('timezone')
    expect(() => service.create(daily9({ schedule: { kind: 'cron', expr: '0 0 9 * * *', preset: 'custom' } }))).toThrow('five fields')
    const r = service.create(daily9({ enabled: false }))
    setClock(T0 + 3 * HOUR)
    service.update(r.id, { enabled: true })
    service.tick()
    expect(prompts).toHaveLength(0)
    service.delete(r.id)
    expect(service.list()).toEqual([])
  })

  it('tells keep-awake when runs are going and when the next is due', async () => {
    const { service, advance, end, daily9, activity } = setup()
    service.create(daily9())
    expect(activity.at(-1)).toEqual([0, Date.parse('2026-10-07T09:00:00.000Z')])
    advance(HOUR)
    expect(activity.at(-1)![0]).toBe(1)
    await end('a1')
    expect(activity.at(-1)).toEqual([0, Date.parse('2026-10-08T09:00:00.000Z')])
  })

  it('announces runs that end or are missed, never skipped ones', async () => {
    const { service, advance, end, daily9, setClock, told } = setup()
    service.create(daily9())
    advance(HOUR)
    await end('a1')
    service.create({ name: 'Watch', target: TARGET, prompt: 'Check.', schedule: { kind: 'interval', everyMinutes: 30 }, startsAt: '2026-10-07T09:30:00.000Z', timezone: 'UTC' })
    advance(60 * 60 * 1000) // Watch runs at 09:30, then 10:00 is skipped while it is still going
    setClock(T0 + 3 * 24 * HOUR)
    service.tick()
    expect(told).toContain('Morning report:completed')
    expect(told).toContain('Morning report:missed')
    expect(told.some((t) => t.endsWith(':skipped'))).toBe(false)
  })

  it('words notifications plainly', () => {
    const run = { id: 'r', routineId: 'x', routineName: 'Morning report', where: 'Claude Code in demo-app · main', trigger: 'schedule' as const, prompt: '', scheduledFor: '' }
    expect(runNotice({ ...run, status: 'completed' })).toEqual({ title: 'Morning report is done', body: 'Claude Code in demo-app · main finished this run.' })
    expect(runNotice({ ...run, status: 'failed', detail: 'Rate limited.' }).title).toBe('Morning report failed')
    expect(runNotice({ ...run, status: 'failed', detail: 'x'.repeat(500) }).body).toHaveLength(140)
  })
})

describe('saved routines', () => {
  it('drops a broken routine and those of removed modes, keeps the good ones, and bounds the run log', () => {
    const good = {
      id: 'r1',
      name: 'Report',
      target: TARGET,
      prompt: 'Go.',
      schedule: { kind: 'cron', expr: '0 9 * * *', preset: 'daily' },
      startsAt: '2026-10-07T00:00:00.000Z',
      timezone: 'UTC',
      enabled: true,
      checkedThrough: '2026-10-07T00:00:00.000Z',
      createdAt: '',
      updatedAt: ''
    }
    const run = { id: 'x', routineId: 'r1', routineName: 'Report', agentId: 'a1', trigger: 'schedule', prompt: 'Go.', scheduledFor: '', status: 'completed' }
    const { state, rejected } = parseState({
      routines: [
        good,
        { ...good, id: 'r2', schedule: { kind: 'interval', everyMinutes: 1 } },
        // A bot's routine and a scheduled chat (ADR 0056): gone without a warning.
        { ...good, id: 'r3', target: undefined, botId: 'b1' },
        { ...good, id: 'r4', target: { kind: 'chat', cliId: 'codex' } }
      ],
      routineRuns: [
        { ...run, id: 'bot', botId: 'b1', threadId: 't1' },
        { ...run, id: 'event', trigger: 'event' },
        ...Array.from({ length: MAX_ROUTINE_RUNS + 5 }, (_, i) => ({ ...run, id: `x${i}` }))
      ]
    })
    expect(state.routines.map((r) => r.id)).toEqual(['r1'])
    expect(rejected).toBe(1)
    expect(state.routineRuns).toHaveLength(MAX_ROUTINE_RUNS)
    expect(state.routineRuns.some((r) => r.id === 'bot' || r.id === 'event')).toBe(false)
  })
})

describe('keep awake', () => {
  it('holds the computer awake on mains power, in the hour before a run and while one runs', () => {
    const base = { enabled: true, onBattery: false, running: 0 }
    expect(wantsAwake({ ...base, untilNextMs: KEEP_AWAKE_LEAD_MS })).toBe(true)
    expect(wantsAwake({ ...base, untilNextMs: KEEP_AWAKE_LEAD_MS + 1 })).toBe(false)
    expect(wantsAwake({ ...base, running: 1 })).toBe(true)
    expect(wantsAwake({ ...base, running: 1, onBattery: true })).toBe(false)
    expect(wantsAwake({ ...base, running: 1, enabled: false })).toBe(false)
  })

  it('takes one blocker and gives it back', () => {
    const calls: string[] = []
    const awake = new KeepAwake({ start: () => (calls.push('start'), 7), stop: (id) => void calls.push(`stop ${id}`) })
    awake.set(true)
    awake.set(true)
    awake.set(false)
    awake.set(false)
    expect(calls).toEqual(['start', 'stop 7'])
  })
})

describe("a routine's files (ADR 0030)", () => {
  const file = (path: string): ChatAttachment => ({ name: path.split('/').pop()!, path, kind: 'file', size: 1 })
  const withFiles = () => {
    const removed: string[] = []
    const ctx = setup({ files: { owns: (p) => p.startsWith('/data/routine-files/'), remove: (paths) => void removed.push(...paths) } })
    return { ...ctx, removed }
  }

  it('lists its copies for the agent on every run', () => {
    const { service, advance, daily9, prompts } = withFiles()
    service.create(daily9({ attachments: [file('/data/routine-files/a-report.csv')] }))
    advance(HOUR)
    expect(prompts[0]).toContain('Files for this run:\n- /data/routine-files/a-report.csv')
  })

  it('refuses any other path, and deletes copies it no longer uses', () => {
    const { service, daily9, removed } = withFiles()
    expect(() => service.create(daily9({ attachments: [file('C:/Users/me/secret.txt')] }))).toThrow('Add the files again.')
    const routine = service.create(daily9({ attachments: [file('/data/routine-files/a.csv'), file('/data/routine-files/b.csv')] }))
    service.update(routine.id, { attachments: [file('/data/routine-files/b.csv')] })
    expect(removed).toEqual(['/data/routine-files/a.csv'])
    service.delete(routine.id)
    expect(removed).toEqual(['/data/routine-files/a.csv', '/data/routine-files/b.csv'])
  })
})
