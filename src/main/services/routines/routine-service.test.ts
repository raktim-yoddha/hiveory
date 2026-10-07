import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Bot } from '@shared/domain/bot'
import type { ChatSession } from '@shared/domain/chat'
import { MAX_ROUTINE_RUNS, type RoutineRun } from '@shared/domain/routine'
import { parseState } from '../persistence/schema'
import { StateStore } from '../persistence/state-store'
import { KEEP_AWAKE_LEAD_MS, KeepAwake, wantsAwake } from './keep-awake'
import { RoutineService, type RoutineInput } from './routine-service'
import { RoutineTools } from './routine-tools'
import { runNotice } from './run-notice'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const HOUR = 60 * 60 * 1000
const T0 = Date.parse('2026-10-07T08:00:00.000Z')

/** Threads in memory; a turn runs until the test ends it (optionally with an error). */
class FakeChats extends EventEmitter<{ run: [chatId: string, running: boolean] }> {
  readonly sessions = new Map<string, ChatSession>()
  readonly sent: Array<{ chatId: string; text: string }> = []
  readonly stopped: string[] = []
  failSend = false
  send(chatId: string, text: string): void {
    if (this.failSend) throw new Error('Choose a CLI first.')
    this.sent.push({ chatId, text })
    this.emit('run', chatId, true)
  }
  stop(chatId: string): void {
    this.stopped.push(chatId)
    this.emit('run', chatId, false)
  }
  readonly notes: Array<{ chatId: string; text: string }> = []
  find(chatId: string): ChatSession | undefined {
    return this.sessions.get(chatId)
  }
  note(chatId: string, text: string): void {
    this.notes.push({ chatId, text })
  }
  lastReply(chatId: string): string {
    const last = [...this.sessions.get(chatId)!.messages].reverse()[0] as unknown as { parts: Array<{ text: string }> } | undefined
    return last?.parts.map((p) => p.text).join('\n') ?? ''
  }
  end(chatId: string, error?: string, reply = 'Done.'): void {
    const chat = this.sessions.get(chatId)!
    chat.messages.push({ role: 'assistant', parts: [{ kind: 'text', text: reply }], ...(error ? { error } : {}) } as unknown as ChatSession['messages'][number])
    this.emit('run', chatId, false)
  }
}

