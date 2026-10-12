import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { formatShortcut, isModifierCode, MODIFIERS, parseShortcut, shortcutLabel, type Modifier, type Shortcut } from '@shared/queen/shortcut'
import { Button } from '../../components/ui/Button'
import { cx } from '../../lib/cx'
import { usePlatform } from '../../lib/platform'
import { shortcutRecording } from '../queen/useQueenShortcut'
import styles from './Settings.module.css'

const modifierOf = (code: string): Modifier | null => {
  const m = /^(Control|Alt|Shift|Meta|OS)/.exec(code)?.[1]
  return m ? (m === 'OS' ? 'Meta' : (m as Modifier)) : null
}

interface ShortcutFieldProps {
  /** What it does, for the buttons' labels. */
  label: string
  /** The keys now, or null when cleared. */
  value: Shortcut | null
  /** Saves recorded keys; returns why they can't be used (and recording goes on), or null. */
  onRecord: (text: string) => string | null
  /** Back to the standard keys, shown only when they differ. */
  onReset?: () => void
  isDefault?: boolean
  /** Removes the shortcut. */
  onClear?: () => void
}

/**
 * Shows a shortcut as keycaps and records a new one (ADR 0019, 0047): every key held during one
 * press counts, letting go of all of them finishes, Escape cancels.
 */
export function ShortcutField({ label, value, onRecord, onReset, isDefault = true, onClear }: ShortcutFieldProps) {
  const platform = usePlatform()
  const [recording, setRecording] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const held = useRef(new Set<string>())
  const pressed = useRef(new Set<string>())

  const finish = useEffectEvent((text: string): void => {
    const issue = onRecord(text)
    setProblem(issue)
    if (!issue) setRecording(false)
  })

  useEffect(() => {
    if (!recording) return
    shortcutRecording.active = true
    held.current.clear()
    pressed.current.clear()
    const onDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape' && !pressed.current.size) {
        setProblem(null)
        setRecording(false)
        return
      }
      held.current.add(e.code)
      pressed.current.add(e.code)
    }
    const onUp = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      held.current.delete(e.code)
      if (held.current.size) return
      const codes = [...pressed.current]
      pressed.current.clear()
      const mods = MODIFIERS.filter((m) => codes.some((c) => modifierOf(c) === m))
      const keys = codes.filter((c) => !isModifierCode(c))
      const text = formatShortcut({ mods, code: keys[0] })
      if (keys.length > 1 || !parseShortcut(text)) {
        setProblem(`Use two or three keys, at least one of them ${platform === 'darwin' ? '⌘, ⌥, ⌃ or ⇧' : 'Ctrl, Alt or Shift'}.`)
        return
      }
      finish(text)
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      shortcutRecording.active = false
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [recording, platform])

  return (
    <div className={styles.shortcutField}>
      <div className={styles.inlineControls}>
        <kbd className={cx(styles.keycap, recording && styles.keycapLive, !value && !recording && styles.keycapNone)} aria-live="polite">
          {recording ? 'Press the keys…' : value ? shortcutLabel(value, platform) : 'None'}
        </kbd>
        <Button size="sm" aria-label={recording ? `Cancel changing ${label}` : `Change ${label}`} onClick={() => (setProblem(null), setRecording((r) => !r))}>
          {recording ? 'Cancel' : 'Change'}
        </Button>
        {!recording && onClear && value && (
          <Button size="sm" variant="ghost" aria-label={`Remove the shortcut for ${label}`} onClick={onClear}>
            Remove
          </Button>
        )}
        {!recording && onReset && !isDefault && (
          <Button size="sm" variant="ghost" aria-label={`Reset ${label} to its standard keys`} onClick={onReset}>
            Reset
          </Button>
        )}
      </div>
      {problem && (
        <p className={styles.testFail} role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
