import { randomUUID } from 'node:crypto'
import type { ChatAttachment } from '@shared/domain/chat'
import {
  CATCH_UP_MS,
  MAX_ROUTINE_FILES,
  MAX_ROUTINE_RUNS,
  MAX_ROUTINES,
  type Routine,
  type RoutineRun,
  type RoutineTarget,
  type RoutineView,
  type RunTrigger
} from '@shared/domain/routine'
import { cronProblem, latestRun, nextRuns, validTimezone } from '@shared/domain/routine-schedule'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import type { Emit } from '../events'
import type { StateStore } from '../persistence/state-store'

export type RoutineInput = Pick<Routine, 'name' | 'prompt' | 'schedule' | 'startsAt' | 'timezone' | 'target'> &
  Partial<Pick<Routine, 'attachments' | 'endsAt' | 'timeoutMinutes' | 'enabled'>>
export type RoutinePatch = Partial<Omit<RoutineInput, 'endsAt' | 'timeoutMinutes'>> & {
  /** null clears it. */
  endsAt?: string | null
  timeoutMinutes?: number | null
}

interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface RoutineDeps {
  store: StateStore
  /** Who runs a routine: an agent in its Worktree (ADR 0040). */
  targets: {
    /** "Claude Code in demo-app · main": who did a run, for its receipt. */
    describe(target: RoutineTarget): string
    /** Opens an agent in the workspace and gives it the prompt once it is ready; `done` settles when it stops working. */
    workspace(target: RoutineTarget, prompt: string): { agentId: string; done: Promise<{ ok: boolean; detail?: string }> }
  }
  /** The folder of routines' file copies: only paths in it may be attached, and removed ones are deleted. */
  files?: { owns(path: string): boolean; remove(paths: string[]): void }
  emit: Emit
  log: Logger
  /** Told after every change: how many runs are going, and when the next one is due (keep-awake). */
  activity?: (running: number, nextDueAt: number | undefined) => void
  /** Told when a run ends (done or failed) or is missed: the desktop notification. Skipped runs stay quiet. */
  outcome?: (run: RoutineRun) => void
  now?: () => number
  timers?: Timers
}

/** The scheduler sleeps at most this long, so sleep, clock changes and a slow timer cost minutes, not hours. */
const MAX_SLEEP_MS = 5 * 60 * 1000

const iso = (ms: number): string => new Date(ms).toISOString()

const timingChanged = (patch: RoutinePatch): boolean =>
  patch.schedule !== undefined || patch.startsAt !== undefined || patch.timezone !== undefined || patch.endsAt !== undefined || patch.enabled === true

