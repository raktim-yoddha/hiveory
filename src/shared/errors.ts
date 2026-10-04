export type AppErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'GIT_FAILED'
  | 'NOT_A_REPOSITORY'
  | 'NO_COMMITS'
  | 'WORKTREE_DIRTY'
  | 'CLI_UNAVAILABLE'
  | 'CLI_LAUNCH_FAILED'
  | 'PERSISTENCE_FAILED'
  | 'CANCELLED'
  | 'UNEXPECTED'

/** Normalized, serializable error shown to users (STARTER_PROMPT §20). */
export interface AppError {
  code: AppErrorCode
  /** What failed, in plain language. */
  message: string
  /** Operation being attempted, e.g. "Create workspace". */
  operation?: string
  /** Useful next action. */
  hint?: string
  /** Technical details, shown behind a disclosure. */
  detail?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export class AppException extends Error {
  constructor(readonly error: AppError) {
    super(error.message)
  }
}

export const fail = (code: AppErrorCode, message: string, extra: Partial<AppError> = {}): never => {
  throw new AppException({ code, message, ...extra })
}

export const toAppError = (cause: unknown, operation?: string): AppError => {
  if (cause instanceof AppException) return { operation, ...cause.error }
  const detail = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
  return { code: 'UNEXPECTED', message: 'Something went wrong.', operation, detail }
}
