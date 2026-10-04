import type { EventMap } from '@shared/ipc/contract'

/** Broadcasts a typed event to the renderer. Services depend on this, not on Electron. */
export type Emit = <E extends keyof EventMap>(event: E, payload: EventMap[E]) => void

export const nowIso = (): string => new Date().toISOString()
