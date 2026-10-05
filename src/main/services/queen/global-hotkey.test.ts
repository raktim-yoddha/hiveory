import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HotkeySignal } from '@shared/queen/shortcut'
import { GlobalHotkey, uiohookName, type HookModule } from './global-hotkey'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const KEYS = { Ctrl: 29, Alt: 56, Shift: 42, Meta: 3675, MetaRight: 3676, AltRight: 3640, CtrlRight: 3613, ShiftRight: 54, Space: 57, A: 30 }

class FakeHook extends EventEmitter {
  running = false
  start(): void {
    this.running = true
  }
  stop(): void {
    this.running = false
  }
  key(keycode: number, down: boolean): void {
    this.emit(down ? 'keydown' : 'keyup', { keycode, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })
  }
}

const setup = (options: { focused?: boolean; platform?: NodeJS.Platform; trusted?: boolean; wayland?: boolean } = {}) => {
  const hook = new FakeHook()
  const signals: HotkeySignal[] = []
  const hotkey = new GlobalHotkey(log, (s) => signals.push(s), () => options.focused ?? false, {
    platform: options.platform ?? 'win32',
    wayland: options.wayland ?? false,
    trusted: () => options.trusted ?? true,
    load: () => ({ uIOhook: hook, UiohookKey: KEYS }) as unknown as HookModule
  })
  return { hook, signals, hotkey }
}

describe('system-wide Queen Bee shortcut', () => {
  afterEach(() => vi.useRealTimers())

  it('a tap of Win+Alt in another app signals a tap; a hold signals hold-start and hold-end', () => {
    vi.useFakeTimers()
    const { hook, signals, hotkey } = setup()
    expect(hotkey.apply(true, 'Meta+Alt')).toEqual({ state: 'on' })
    expect(hook.running).toBe(true)
    hook.key(KEYS.Meta, true)
    hook.key(KEYS.Alt, true)
    hook.key(KEYS.Alt, false)
    hook.key(KEYS.Meta, false)
    expect(signals).toEqual(['tap'])

    hook.key(KEYS.Meta, true)
    hook.key(KEYS.Alt, true)
    vi.advanceTimersByTime(500)
    expect(signals).toEqual(['tap', 'hold-start'])
    hook.key(KEYS.Alt, false)
    expect(signals).toEqual(['tap', 'hold-start', 'hold-end'])
  })

  it('stays quiet while Hiveory is focused (its own listener handles it) and when another key joins in', () => {
    const focused = setup({ focused: true })
    focused.hotkey.apply(true, 'Meta+Alt')
    focused.hook.key(KEYS.Meta, true)
    focused.hook.key(KEYS.Alt, true)
    focused.hook.key(KEYS.Alt, false)
    expect(focused.signals).toEqual([])

    const { hook, signals, hotkey } = setup()
    hotkey.apply(true, 'Meta+Alt')
    hook.key(KEYS.Meta, true)
    hook.key(KEYS.Alt, true)
    hook.key(KEYS.A, true)
    hook.key(KEYS.A, false)
    hook.key(KEYS.Alt, false)
    expect(signals).toEqual([])
  })

  it('handles a modifier + key shortcut, and stops listening when turned off', () => {
    const { hook, signals, hotkey } = setup()
    hotkey.apply(true, 'Control+Shift+Space')
    hook.key(KEYS.Ctrl, true)
    hook.key(KEYS.Shift, true)
    hook.key(KEYS.Space, true)
    hook.key(KEYS.Space, false)
    expect(signals).toEqual(['tap'])
    expect(hotkey.apply(false, 'Control+Shift+Space')).toEqual({ state: 'off' })
    expect(hook.running).toBe(false)
    expect(hook.listenerCount('keydown')).toBe(0)
  })

  it('needs Accessibility on macOS and is unsupported on Wayland', () => {
    expect(setup({ platform: 'darwin', trusted: false }).hotkey.apply(true, 'Meta+Alt')).toEqual({ state: 'needs-permission' })
    expect(setup({ wayland: true }).hotkey.apply(true, 'Meta+Alt').state).toBe('unsupported')
  })

  it('maps KeyboardEvent codes to the hook’s key names', () => {
    expect(uiohookName('KeyK')).toBe('K')
    expect(uiohookName('Digit7')).toBe('7')
    expect(uiohookName('Space')).toBe('Space')
    expect(uiohookName('F12')).toBe('F12')
  })
})
