/**
 * Routines (ADR 0028): a bot's scheduled work. Each run opens a fresh thread on the bot with the
 * routine's instructions; a run is a receipt that outlives edits to the routine.
 */

/** The editor's repeat choices. All but "once" and "every X minutes" are stored as cron. */
export const REPEAT_PRESETS = ['daily', 'weekdays', 'weekly', 'selected-days', 'monthly', 'month-end', 'yearly', 'custom'] as const
export type RepeatPreset = (typeof REPEAT_PRESETS)[number]

export type RoutineSchedule =
  | { kind: 'once' }
  | { kind: 'interval'; everyMinutes: number }
  /** Five fields (minute hour day-of-month month day-of-week) in the routine's timezone. `preset` only labels it in the editor. */
  | { kind: 'cron'; expr: string; preset: RepeatPreset }

export interface Routine {
  id: string
  name: string
  botId: string
  /** What the bot is asked to do on every run. */
  prompt: string
  schedule: RoutineSchedule
  /** The first run ("once": the only one; "interval": the anchor; cron: nothing runs before it). */
  startsAt: string
  /** IANA zone the schedule is read in, e.g. Asia/Kolkata. */
  timezone: string
  /** No runs after this. */
  endsAt?: string
  /** Stops a run that takes longer. Absent = no limit. */
  timeoutMinutes?: number
  /** "thread": each finished run posts a dated summary into a results thread; "none": it stays in the run's own thread. */
  results: 'thread' | 'none'
  /** The results thread: one the user picked, or the dedicated one made on the first result. */
  resultsThreadId?: string
  enabled: boolean
  /** Occurrences up to here are handled (run, skipped or missed); nothing before it runs again. */
  checkedThrough: string
  createdAt: string
  updatedAt: string
}

/** What started a run: its schedule, the user's Run now, or an outside event (a trigger, ADR 0028). */
export type RunTrigger = 'schedule' | 'manual' | 'event'
export type RunStatus = 'running' | 'completed' | 'failed' | 'missed' | 'skipped'

/** One run of a routine, kept as it happened even if the routine is edited or deleted. */
export interface RoutineRun {
  id: string
  routineId: string
  routineName: string
  botId: string
  trigger: RunTrigger
  prompt: string
  scheduledFor: string
  startedAt?: string
  endedAt?: string
  /** The thread the run worked in. */
  threadId?: string
  status: RunStatus
  /** Why it failed, was skipped or missed. */
  detail?: string
}

/** A routine as the renderer sees it. */
export interface RoutineView extends Routine {
  nextRunAt?: string
  lastRun?: RoutineRun
}

export const MAX_ROUTINE_NAME = 80
export const MAX_ROUTINE_PROMPT = 24_000
export const MAX_ROUTINES_PER_BOT = 50
/** Runs kept for the run log, newest first; older ones drop off. */
export const MAX_ROUTINE_RUNS = 500
export const INTERVAL_MINUTES = { min: 5, max: 1440 }
/** A run missed by less than this still happens when Hiveory is back; older ones are logged as missed. */
export const CATCH_UP_MS = 12 * 60 * 60 * 1000
