import type { CliRuntimeDetails, WaitingReason } from '@shared/domain'

/**
 * Provider-neutral events. Adapters translate hooks and heuristics into these;
 * the reducer maps them onto exactly three statuses (ADR 0002).
 */
export type StatusEvent =
  | { type: 'started' }
  | { type: 'working'; activity?: string }
  | { type: 'needs-user'; reason: WaitingReason; activity?: string }
  | { type: 'turn-complete' }
  | { type: 'exited'; code: number | null; signal?: number | null }
  | { type: 'failed'; error: string }

export const NOT_RUNNING: CliRuntimeDetails = { status: 'idle', running: false, activity: 'Not running' }

const WAITING_LABEL: Record<WaitingReason, string> = {
  permission: 'Waiting for permission',
  input: 'Waiting for input',
  confirmation: 'Waiting for confirmation',
  other: 'Waiting for you'
}

export const waitingLabel = (reason: WaitingReason): string => WAITING_LABEL[reason]

export const reduceStatus = (current: CliRuntimeDetails, event: StatusEvent): CliRuntimeDetails => {
  switch (event.type) {
    case 'started':
      return { status: 'idle', running: true }
    case 'working':
      if (!current.running) return current
      return { status: 'working', running: true, activity: event.activity }
    case 'needs-user':
      if (!current.running) return current
      return {
        status: 'waiting-for-you',
        running: true,
        waitingReason: event.reason,
        activity: event.activity ?? waitingLabel(event.reason)
      }
    case 'turn-complete':
      if (!current.running) return current
      return { status: 'idle', running: true }
    case 'exited': {
      const clean = event.code === 0 || event.code === null
      return {
        status: 'idle',
        running: false,
        activity: clean ? 'Session ended' : `Exited with code ${event.code}`,
        ...(clean ? {} : { error: `Process exited with code ${event.code}` })
      }
    }
    case 'failed':
      return { status: 'idle', running: false, activity: 'Failed to start', error: event.error }
  }
}

export const sameDetails = (a: CliRuntimeDetails, b: CliRuntimeDetails): boolean =>
  a.status === b.status &&
  a.running === b.running &&
  a.waitingReason === b.waitingReason &&
  a.activity === b.activity &&
  a.error === b.error
