import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { DEFAULT_SHORTCUT, formatShortcut, isModifierCode, MODIFIERS, parseShortcut, SHORTCUT_PRESETS, shortcutLabel, shortcutProblem, type HotkeyStatus, type Modifier } from '@shared/queen/shortcut'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { usePlatform } from '../../lib/platform'
import { useSettings } from '../../stores/data'
import { useQueen } from '../queen/useQueen'
import { shortcutRecording } from '../queen/useQueenShortcut'
import { SettingRow } from './SettingsScreen'
import styles from './Settings.module.css'

const modifierOf = (code: string): Modifier | null => {
  const m = /^(Control|Alt|Shift|Meta|OS)/.exec(code)?.[1]
  return m ? (m === 'OS' ? 'Meta' : (m as Modifier)) : null
}

/** Where Queen Bee sits and the keys that call her. */
export function QueenBarSettings() {
  const { settings, update } = useSettings()
  const placement = useQueen((s) => s.placement)
  const setPlacement = useQueen((s) => s.setPlacement)
  const platform = usePlatform()
  const [recording, setRecording] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const held = useRef(new Set<string>())
  const pressed = useRef(new Set<string>())
  const current = parseShortcut(settings.queenShortcut) ?? parseShortcut(DEFAULT_SHORTCUT)!
  const [hook, setHook] = useState<HotkeyStatus | null>(null)
  const refreshHook = (): Promise<void> => api('queen.hotkeyStatus').then(setHook, () => undefined)

  useEffect(() => {
    void api('queen.hotkeyStatus').then(setHook, () => undefined)
  }, [])

  const choose = (text: string): void => {
    const parsed = parseShortcut(text)
    const issue = parsed ? shortcutProblem(parsed, platform) : 'Use two or three keys, at least one of them a modifier.'
    if (issue) return setProblem(issue)
    setProblem(null)
    void update({ queenShortcut: formatShortcut(parsed!) }).then(refreshHook)
  }

  /** A finished recording: save it, or explain why not and keep recording. */
  const finish = useEffectEvent((text: string): void => {
    choose(text)
    if (parseShortcut(text) && !shortcutProblem(parseShortcut(text)!, platform)) setRecording(false)
  })

  // Recording: every key held during one press counts; letting go of all of them finishes.
  useEffect(() => {
    if (!recording) return
    shortcutRecording.active = true
    held.current.clear()
    pressed.current.clear()
    const onDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape' && !pressed.current.size) {
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
        setProblem('Use two or three keys, at least one of them Ctrl, Alt, Shift or the Windows/⌘ key.')
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
  }, [recording])

  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Shortcut</div>
        <SettingRow
          title="Call Queen Bee"
          description="Tap to type to her. Hold to talk (once a speech pack is installed)."
          control={
            <div className={styles.inlineControls}>
              <kbd className={cx(styles.keycap, recording && styles.keycapLive)} aria-live="polite">
                {recording ? 'Press the keys…' : shortcutLabel(current, platform)}
              </kbd>
              <Button size="sm" onClick={() => setRecording((r) => !r)}>
                {recording ? 'Cancel' : 'Change'}
              </Button>
            </div>
          }
        />
        <div className={styles.chips} role="group" aria-label="Suggested shortcuts">
          {SHORTCUT_PRESETS(platform).map((p) => (
            <button key={p} type="button" className={styles.persona} aria-pressed={formatShortcut(current) === formatShortcut(parseShortcut(p)!)} onClick={() => choose(p)}>
              <span className={styles.personaName}>{shortcutLabel(parseShortcut(p)!, platform)}</span>
              {p === DEFAULT_SHORTCUT && <span className={styles.personaTagline}>Default</span>}
            </button>
          ))}
        </div>
        {problem && (
          <p className={styles.testFail} role="alert">
            {problem}
          </p>
        )}
        <SettingRow
          title="Also in other apps"
          description={
            <>
              Tap to bring Hiveory forward, hold to talk without leaving your editor. It needs a system keyboard hook: it watches only for these keys and never records
              anything else.{platform === 'darwin' ? ' macOS asks you to allow Hiveory under Accessibility.' : ''}
              <HookState status={hook} onAllow={() => void api('queen.hotkeyAccess').then(setHook, () => undefined)} />
            </>
          }
          control={
            <Toggle
              label="Also in other apps"
              checked={settings.queenGlobalShortcut}
              onChange={(on) => void update({ queenGlobalShortcut: on }).then(refreshHook)}
            />
          }
        />
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Placement</div>
        <SettingRow
          title="Where she sits"
          description="Docked sits under the main area and lifts it up. Auto-hide keeps the space free: she rises from the bottom edge when you point there, use her shortcut, speak, or she has something to say."
          control={
            <Select
              label="Where she sits"
              hideLabel
              value={placement}
              options={[
                { value: 'docked', label: 'Docked' },
                { value: 'auto-hide', label: 'Auto-hide' }
              ]}
              onChange={(v) => setPlacement(v as 'docked' | 'auto-hide')}
            />
          }
        />
      </div>
    </>
  )
}

/** Why the system-wide shortcut isn't running, with the fix when there is one. */
function HookState({ status, onAllow }: { status: HotkeyStatus | null; onAllow: () => void }) {
  if (!status || status.state === 'off' || status.state === 'on') return null
  if (status.state === 'needs-permission') {
    return (
      <span className={styles.inlineControls}>
        <span className={styles.testFail}>Hiveory isn’t allowed to see keys in other apps yet.</span>
        <Button size="sm" onClick={onAllow}>
          Allow in System Settings
        </Button>
      </span>
    )
  }
  return (
    <span className={styles.testFail} role="status">
      {status.state === 'unsupported' ? status.reason : status.error}
    </span>
  )
}
