import { APP_COMMANDS, bindingClash, bindingOf, defaultBinding, type AppCommandId, type Keybindings } from '@shared/keys/keybindings'
import { defaultQueenShortcut, formatShortcut, parseShortcut, queenShortcutOf, shortcutProblem } from '@shared/queen/shortcut'
import { Button } from '../../components/ui/Button'
import { usePlatform } from '../../lib/platform'
import { useSettings } from '../../stores/data'
import { queenShortcutIssue } from './QueenBarSettings'
import { SettingRow, SettingsPage } from './SettingsPage'
import { ShortcutField } from './ShortcutField'
import styles from './Settings.module.css'

/** Keys that are always the same: what terminals, the editor and panes do (shown, not changed). */
const fixedKeys = (mac: boolean): Array<{ title: string; keys: string[] }> => [
  { title: 'Copy a selection in a terminal; with none, interrupt the agent', keys: mac ? ['⌘C', '⌃C'] : ['Ctrl C'] },
  { title: 'Paste into a terminal', keys: [mac ? '⌘V' : 'Ctrl V'] },
  { title: 'New line in an agent prompt', keys: [mac ? '⇧↩' : 'Shift Enter'] },
  { title: 'Find in a file, save a file', keys: mac ? ['⌘F', '⌘S'] : ['Ctrl F', 'Ctrl S'] },
  { title: 'Rename or delete in the Explorer', keys: ['F2', mac ? '⌫' : 'Delete'] },
  { title: 'Move a side panel tab', keys: [mac ? '⌃⇧ Arrows' : 'Ctrl Shift Arrows'] },
  { title: 'Swap two panes while dragging one', keys: ['Hold Space'] }
]

/**
 * Settings › Keyboard (ADR 0047): every shortcut of the app, with its platform's standard keys,
 * changed by pressing new ones. Queen Bee's are the same as in Settings › Queen Bee.
 */
export function KeyboardSection() {
  const { settings, update } = useSettings()
  const platform = usePlatform()
  const overrides = settings.keybindings
  const queen = queenShortcutOf(settings.queenShortcut, platform)
  const queenStandard = defaultQueenShortcut(platform)
  const groups = [...new Set(APP_COMMANDS.map((c) => c.group))]
  const changed = Object.keys(overrides).length > 0 || settings.queenShortcut !== ''

  const setBinding = (id: AppCommandId, text: string | null): void => {
    const next: Keybindings = { ...overrides }
    // Back to the standard keys: forget the change.
    if (text === null || text === defaultBinding(id, platform)) delete next[id]
    else next[id] = text
    void update({ keybindings: next })
  }

  const record = (id: AppCommandId) => (text: string): string | null => {
    const parsed = parseShortcut(text)
    if (!parsed?.code) return `Add a key to the modifiers, like ${platform === 'darwin' ? '⌘B' : 'Ctrl Shift B'}.`
    // "New" never fires in Work, so Ctrl + a letter can't take a terminal's key.
    const issue = shortcutProblem(parsed, platform, { terminals: id !== 'new-item' })
    if (issue) return issue
    const clash = bindingClash(text, id, overrides, queen, platform)
    if (clash) return `${clash} already uses these keys.`
    setBinding(id, formatShortcut(parsed))
    return null
  }

  const recordQueen = (text: string): string | null => {
    const issue = queenShortcutIssue(text, platform, overrides)
    if (issue) return issue
    const normal = formatShortcut(parseShortcut(text)!)
    void update({ queenShortcut: normal === queenStandard ? '' : normal })
    return null
  }

  return (
    <SettingsPage title="Keyboard" description={`Shortcuts use your system's standard keys${platform === 'darwin' ? ' (⌘ on a Mac)' : ' (Ctrl, never the Windows key)'}. Click Change, then press the new keys.`}>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Queen Bee</div>
        <SettingRow
          title="Call Queen Bee"
          description="Tap to type to her, hold to talk. Settings › Queen Bee can also make it work in other apps."
          control={
            <ShortcutField
              label="Call Queen Bee"
              value={queen}
              onRecord={recordQueen}
              isDefault={formatShortcut(queen) === queenStandard}
              onReset={() => void update({ queenShortcut: '' })}
            />
          }
        />
      </div>

      {groups.map((group) => (
        <div key={group} className={styles.group}>
          <div className={styles.groupTitle}>{group}</div>
          {APP_COMMANDS.filter((c) => c.group === group).map((c) => (
            <SettingRow
              key={c.id}
              title={c.label}
              control={
                <ShortcutField
                  label={c.label}
                  value={bindingOf(c.id, overrides, platform)}
                  onRecord={record(c.id)}
                  isDefault={!(c.id in overrides)}
                  onReset={() => setBinding(c.id, null)}
                  onClear={() => setBinding(c.id, '')}
                />
              }
            />
          ))}
        </div>
      ))}

      <div className={styles.group}>
        <div className={styles.groupTitle}>Built in</div>
        {fixedKeys(platform === 'darwin').map((k) => (
          <SettingRow
            key={k.title}
            title={k.title}
            control={
              <span className={styles.fixedKeys}>
                {k.keys.map((key) => (
                  <kbd key={key} className={styles.keycap}>
                    {key}
                  </kbd>
                ))}
              </span>
            }
          />
        ))}
      </div>

      {changed && (
        <Button variant="ghost" onClick={() => void update({ keybindings: {}, queenShortcut: '' })}>
          Reset every shortcut to its standard keys
        </Button>
      )}
    </SettingsPage>
  )
}
