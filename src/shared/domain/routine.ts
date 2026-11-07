import type { ChatAttachment } from './chat'

/**
 * Routines (ADR 0028, 0040; Work only since ADR 0056): scheduled work. Each run opens an agent in a
 * Worktree with the routine's instructions; a run is a receipt that outlives edits to the routine.
 */

/** Who does a routine's work: a new agent of this CLI in a Worktree; its card moves on the Kanban by its real state. */
export interface RoutineTarget {
  kind: 'workspace'
  projectId: string
  workspaceId: string
  cliId: string
}

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
  target: RoutineTarget
  /** What the agent is asked to do on every run. */
  prompt: string
  /** Files every run gets (copies Hiveory keeps, ADR 0030), listed by path for the agent. */
  attachments?: ChatAttachment[]
  schedule: RoutineSchedule
  /** The first run ("once": the only one; "interval": the anchor; cron: nothing runs before it). */
  startsAt: string
  /** IANA zone the schedule is read in, e.g. Asia/Kolkata. */
  timezone: string
  /** No runs after this. */
  endsAt?: string
  /** Stops a run that takes longer. Absent = no limit. */
  timeoutMinutes?: number
  enabled: boolean
  /** Occurrences up to here are handled (run, skipped or missed); nothing before it runs again. */
  checkedThrough: string
  createdAt: string
  updatedAt: string
}

/** What started a run: its schedule, or the user's Run now. */
export type RunTrigger = 'schedule' | 'manual'
export type RunStatus = 'running' | 'completed' | 'failed' | 'missed' | 'skipped'

/** One run of a routine, kept as it happened even if the routine is edited or deleted. */
export interface RoutineRun {
  id: string
  routineId: string
  routineName: string
  /** Who did the run, as the user reads it: "Claude Code in demo-app · main". */
  where?: string
  /** The run's agent. */
  agentId?: string
  trigger: RunTrigger
  prompt: string
  scheduledFor: string
  startedAt?: string
  endedAt?: string
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
export const MAX_ROUTINES = 50
export const MAX_ROUTINE_FILES = 5
export const MAX_ROUTINE_FILE_BYTES = 25 * 1024 * 1024
/** Runs kept for the run log, newest first; older ones drop off. */
export const MAX_ROUTINE_RUNS = 500
export const INTERVAL_MINUTES = { min: 5, max: 1440 }
/** A run missed by less than this still happens when Hiveory is back; older ones are logged as missed. */
export const CATCH_UP_MS = 12 * 60 * 60 * 1000
