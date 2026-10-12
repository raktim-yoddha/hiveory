import { useEffect, useState } from 'react'
import { bindingClash } from '@shared/keys/keybindings'
import { defaultQueenShortcut, formatShortcut, parseShortcut, queenShortcutOf, SHORTCUT_PRESETS, shortcutLabel, shortcutProblem, type HotkeyStatus } from '@shared/queen/shortcut'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { usePlatform } from '../../lib/platform'
import { useSettings } from '../../stores/data'
import { useQueen, type QueenPlacement } from '../queen/useQueen'
import { SettingRow } from './SettingsPage'
import { ShortcutField } from './ShortcutField'
import styles from './Settings.module.css'

/** Why keys can't call Queen Bee: invalid, reserved by the system, or taken by another shortcut (ADR 0047). */
export function queenShortcutIssue(text: string, platform: string, keybindings: Parameters<typeof bindingClash>[2]): string | null {
  const parsed = parseShortcut(text)
  if (!parsed) return 'Use two or three keys, at least one of them a modifier.'
  const clash = bindingClash(text, 'queen', keybindings, parsed, platform)
  return shortcutProblem(parsed, platform) ?? (clash ? `${clash} already uses these keys.` : null)
}

/** Where Queen Bee sits and the keys that call her. */
export function QueenBarSettings() {
  const { settings, update } = useSettings()
  const placement = useQueen((s) => s.placement)
  const setPlacement = useQueen((s) => s.setPlacement)
  const platform = usePlatform()
  const [problem, setProblem] = useState<string | null>(null)
  const current = queenShortcutOf(settings.queenShortcut, platform)
  const standard = defaultQueenShortcut(platform)
  const [hook, setHook] = useState<HotkeyStatus | null>(null)
  const refreshHook = (): Promise<void> => api('queen.hotkeyStatus').then(setHook, () => undefined)

  useEffect(() => {
    void api('queen.hotkeyStatus').then(setHook, () => undefined)
  }, [])

  /** Saves keys ('' = the standard ones), or returns why they can't be used. */
  const save = (text: string): string | null => {
    const issue = text ? queenShortcutIssue(text, platform, settings.keybindings) : null
    if (issue) return issue
    const normal = text ? formatShortcut(parseShortcut(text)!) : ''
    void update({ queenShortcut: normal === standard ? '' : normal }).then(refreshHook)
    return null
  }

  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Shortcut</div>
        <SettingRow
          title="Call Queen Bee"
          description="Tap to type to her. Hold to talk (once a speech pack is installed)."
          control={<ShortcutField label="Call Queen Bee" value={current} onRecord={save} isDefault={formatShortcut(current) === standard} onReset={() => void save('')} />}
        />
        <div className={styles.chips} role="group" aria-label="Suggested shortcuts">
          {SHORTCUT_PRESETS(platform).map((p) => (
            <button key={p} type="button" className={styles.persona} aria-pressed={formatShortcut(current) === p} onClick={() => setProblem(save(p))}>
              <span className={styles.personaName}>{shortcutLabel(parseShortcut(p)!, platform)}</span>
              {p === standard && <span className={styles.personaTagline}>Standard</span>}
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
          description="Docked sits under the main area and lifts it up. Floating keeps a fixed-size bar over the bottom of the main area and takes no room. Title bar puts her bar away: only her mark stays, after the side panel button, and her bar drops down when you click it or press her shortcut."
          control={
            <Select
              label="Where she sits"
              hideLabel
              value={placement}
              options={[
                { value: 'docked', label: 'Docked' },
                { value: 'floating', label: 'Floating' },
                { value: 'titlebar', label: 'Title bar only' }
              ]}
              onChange={(v) => setPlacement(v as QueenPlacement)}
            />
          }
        />
        <SettingRow
          title="Pop up replies"
          description="Off: her answers and agent updates wait behind the message button on her bar, so nothing covers your work. Questions and yes/no still open."
          control={<Toggle label="Pop up Queen Bee's replies" checked={settings.queenPopups} onChange={(queenPopups) => void update({ queenPopups })} />}
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
