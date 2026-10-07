/** How long before a routine is due the computer is kept awake. */
export const KEEP_AWAKE_LEAD_MS = 60 * 60 * 1000

/**
 * Whether to hold the computer awake for routines (ADR 0028): only while plugged in, in the hour
 * before the next one is due and while one runs. A closed lid still sleeps; nothing wakes a computer.
 */
export function wantsAwake(s: { enabled: boolean; onBattery: boolean; running: number; untilNextMs?: number }): boolean {
  if (!s.enabled || s.onBattery) return false
  return s.running > 0 || (s.untilNextMs !== undefined && s.untilNextMs <= KEEP_AWAKE_LEAD_MS)
}

/** One power-save blocker, held or released (Electron's powerSaveBlocker in the app). */
export class KeepAwake {
  private id: number | null = null

  constructor(private readonly power: { start(): number; stop(id: number): void }) {}

  set(on: boolean): void {
    if (on && this.id === null) this.id = this.power.start()
    else if (!on && this.id !== null) {
      this.power.stop(this.id)
      this.id = null
    }
  }
}
