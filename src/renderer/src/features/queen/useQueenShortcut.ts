import { useEffect } from 'react'
import { DEFAULT_SHORTCUT, parseShortcut, ShortcutTracker } from '@shared/queen/shortcut'
import { useSettings } from '../../stores/data'
import { useQueen } from './useQueen'
import { queenVoice } from './voice'

/** Set while Settings records a new shortcut, so pressing keys there doesn't trigger Queen Bee. */
export const shortcutRecording = { active: false }

/**
 * Queen Bee's shortcut, while Hiveory is focused (ADR 0019): tap to focus her,
 * hold to talk (when voice is set up). Listens in the capture phase so terminals
 * and editors never swallow it; a combination with a regular key never reaches them.
 */
export function useQueenShortcut(): void {
  const text = useSettings((s) => s.settings.queenShortcut)
  useEffect(() => {
    const shortcut = parseShortcut(text) ?? parseShortcut(DEFAULT_SHORTCUT)!
    const tracker = new ShortcutTracker(shortcut)
    let timer: number | null = null
    const stopTimer = (): void => {
      if (timer !== null) window.clearInterval(timer)
      timer = null
    }
    const finish = (result: 'tap' | 'hold-end' | null): void => {
      if (result === 'tap') useQueen.getState().focus()
      else if (result === 'hold-end') {
        // Without voice a long press still just opens her.
        if (queenVoice.listening()) void queenVoice.stop()
        else useQueen.getState().focus()
      }
    }
    const onDown = (e: KeyboardEvent): void => {
      if (shortcutRecording.active) return
      if (tracker.keyDown(e.code, e.timeStamp) === 'press') {
        if (shortcut.code) {
          e.preventDefault()
          e.stopPropagation()
        }
        stopTimer()
        timer = window.setInterval(() => {
          if (tracker.tick(performance.now()) === 'hold-start' && queenVoice.ready()) void queenVoice.start()
        }, 40)
      } else if (shortcut.code && e.code === shortcut.code && e.repeat) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onUp = (e: KeyboardEvent): void => {
      if (shortcutRecording.active) return void tracker.reset()
      const result = tracker.keyUp(e.code, e.timeStamp)
      if (result) stopTimer()
      finish(result)
    }
    const onBlur = (): void => {
      stopTimer()
      if (tracker.reset() && queenVoice.listening()) void queenVoice.stop()
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      stopTimer()
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [text])
}
