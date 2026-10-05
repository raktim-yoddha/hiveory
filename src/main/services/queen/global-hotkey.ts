import { createRequire } from 'node:module'
import { parseShortcut, ShortcutTracker, type HotkeySignal, type HotkeyStatus, type Shortcut } from '@shared/queen/shortcut'
import type { Logger } from '../../app/logger'

/** The parts of uiohook-napi Hiveory uses. */
interface KeyEvent {
  keycode: number
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}
export interface KeyHook {
  on(event: 'keydown' | 'keyup', listener: (e: KeyEvent) => void): unknown
  removeAllListeners(event?: string): unknown
  start(): void
  stop(): void
}
export interface HookModule {
  uIOhook: KeyHook
  UiohookKey: Record<string, number>
}

export const loadHook = (): HookModule => createRequire(import.meta.url)('uiohook-napi') as HookModule

/** uiohook's modifier keycodes, as KeyboardEvent codes (what ShortcutTracker reads). */
const MODIFIER_KEYS: Record<string, string> = {
  Ctrl: 'ControlLeft',
  CtrlRight: 'ControlRight',
  Alt: 'AltLeft',
  AltRight: 'AltRight',
  Shift: 'ShiftLeft',
  ShiftRight: 'ShiftRight',
  Meta: 'MetaLeft',
  MetaRight: 'MetaRight'
}
const STALE_MS = 5000

/** uiohook's name for a KeyboardEvent code: "KeyA" → "A", "Digit1" → "1", the rest match. */
export const uiohookName = (code: string): string => code.replace(/^Key([A-Z])$/, '$1').replace(/^Digit([0-9])$/, '$1')

/**
 * Queen Bee's shortcut while another app is focused (ADR 0019 phase 4, opt-in).
 * A native keyboard hook watches only for the chosen combination: it keeps the
 * modifiers that are down and the chosen key, every other key is an anonymous
 * "something else is pressed", and nothing is ever stored, logged or sent.
 * While Hiveory itself is focused the renderer's own listener handles the keys.
 */
export class GlobalHotkey {
  private hook: KeyHook | null = null
  private status: HotkeyStatus = { state: 'off' }
  private tracker: ShortcutTracker | null = null
  private codes = new Map<number, string>()
  private timer: NodeJS.Timeout | null = null
  /** The press started while another app was focused. */
  private armed = false
  private lastEvent = 0

  constructor(
    private readonly log: Logger,
    private readonly signal: (s: HotkeySignal) => void,
    private readonly appFocused: () => boolean,
    private readonly env: {
      platform: NodeJS.Platform
      wayland: boolean
      /** macOS Accessibility check; `prompt` opens the system dialog. */
      trusted: (prompt: boolean) => boolean
      load: () => HookModule
    } = { platform: process.platform, wayland: process.env.XDG_SESSION_TYPE === 'wayland', trusted: () => true, load: loadHook }
  ) {}

  current(): HotkeyStatus {
    return this.status
  }

  /** Starts, retargets or stops the hook to match the settings. */
  apply(enabled: boolean, shortcutText: string): HotkeyStatus {
    this.stop()
    if (!enabled) return (this.status = { state: 'off' })
    if (this.env.wayland) return (this.status = { state: 'unsupported', reason: 'Wayland doesn’t let apps watch keys in other windows. The shortcut still works inside Hiveory.' })
    if (this.env.platform === 'darwin' && !this.env.trusted(false)) return (this.status = { state: 'needs-permission' })
    const shortcut = parseShortcut(shortcutText)
    if (!shortcut) return (this.status = { state: 'error', error: 'The shortcut is not valid.' })
    try {
      const mod = this.env.load()
      this.codes = this.keyCodes(mod.UiohookKey, shortcut)
      this.tracker = new ShortcutTracker(shortcut)
      this.hook = mod.uIOhook
      this.hook.on('keydown', (e) => this.onKey(e, true))
      this.hook.on('keyup', (e) => this.onKey(e, false))
      this.hook.start()
      return (this.status = { state: 'on' })
    } catch (error) {
      this.log.error('Global shortcut failed to start', error)
      this.stop()
      return (this.status = { state: 'error', error: 'The keyboard hook could not start on this system.' })
    }
  }

  /** macOS: shows the Accessibility prompt, then starts if access was already given. */
  requestAccess(enabled: boolean, shortcutText: string): HotkeyStatus {
    if (this.env.platform === 'darwin') this.env.trusted(true)
    return this.apply(enabled, shortcutText)
  }

  stop(): void {
    this.stopTimer()
    if (this.hook) {
      try {
        this.hook.removeAllListeners('keydown')
        this.hook.removeAllListeners('keyup')
        this.hook.stop()
      } catch (error) {
        this.log.warn('Global shortcut did not stop cleanly', error)
      }
    }
    this.hook = null
    this.tracker = null
    this.armed = false
  }

  /** keycode → the code ShortcutTracker reads: modifiers and the chosen key only. */
  private keyCodes(keys: Record<string, number>, shortcut: Shortcut): Map<number, string> {
    const map = new Map<number, string>()
    for (const [name, code] of Object.entries(MODIFIER_KEYS)) if (keys[name] !== undefined) map.set(keys[name]!, code)
    if (shortcut.code) {
      const keycode = keys[uiohookName(shortcut.code)]
      if (keycode === undefined) throw new Error(`No native key for ${shortcut.code}`)
      map.set(keycode, shortcut.code)
    }
    return map
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private onKey(e: KeyEvent, down: boolean): void {
    const tracker = this.tracker
    if (!tracker) return
    const now = performance.now()
    // Any other key is just "something else": its identity is never kept.
    const code = this.codes.get(e.keycode) ?? 'Other'
    if (!down) {
      this.lastEvent = now
      const result = tracker.keyUp(code, now)
      if (!result) return
      this.stopTimer()
      if (this.armed) this.signal(result)
      this.armed = false
      return
    }
    // A key-up can be lost (lock screen, secure desktop). Held keys repeat, so a new key
    // after seconds of silence means what we think is down is stale: start over.
    // (The event's modifier flags can't be used for this: uiohook reports Ctrl as up while held.)
    if (now - this.lastEvent > STALE_MS) {
      const ended = tracker.reset()
      this.stopTimer()
      if (ended && this.armed) this.signal('hold-end')
      this.armed = false
    }
    this.lastEvent = now
    if (tracker.keyDown(code, now) !== 'press') return
    this.armed = !this.appFocused()
    this.stopTimer()
    this.timer = setInterval(() => {
      if (tracker.tick(performance.now()) === 'hold-start') {
        this.stopTimer()
        if (this.armed) this.signal('hold-start')
      }
    }, 40)
  }
}
