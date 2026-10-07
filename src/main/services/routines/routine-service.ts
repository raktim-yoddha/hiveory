import { randomUUID } from 'node:crypto'
import type { Bot } from '@shared/domain/bot'
import type { ChatSession } from '@shared/domain/chat'
import {
  CATCH_UP_MS,
  MAX_ROUTINE_RUNS,
  MAX_ROUTINES_PER_BOT,
  type Routine,
  type RoutineRun,
  type RoutineView,
  type RunTrigger
} from '@shared/domain/routine'
import { cronProblem, latestRun, nextRuns, validTimezone } from '@shared/domain/routine-schedule'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import type { Emit } from '../events'
import type { StateStore } from '../persistence/state-store'

export type RoutineInput = Pick<Routine, 'name' | 'botId' | 'prompt' | 'schedule' | 'startsAt' | 'timezone'> &
  Partial<Pick<Routine, 'endsAt' | 'timeoutMinutes' | 'enabled'>>
export type RoutinePatch = Partial<Omit<RoutineInput, 'endsAt' | 'timeoutMinutes'>> & { endsAt?: string | null; timeoutMinutes?: number | null }

interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface RoutineDeps {
  store: StateStore
  bots: { find(botId: string): Bot | undefined; newThread(botId: string, title?: string): ChatSession }
  chats: {
    send(chatId: string, text: string): void
    stop(chatId: string): void
    find(chatId: string): ChatSession | undefined
    on(event: 'run', listener: (chatId: string, running: boolean) => void): unknown
  }
  emit: Emit
  log: Logger
  /** Told after every change: how many runs are going, and when the next one is due (keep-awake). */
  activity?: (running: number, nextDueAt: number | undefined) => void
  now?: () => number
  timers?: Timers
}

/** The scheduler sleeps at most this long, so sleep, clock changes and a slow timer cost minutes, not hours. */
const MAX_SLEEP_MS = 5 * 60 * 1000

const iso = (ms: number): string => new Date(ms).toISOString()
const timingChanged = (patch: RoutinePatch): boolean =>
  patch.schedule !== undefined || patch.startsAt !== undefined || patch.timezone !== undefined || patch.endsAt !== undefined || patch.enabled === true

/**
 * Routines (ADR 0028): a bot's scheduled work. One timer, armed for the next due run (never a polling
 * loop), runs each one in a fresh thread on the bot. A run missed while Hiveory was closed or asleep
 * still happens when it is back within 12 hours; older ones are logged as missed, and a series never
 * replays every occurrence it slept through. A run never overlaps the previous one of the same routine.
 */
export class RoutineService {
  private timer: unknown = null
  /** A run's time limit, by run id. */
  private readonly limits = new Map<string, unknown>()
  private readonly now: () => number
  private readonly timers: Timers

  constructor(private readonly d: RoutineDeps) {
    this.now = d.now ?? Date.now
    this.timers = d.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
    d.chats.on('run', (chatId, running) => {
      if (!running) this.onTurnEnd(chatId)
    })
  }

  /** After the state loads: runs a previous session left going ended with it, then the schedule starts. */
  start(): void {
    const stale = this.d.store.state.routineRuns.some((r) => r.status === 'running')
    if (stale) {
      this.d.store.update((s) => {
        for (const r of s.routineRuns) if (r.status === 'running') Object.assign(r, { status: 'failed', endedAt: iso(this.now()), detail: 'Hiveory closed while it ran.' })
      })
      this.changed()
    }
    this.tick()
  }

  dispose(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
    for (const handle of this.limits.values()) this.timers.clear(handle)
    this.limits.clear()
    this.d.activity?.(0, undefined)
  }

  list(botId?: string): RoutineView[] {
    const at = new Date(this.now())
    return this.d.store.state.routines
      .filter((r) => !botId || r.botId === botId)
      .map((r) => {
        const next = r.enabled ? nextRuns(r, at, 1)[0] : undefined
        const lastRun = this.d.store.state.routineRuns.find((run) => run.routineId === r.id)
        return { ...r, ...(next ? { nextRunAt: next.toISOString() } : {}), ...(lastRun ? { lastRun } : {}) }
      })
  }

  get(routineId: string): Routine {
    return this.d.store.state.routines.find((r) => r.id === routineId) ?? fail('NOT_FOUND', 'Routine not found.')
  }

  runs(filter: { botId?: string; routineId?: string } = {}): RoutineRun[] {
    return this.d.store.state.routineRuns.filter((r) => (!filter.botId || r.botId === filter.botId) && (!filter.routineId || r.routineId === filter.routineId))
  }

