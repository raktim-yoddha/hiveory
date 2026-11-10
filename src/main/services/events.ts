import type { EventMap } from '@shared/ipc/contract'

/**
 * Who an event is for, when not everyone: this computer's own `window`, or the `clients` paired
 * with it (phones, desktops using it as their server). A streaming reply goes to the window as
 * what was added and to clients whole (ADR 0068).
 */
export type Audience = 'window' | 'clients'

/** Broadcasts a typed event to the renderer and to paired clients. Services depend on this, not on Electron. */
export type Emit = <E extends keyof EventMap>(event: E, payload: EventMap[E], audience?: Audience) => void

export const nowIso = (): string => new Date().toISOString()