/**
 * Routines (ADR 0028, 0040): a Worktree's scheduled work. One timer, armed for the next due run (never a polling
 * loop), runs each one on a fresh agent in its Worktree. A run missed while Hiveory was closed or asleep
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

  list(): RoutineView[] {
    const at = new Date(this.now())
    return this.d.store.state.routines.map((r) => {
      const next = r.enabled ? nextRuns(r, at, 1)[0] : undefined
      const lastRun = this.d.store.state.routineRuns.find((run) => run.routineId === r.id)
      return { ...r, ...(next ? { nextRunAt: next.toISOString() } : {}), ...(lastRun ? { lastRun } : {}) }
    })
  }

  get(routineId: string): Routine {
    return this.d.store.state.routines.find((r) => r.id === routineId) ?? fail('NOT_FOUND', 'Schedule not found.')
  }

  runs(filter: { routineId?: string } = {}): RoutineRun[] {
    return this.d.store.state.routineRuns.filter((r) => !filter.routineId || r.routineId === filter.routineId)
  }

  create(input: RoutineInput): RoutineView {
    if (this.d.store.state.routines.length >= MAX_ROUTINES) fail('INVALID_INPUT', `You already have ${MAX_ROUTINES} schedules. Remove one first.`)
    const now = iso(this.now())
    const routine: Routine = {
      id: randomUUID(),
      name: input.name.trim(),
      target: input.target,
      prompt: input.prompt.trim(),
      ...(input.attachments?.length ? { attachments: this.checkFiles(input.attachments) } : {}),
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
    const next = { ...current, ...patch } as Routine
    // null clears an optional field.
    for (const key of ['endsAt', 'timeoutMinutes'] as const) if (next[key] === null || next[key] === undefined) delete next[key]
    if (patch.attachments !== undefined) {
      if (patch.attachments.length) next.attachments = this.checkFiles(patch.attachments)
      else delete next.attachments
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
    this.dropFiles(current.attachments, next.attachments)
    this.changed()
    return this.view(routineId)
  }

  /** Removes the routine; its run log stays, and a run going now finishes. */
  delete(routineId: string): void {
    this.dropFiles(this.get(routineId).attachments)
    this.d.store.update((s) => {
      s.routines = s.routines.filter((r) => r.id !== routineId)
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
          this.d.log.warn(`Schedule "${routine.name}" could not run`, error)
        }
      }
      this.changed()
    } else this.arm()
  }

  /** A run on a new agent in the routine's Worktree (ADR 0040). */
  private dispatch(routine: Routine, when: number, trigger: RunTrigger): RoutineRun {
    const where = this.d.targets.describe(routine.target)
    if (this.d.store.state.routineRuns.some((r) => r.routineId === routine.id && r.status === 'running')) {
      return this.record({ ...this.receipt(routine, when, trigger, 'skipped', 'The previous run was still going.'), where })
    }
    const label = this.label(when, routine.timezone)
    const intro =
      trigger === 'schedule'
        ? `This is a scheduled run of the schedule "${routine.name}" (${label}). Nobody is watching it live: do the work, then end with a short report of what you did and found.`
        : `The user started the schedule "${routine.name}" now. Do the work, then end with a short report of what you did and found.`
    const prompt = `${intro}\n\n${routine.prompt}`
    let run: RoutineRun
    try {
      // The agent reads files by path: they are listed after the instructions.
      const files = (routine.attachments ?? []).map((a) => `- ${a.path}`)
      const { agentId, done } = this.d.targets.workspace(routine.target, files.length ? `${prompt}\n\nFiles for this run:\n${files.join('\n')}` : prompt)
      run = this.record({ ...this.receipt(routine, when, trigger, 'running'), startedAt: iso(this.now()), agentId, where })
      const runId = run.id
      done.then(
        (r) => this.finish(runId, r.ok ? 'completed' : 'failed', r.detail),
        (error: unknown) => this.finish(runId, 'failed', error instanceof Error ? error.message : String(error))
      )
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      return this.record({ ...this.receipt(routine, when, trigger, 'failed', `${where} could not start: ${why}`), where })
    }
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
    this.finish(runId, 'failed', `Stopped after ${minutes} minute${minutes === 1 ? '' : 's'}, its time limit. The agent is still open in Work.`)
  }

  private finish(runId: string, status: 'completed' | 'failed', detail?: string): void {
    // A run ends once: a Work run that finishes after its time limit already ended it.
    if (this.d.store.state.routineRuns.find((r) => r.id === runId)?.status !== 'running') return
    const limit = this.limits.get(runId)
    if (limit !== undefined) this.timers.clear(limit)
    this.limits.delete(runId)
    this.d.store.update((s) => {
      const run = s.routineRuns.find((r) => r.id === runId)
      if (run) Object.assign(run, { status, endedAt: iso(this.now()), ...(detail ? { detail } : {}) })
    })
    const run = this.d.store.state.routineRuns.find((r) => r.id === runId)
    if (run) this.tell(run)
    this.changed()
  }

  private tell(run: RoutineRun): void {
    try {
      this.d.outcome?.(run)
    } catch (error) {
      this.d.log.warn('Could not announce a scheduled run', error)
    }
  }

  private receipt(routine: Routine, when: number, trigger: RunTrigger, status: RoutineRun['status'], detail?: string): RoutineRun {
    const ended = status === 'running' ? {} : { endedAt: iso(this.now()) }
    return {
      id: randomUUID(),
      routineId: routine.id,
      routineName: routine.name,
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
    // A run that could not start, or was missed, is news too.
    if (run.status === 'failed' || run.status === 'missed') this.tell(run)
    return run
  }

  /** A routine's files must be copies Hiveory made (`routines.addFile`), never any other path. */
  private checkFiles(files: ChatAttachment[]): ChatAttachment[] {
    if (files.length > MAX_ROUTINE_FILES) fail('INVALID_INPUT', `A schedule can carry ${MAX_ROUTINE_FILES} files at most.`)
    if (!this.d.files || files.some((f) => !this.d.files!.owns(f.path))) fail('INVALID_INPUT', 'Add the files again.')
    return files
  }

  /** Deletes the copies `before` had that `after` no longer uses. */
  private dropFiles(before: ChatAttachment[] = [], after: ChatAttachment[] = []): void {
    const kept = new Set(after.map((f) => f.path))
    const gone = before.map((f) => f.path).filter((p) => !kept.has(p))
    if (gone.length) this.d.files?.remove(gone)
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
    return this.list().find((r) => r.id === routineId) ?? fail('NOT_FOUND', 'Schedule not found.')
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