  create(input: RoutineInput): RoutineView {
    const bot = this.d.bots.find(input.botId) ?? fail('NOT_FOUND', 'Bot not found.')
    if (!bot.routines) fail('INVALID_INPUT', `Allow ${bot.name} to run on a schedule first.`)
    if (this.d.store.state.routines.filter((r) => r.botId === bot.id).length >= MAX_ROUTINES_PER_BOT) {
      fail('INVALID_INPUT', `${bot.name} already has ${MAX_ROUTINES_PER_BOT} routines. Remove one first.`)
    }
    const now = iso(this.now())
    const routine: Routine = {
      id: randomUUID(),
      name: input.name.trim(),
      botId: bot.id,
      prompt: input.prompt.trim(),
      schedule: input.schedule,
      startsAt: input.startsAt,
      timezone: input.timezone,
      ...(input.endsAt ? { endsAt: input.endsAt } : {}),
      ...(input.timeoutMinutes ? { timeoutMinutes: input.timeoutMinutes } : {}),
      enabled: input.enabled ?? true,
      checkedThrough: now,
      createdAt: now,
      updatedAt: now
    }
    this.check(routine)
    this.d.store.update((s) => {
      s.routines.push(routine)
    })
    this.changed()
    return this.view(routine.id)
  }

  update(routineId: string, patch: RoutinePatch): RoutineView {
    const current = this.get(routineId)
    const next: Routine = { ...current, ...patch, endsAt: undefined, timeoutMinutes: undefined } as Routine
    const endsAt = patch.endsAt === undefined ? current.endsAt : patch.endsAt
    const timeoutMinutes = patch.timeoutMinutes === undefined ? current.timeoutMinutes : patch.timeoutMinutes
    if (endsAt) next.endsAt = endsAt
    else delete next.endsAt
    if (timeoutMinutes) next.timeoutMinutes = timeoutMinutes
    else delete next.timeoutMinutes
    if (patch.botId && patch.botId !== current.botId) {
      const bot = this.d.bots.find(patch.botId) ?? fail('NOT_FOUND', 'Bot not found.')
      if (!bot.routines) fail('INVALID_INPUT', `Allow ${bot.name} to run on a schedule first.`)
    }
    const now = iso(this.now())
    // A new time (or switching it back on) starts from now: it never fires for times already past.
    if (timingChanged(patch)) next.checkedThrough = now
    next.name = next.name.trim()
    next.prompt = next.prompt.trim()
    next.updatedAt = now
    if (timingChanged(patch)) this.check(next)
    this.d.store.update((s) => {
      s.routines = s.routines.map((r) => (r.id === routineId ? next : r))
    })
    this.changed()
    return this.view(routineId)
  }

  /** Removes the routine; its run log stays, and a run going now finishes. */
  delete(routineId: string): void {
    this.get(routineId)
    this.d.store.update((s) => {
      s.routines = s.routines.filter((r) => r.id !== routineId)
    })
    this.changed()
  }

  /** A deleted bot takes its routines with it. */
  removeForBot(botId: string): void {
    if (!this.d.store.state.routines.some((r) => r.botId === botId)) return
    this.d.store.update((s) => {
      s.routines = s.routines.filter((r) => r.botId !== botId)
    })
    this.changed()
  }

  /** The user's "Run now": works even while the routine is paused. */
  runNow(routineId: string): RoutineRun {
    const run = this.dispatch(this.get(routineId), this.now(), 'manual')
    this.changed()
    return run
  }

  /** Runs what is due, logs what was missed, and arms the timer for the next one. */
  tick(): void {
    const now = this.now()
    const at = new Date(now)
    const due: Array<{ routine: Routine; when: number }> = []
    for (const routine of this.d.store.state.routines) {
      if (!routine.enabled) continue
      const latest = latestRun(routine, at)
      if (latest && latest.getTime() > Date.parse(routine.checkedThrough)) due.push({ routine, when: latest.getTime() })
    }
    if (due.length > 0) {
      this.d.store.update((s) => {
        for (const { routine } of due) {
          const r = s.routines.find((x) => x.id === routine.id)
          if (!r) continue
          r.checkedThrough = at.toISOString()
          if (r.schedule.kind === 'once') r.enabled = false
        }
      })
      for (const { routine, when } of due) {
        try {
          if (now - when <= CATCH_UP_MS) this.dispatch(routine, when, 'schedule')
          else this.record(this.receipt(routine, when, 'schedule', 'missed', 'Hiveory was closed or this computer was asleep at that time.'))
        } catch (error) {
          this.d.log.warn(`Routine "${routine.name}" could not run`, error)
        }
      }
      this.changed()
    } else this.arm()
  }