const setup = (bots: Array<Partial<Bot> & { id: string }> = [{ id: 'b1', name: 'Scout', routines: true }]) => {
  const store = new StateStore(join(mkdtempSync(join(tmpdir(), 'hv-routines-')), 'state.json'), log)
  const chats = new FakeChats()
  let clock = T0
  let n = 0
  const timers: Array<{ fn: () => void; at: number; live: boolean }> = []
  const activity: Array<[number, number | undefined]> = []
  const told: string[] = []
  const service = new RoutineService({
    store,
    chats,
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
    bots: {
      find: (id) => bots.find((b) => b.id === id) as Bot | undefined,
      newThread: (botId, title) => {
        const chat = { id: `t${++n}`, botId, title: title ?? '', messages: [] } as unknown as ChatSession
        chats.sessions.set(chat.id, chat)
        return chat
      }
    }
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
  const daily9 = (over: Partial<RoutineInput> = {}): RoutineInput => ({
    name: 'Morning report',
    botId: 'b1',
    prompt: 'Summarise the inbox.',
    schedule: { kind: 'cron', expr: '0 9 * * *', preset: 'daily' },
    startsAt: '2026-10-07T00:00:00.000Z',
    timezone: 'UTC',
    ...over
  })
  return { store, chats, service, advance, daily9, activity, told, setClock: (ms: number) => (clock = ms), runs: (): RoutineRun[] => service.runs() }
}

describe('routines', () => {
  it('runs a due routine in a fresh bot thread, then logs how it went', () => {
    const { service, chats, advance, daily9, runs } = setup()
    const routine = service.create(daily9())
    expect(routine.nextRunAt).toBe('2026-10-07T09:00:00.000Z')
    advance(HOUR)
    expect(chats.sent).toHaveLength(1)
    expect(chats.sent[0]!.text).toContain('scheduled run of your routine "Morning report"')
    expect(chats.sent[0]!.text).toContain('Summarise the inbox.')
    expect(runs()[0]).toMatchObject({ status: 'running', trigger: 'schedule', scheduledFor: '2026-10-07T09:00:00.000Z', threadId: 't1' })
    chats.end('t1')
    expect(runs()[0]!.status).toBe('completed')
    advance(24 * HOUR)
    expect(chats.sent).toHaveLength(2)
    chats.end('t3', 'Rate limited.') // t2 is the results thread
    expect(runs()[0]).toMatchObject({ status: 'failed', detail: 'Rate limited.' })
  })

  it('posts each finished run into one results thread, or nowhere when asked', () => {
    const { service, chats, advance, daily9 } = setup()
    const r = service.create(daily9())
    advance(HOUR)
    chats.end('t1', undefined, 'Inbox: 3 new, 1 urgent.')
    expect(service.get(r.id).resultsThreadId).toBe('t2')
    expect(chats.sessions.get('t2')!.title).toBe('Morning report · results')
    expect(chats.notes).toEqual([{ chatId: 't2', text: '**Morning report** · Wed, Oct 7, 09:00\n\nInbox: 3 new, 1 urgent.' }])
    advance(24 * HOUR)
    chats.end('t3', 'Rate limited.')
    expect(chats.notes[1]).toMatchObject({ chatId: 't2' })
    expect(chats.notes[1]!.text).toContain('It failed: Rate limited.')
    service.update(r.id, { results: 'none' })
    advance(24 * HOUR)
    chats.end('t4')
    expect(chats.notes).toHaveLength(2)
  })

  it('catches up one run missed less than 12 hours ago, and logs older ones as missed', () => {
    const { service, chats, daily9, setClock, runs } = setup()
    service.create(daily9())
    setClock(T0 + 5 * HOUR) // 13:00: the 09:00 run was missed while asleep
    service.tick()
    expect(chats.sent).toHaveLength(1)
    expect(runs()[0]!.scheduledFor).toBe('2026-10-07T09:00:00.000Z')
    chats.end('t1')
    setClock(T0 + 3 * 24 * HOUR + 10 * HOUR) // three days later at 18:00: only the latest counts, and it is 9 h old
    service.tick()
    expect(chats.sent).toHaveLength(2)
    expect(runs()[0]!.scheduledFor).toBe('2026-10-10T09:00:00.000Z')
    chats.end('t2')
    setClock(T0 + 5 * 24 * HOUR + 14 * HOUR) // 22:00 on the 12th, 13 hours after its 09:00 run
    service.tick()
    expect(chats.sent).toHaveLength(2)
    expect(runs()[0]).toMatchObject({ status: 'missed', scheduledFor: '2026-10-12T09:00:00.000Z' })
  })

  it('never overlaps itself: a run due while the last one is going is skipped', () => {
    const { service, chats, advance, runs } = setup()
    service.create({ name: 'Watch', botId: 'b1', prompt: 'Check.', schedule: { kind: 'interval', everyMinutes: 30 }, startsAt: '2026-10-07T08:30:00.000Z', timezone: 'UTC' })
    advance(30 * 60 * 1000)
    advance(30 * 60 * 1000)
    expect(chats.sent).toHaveLength(1)
    expect(runs().map((r) => r.status)).toEqual(['skipped', 'running'])
  })

  it('runs "once" a single time, then switches itself off', () => {
    const { service, chats, advance } = setup()
    const r = service.create({ name: 'Once', botId: 'b1', prompt: 'Go.', schedule: { kind: 'once' }, startsAt: '2026-10-07T08:10:00.000Z', timezone: 'UTC' })
    advance(HOUR)
    expect(chats.sent).toHaveLength(1)
    expect(service.get(r.id).enabled).toBe(false)
    expect(() => service.create({ name: 'Past', botId: 'b1', prompt: 'Go.', schedule: { kind: 'once' }, startsAt: '2026-10-07T07:00:00.000Z', timezone: 'UTC' })).toThrow(
      'future'
    )
  })

  it('needs the bot to allow schedules, and skips scheduled runs once it no longer does', () => {
    const bots = [{ id: 'b1', name: 'Scout', routines: true }]
    const { service, chats, advance, daily9, runs } = setup(bots)
    const r = service.create(daily9())
    bots[0]!.routines = false
    advance(HOUR)
    expect(chats.sent).toHaveLength(0)
    expect(runs()[0]).toMatchObject({ status: 'skipped' })
    expect(runs()[0]!.detail).toContain('no longer runs on a schedule')
    // "Run now" is the user's own action: it still works.
    expect(service.runNow(r.id)).toMatchObject({ status: 'running', trigger: 'manual' })
    expect(() => service.create(daily9())).toThrow('Allow Scout')
  })

  it('stops a run at its time limit, and reports a bot that could not start', () => {
    const { service, chats, advance, daily9, runs } = setup()
    service.create(daily9({ timeoutMinutes: 10 }))
    advance(HOUR)
    advance(10 * 60 * 1000)
    expect(chats.stopped).toEqual(['t1'])
    expect(runs()[0]).toMatchObject({ status: 'failed', detail: 'Stopped after 10 minutes, its time limit.' })
    chats.failSend = true
    advance(24 * HOUR)
    expect(runs()[0]).toMatchObject({ status: 'failed', threadId: 't3' }) // t2 holds the first run's result
    expect(runs()[0]!.detail).toContain('could not start: Choose a CLI first.')
  })

  it('ends runs a closed app left going, and keeps the run log bounded', () => {
    const { store, service, daily9 } = setup()
    const r = service.create(daily9())
    store.update((s) => {
      s.routineRuns = Array.from({ length: MAX_ROUTINE_RUNS }, (_, i) => ({
        id: `r${i}`,
        routineId: r.id,
        routineName: r.name,
        botId: 'b1',
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

  it('rejects a bad timezone or cron rule, starts a changed schedule from now, and goes with its bot', () => {
    const { service, chats, daily9, setClock } = setup()
    expect(() => service.create(daily9({ timezone: 'Mars/Base' }))).toThrow('timezone')
    expect(() => service.create(daily9({ schedule: { kind: 'cron', expr: '0 0 9 * * *', preset: 'custom' } }))).toThrow('five fields')
    const r = service.create(daily9({ enabled: false }))
    setClock(T0 + 3 * HOUR)
    service.update(r.id, { enabled: true })
    service.tick()
    expect(chats.sent).toHaveLength(0)
    service.removeForBot('b1')
    expect(service.list()).toEqual([])
  })

  it('tells keep-awake when runs are going and when the next is due', () => {
    const { service, chats, advance, daily9, activity } = setup()
    service.create(daily9())
    expect(activity.at(-1)).toEqual([0, Date.parse('2026-10-07T09:00:00.000Z')])
    advance(HOUR)
    expect(activity.at(-1)![0]).toBe(1)
    chats.end('t1')
    expect(activity.at(-1)).toEqual([0, Date.parse('2026-10-08T09:00:00.000Z')])
  })
})

describe('saved routines', () => {
  it('drops a broken routine, keeps the good ones, and bounds the run log', () => {
    const good = {
      id: 'r1',
      name: 'Report',
      botId: 'b1',
      prompt: 'Go.',
      schedule: { kind: 'cron', expr: '0 9 * * *', preset: 'daily' },
      startsAt: '2026-10-07T00:00:00.000Z',
      timezone: 'UTC',
      enabled: true,
      checkedThrough: '2026-10-07T00:00:00.000Z',
      createdAt: '',
      updatedAt: ''
    }
    const run = { id: 'x', routineId: 'r1', routineName: 'Report', botId: 'b1', trigger: 'schedule', prompt: 'Go.', scheduledFor: '', status: 'completed' }
    const { state, rejected } = parseState({
      routines: [good, { ...good, id: 'r2', schedule: { kind: 'interval', everyMinutes: 1 } }],
      routineRuns: Array.from({ length: MAX_ROUTINE_RUNS + 5 }, (_, i) => ({ ...run, id: `x${i}` }))
    })
    expect(state.routines.map((r) => r.id)).toEqual(['r1'])
    expect(rejected).toBe(1)
    expect(state.routineRuns).toHaveLength(MAX_ROUTINE_RUNS)
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

describe('bots and their routines', () => {
  const withTools = (bots?: Array<Partial<Bot> & { id: string }>) => {
    const s = setup(bots)
    const tools = new RoutineTools(() => s.service, (chatId) => (chatId === 'c1' ? 'b1' : undefined), () => 'Asia/Kolkata', () => T0)
    const call = (name: string, args: Record<string, unknown> = {}) => tools.call({ id: 'c1' }, name, args)
    return { ...s, tools, call }
  }

  it('lets a bot save a routine, always paused, in its own words and zone', async () => {
    const { service, call } = withTools()
    const result = await call('schedule_routine', {
      name: 'Morning report',
      instructions: 'Summarise the inbox.',
      first_run: '2026-10-08T09:00:00+05:30',
      repeat: 'weekdays'
    })
    expect(result.text).toContain('paused')
    expect(result.text).toContain('Thu, Oct 8, 09:00')
    expect(service.list('b1')).toMatchObject([
      { name: 'Morning report', enabled: false, timezone: 'Asia/Kolkata', schedule: { kind: 'cron', expr: '0 9 * * 1-5', preset: 'weekdays' } }
    ])
    expect((await call('list_routines')).text).toContain('Morning report · paused')
  })

  it('tells the bot what to fix instead of saving something wrong', async () => {
    const { call } = withTools()
    const base = { name: 'X', instructions: 'Go.', first_run: '2026-10-08T09:00:00Z' }
    await expect(call('schedule_routine', { ...base, first_run: '2026-10-01T09:00:00Z', repeat: 'once' })).rejects.toThrow('already passed')
    await expect(call('schedule_routine', { ...base, repeat: 'daily', timezone: 'Mars/Base' })).rejects.toThrow('Unknown timezone')
    await expect(call('schedule_routine', { ...base, repeat: 'selected-days' })).rejects.toThrow('needs days')
    await expect(call('schedule_routine', { ...base, repeat: 'cron', cron: '@daily' })).rejects.toThrow('five fields')
    await expect(call('schedule_routine', { ...base, first_run: 'tomorrow', repeat: 'daily' })).rejects.toThrow('ISO 8601')
  })

  it('refuses a bot that may not run on a schedule, and anyone who is not a bot', async () => {
    const { call, tools } = withTools([{ id: 'b1', name: 'Scout', routines: false }])
    await expect(call('schedule_routine', { name: 'X', instructions: 'Go.', first_run: '2026-10-08T09:00:00Z', repeat: 'daily' })).rejects.toThrow('Allow Scout')
    expect(await tools.call({ id: 'someone-else' }, 'list_routines', {})).toMatchObject({ isError: true })
  })

  it('announces runs that end or are missed, never skipped ones', () => {
    const { service, chats, advance, daily9, setClock, told } = setup()
    service.create(daily9())
    advance(HOUR)
    chats.end('t1')
    service.create({ name: 'Watch', botId: 'b1', prompt: 'Check.', schedule: { kind: 'interval', everyMinutes: 30 }, startsAt: '2026-10-07T09:30:00.000Z', timezone: 'UTC' })
    advance(60 * 60 * 1000) // Watch runs at 09:30, then 10:00 is skipped while it is still going
    setClock(T0 + 3 * 24 * HOUR)
    service.tick()
    expect(told).toContain('Morning report:completed')
    expect(told).toContain('Morning report:missed')
    expect(told.some((t) => t.endsWith(':skipped'))).toBe(false)
  })

  it('words notifications plainly', () => {
    const run = { id: 'r', routineId: 'x', routineName: 'Morning report', botId: 'b', trigger: 'schedule' as const, prompt: '', scheduledFor: '' }
    expect(runNotice({ ...run, status: 'completed' }, 'Scout')).toEqual({ title: 'Morning report is done', body: 'Scout finished this run. Its report is in the thread.' })
    expect(runNotice({ ...run, status: 'failed', detail: 'Rate limited.' }).title).toBe('Morning report failed')
    expect(runNotice({ ...run, status: 'failed', detail: 'x'.repeat(500) }).body).toHaveLength(140)
  })
})
