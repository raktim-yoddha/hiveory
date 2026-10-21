import type { HostState } from './host-server'

/** A daemon with no terminals and nobody attached lingers this long, then ends. */
export const IDLE_MS = 60_000

/**
 * How long a daemon keeps its terminals with nobody attached (ADR 0050 §7): until they end (null,
 * the default), or the limit the app sets with `grace.set` (Settings › Agents). The same rule
 * everywhere, this computer and remote machines alike.
 */
export const gracePolicy = () => {
  let ms: number | null = null
  return {
    calls: {
      'grace.set': (params: unknown) => {
        const value = (params as { ms?: unknown } | null)?.ms
        ms = typeof value === 'number' && value > 0 ? value : null
        return null
      }
    },
    keep: (state: Pick<HostState, 'terminals'>, idle: number): boolean => (state.terminals.size > 0 ? ms === null || idle < ms : idle < IDLE_MS)
  }
}