  private dispatch(routine: Routine, when: number, trigger: RunTrigger): RoutineRun {
    const bot = this.d.bots.find(routine.botId)
    if (!bot) return this.record(this.receipt(routine, when, trigger, 'failed', 'Its bot no longer exists.'))
    if (trigger === 'schedule' && !bot.routines) {
      return this.record(this.receipt(routine, when, trigger, 'skipped', `${bot.name} no longer runs on a schedule. Allow it in the bot's settings.`))
    }
    if (this.d.store.state.routineRuns.some((r) => r.routineId === routine.id && r.status === 'running')) {
      return this.record(this.receipt(routine, when, trigger, 'skipped', 'The previous run was still going.'))
    }
    const label = this.label(when, routine.timezone)
    let thread: ChatSession | undefined
    try {
      thread = this.d.bots.newThread(bot.id, `${routine.name} · ${label}`)
      const intro =
        trigger === 'schedule'
          ? `This is a scheduled run of your routine "${routine.name}" (${label}). Nobody is watching it live: do the work, then end with a short report of what you did and found.`
          : `The user started your routine "${routine.name}" now. Do the work, then end with a short report of what you did and found.`
      this.d.chats.send(thread.id, `${intro}\n\n${routine.prompt}`)
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      return this.record({ ...this.receipt(routine, when, trigger, 'failed', `${bot.name} could not start: ${why}`), ...(thread ? { threadId: thread.id } : {}) })
    }
    const run = this.record({ ...this.receipt(routine, when, trigger, 'running'), startedAt: iso(this.now()), threadId: thread.id })
    if (routine.timeoutMinutes) {
      const minutes = routine.timeoutMinutes
      this.limits.set(run.id, this.timers.set(() => this.timeOut(run.id, minutes), minutes * 60_000))
    }
    return run
  }

  private timeOut(runId: string, minutes: number): void {
    this.limits.delete(runId)
    const run = this.d.store.state.routineRuns.find((r) => r.id === runId)
    if (!run || run.status !== 'running') return
    this.finish(runId, 'failed', `Stopped after ${minutes} minute${minutes === 1 ? '' : 's'}, its time limit.`)
    if (run.threadId) this.d.chats.stop(run.threadId)
  }

  private onTurnEnd(chatId: string): void {
    const run = this.d.store.state.routineRuns.find((r) => r.threadId === chatId && r.status === 'running')
    if (!run) return
    const last = [...(this.d.chats.find(chatId)?.messages ?? [])].reverse().find((m) => m.role === 'assistant')
    if (last?.error) this.finish(run.id, 'failed', last.error)
    else this.finish(run.id, 'completed')
  }

  private finish(runId: string, status: 'completed' | 'failed', detail?: string): void {
    const limit = this.limits.get(runId)
    if (limit !== undefined) this.timers.clear(limit)
    this.limits.delete(runId)
    this.d.store.update((s) => {
      const run = s.routineRuns.find((r) => r.id === runId)
      if (run) Object.assign(run, { status, endedAt: iso(this.now()), ...(detail ? { detail } : {}) })
    })
    this.changed()
  }

  private receipt(routine: Routine, when: number, trigger: RunTrigger, status: RoutineRun['status'], detail?: string): RoutineRun {
    const ended = status === 'running' ? {} : { endedAt: iso(this.now()) }
    return {
      id: randomUUID(),
      routineId: routine.id,
      routineName: routine.name,
      botId: routine.botId,
      trigger,
      prompt: routine.prompt,
      scheduledFor: iso(when),
      status,
      ...ended,
      ...(detail ? { detail } : {})
    }
  }

  private record(run: RoutineRun): RoutineRun {
    this.d.store.update((s) => {
      s.routineRuns = [run, ...s.routineRuns].slice(0, MAX_ROUTINE_RUNS)
    })
    return run
  }

  private check(routine: Routine): void {
    if (!validTimezone(routine.timezone)) fail('INVALID_INPUT', `Unknown timezone "${routine.timezone}".`)
    if (Number.isNaN(Date.parse(routine.startsAt))) fail('INVALID_INPUT', 'Pick when it starts.')
    if (routine.endsAt && Date.parse(routine.endsAt) <= Date.parse(routine.startsAt)) fail('INVALID_INPUT', 'It has to end after it starts.')
    if (routine.schedule.kind === 'cron') {
      const problem = cronProblem(routine.schedule.expr)
      if (problem) fail('INVALID_INPUT', problem)
    }
    if (routine.enabled && nextRuns(routine, new Date(this.now()), 1).length === 0) {
      fail('INVALID_INPUT', routine.schedule.kind === 'once' ? 'Pick a time in the future.' : 'This schedule has no runs left.')
    }
  }

  private label(when: number, timezone: string): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when)
  }

  private view(routineId: string): RoutineView {
    return this.list().find((r) => r.id === routineId) ?? fail('NOT_FOUND', 'Routine not found.')
  }

  private changed(): void {
    this.d.emit('state.changed', { topic: 'routines' })
    this.arm()
  }

  /** One timer for the next due run, re-armed after every change. */
  private arm(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
    const now = this.now()
    const at = new Date(now)
    const next = this.d.store.state.routines
      .filter((r) => r.enabled)
      .map((r) => nextRuns(r, at, 1)[0]?.getTime())
      .filter((t): t is number => t !== undefined)
      .sort((a, b) => a - b)[0]
    const running = this.d.store.state.routineRuns.filter((r) => r.status === 'running').length
    this.d.activity?.(running, next)
    if (next === undefined) return
    this.timer = this.timers.set(() => {
      this.timer = null
      this.tick()
    }, Math.min(Math.max(next - now, 1000), MAX_SLEEP_MS))
  }
}
