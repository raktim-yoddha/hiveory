import type { Logger } from './logger'

/**
 * Runs one feature's step so its failure stays its own (ADR 0009): the error is
 * logged (and optionally reported) and the caller carries on with the next feature.
 * Async steps are guarded too; a guarded call never throws or rejects.
 */
export function guard<T>(log: Logger, feature: string, step: () => T, onError?: (error: unknown) => void): T | undefined {
  const fail = (error: unknown): undefined => {
    log.error(`${feature} failed`, error)
    try {
      onError?.(error)
    } catch {
      // Reporting must never break the caller either.
    }
    return undefined
  }
  try {
    const result = step()
    if (result instanceof Promise) return result.catch(fail) as T
    return result
  } catch (error) {
    return fail(error)
  }
}
