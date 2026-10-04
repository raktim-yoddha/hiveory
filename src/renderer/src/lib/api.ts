import type { AppError } from '@shared/errors'
import type { Channel, EventMap, EventName, RequestOf, ResponseOf } from '@shared/ipc/contract'

export class HiveoryError extends Error {
  constructor(readonly error: AppError) {
    super(error.message)
  }
}

const bridge = () => {
  if (!window.hiveory) {
    throw new HiveoryError({ code: 'UNEXPECTED', message: 'Hiveory must run inside the desktop app.' })
  }
  return window.hiveory
}

/** Typed call into the main process. Rejects with HiveoryError carrying a normalized AppError. */
export const api = async <C extends Channel>(
  channel: C,
  ...payload: undefined extends RequestOf<C> ? [RequestOf<C>?] : [RequestOf<C>]
): Promise<ResponseOf<C>> => {
  const result = await bridge().invoke(channel, ...payload)
  if (!result.ok) throw new HiveoryError(result.error)
  return result.value
}

export const subscribe = <E extends EventName>(event: E, listener: (payload: EventMap[E]) => void): (() => void) =>
  window.hiveory ? window.hiveory.on(event, listener) : () => undefined

export const toAppError = (error: unknown, operation?: string): AppError => {
  if (error instanceof HiveoryError) return { operation, ...error.error }
  return {
    code: 'UNEXPECTED',
    message: 'Something went wrong.',
    operation,
    detail: error instanceof Error ? (error.stack ?? error.message) : String(error)
  }
}
