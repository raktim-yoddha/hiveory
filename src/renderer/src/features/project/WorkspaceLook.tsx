import { useRef, useState } from 'react'
import { ImagePlus, Pipette, Trash2 } from 'lucide-react'
import { WORKSPACE_COLORS, WORKSPACE_ICONS, workspaceColor, type Project } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useProjects } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { markColor, WORKSPACE_COLOR, WORKSPACE_ICON, WorkspaceMark } from '../projects/WorkspaceMark'
import styles from './ProjectScreen.module.css'

const COLOR_NAMES: Record<(typeof WORKSPACE_COLORS)[number], string> = {
  accent: 'Theme accent',
  blue: 'Blue',
  cyan: 'Cyan',
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  magenta: 'Magenta',
  gray: 'Gray'
}

/**
 * The Workspace's sidebar mark (ADR 0038, 0042): an icon in a theme color or any color, or an avatar
 * image of the user's own. Choosing an icon goes back from the avatar to the icon.
 */
export function WorkspaceLook({ project }: { project: Project }) {
  const update = useProjects((s) => s.update)
  const setProject = useProjects((s) => s.load)
  const [mode, setMode] = useState<'icon' | 'avatar'>(project.settings?.avatar ? 'avatar' : 'icon')
  const icon = project.settings?.icon ?? 'folder'
  const custom = project.settings?.customColor
  const color = custom ? null : workspaceColor(project)
  const usingAvatar = Boolean(project.settings?.avatar)
  // The system picker reports every step of a drag: show it at once, save once it settles.
  const [draftColor, setDraftColor] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pickColor = (value: string): void => {
    setDraftColor(value)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setDraftColor(null)
      void update(project.id, { settings: { customColor: value } })
    }, 300)
  }
  const shownCustom = draftColor ?? custom

  const chooseImage = (): void =>
    void runAction('Choose avatar', async () => {
      if (await api('projects.pickAvatar', { projectId: project.id })) await setProject()
    })

  return (
    <div className={styles.look}>
      <Tabs<'icon' | 'avatar'>
        label="Workspace mark"
        variant="segmented"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'icon', label: 'Icon' },
          { value: 'avatar', label: 'Avatar' }
        ]}
      />
      {mode === 'avatar' ? (
        <div className={styles.lookRow}>
          <span className={styles.avatarPreview}>{usingAvatar ? <WorkspaceMark project={project} className={styles.avatarImage} /> : <ImagePlus aria-hidden />}</span>
          <Button size="sm" icon={<ImagePlus />} onClick={chooseImage}>
            {usingAvatar ? 'Change image' : 'Choose image'}
          </Button>
          {usingAvatar && (
            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => void update(project.id, { settings: { avatar: null } })}>
              Remove
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className={styles.lookRow} role="radiogroup" aria-label="Workspace icon">
            {WORKSPACE_ICONS.map((id) => {
              const Icon = WORKSPACE_ICON[id]
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={!usingAvatar && icon === id}
                  aria-label={id}
                  title={id}
                  className={cx(styles.lookOption, !usingAvatar && icon === id && styles.lookOn)}
                  style={{ color: markColor(project) }}
                  onClick={() => void update(project.id, { settings: { icon: id === 'folder' ? null : id, ...(usingAvatar ? { avatar: null } : {}) } })}
                >
                  <Icon aria-hidden />
                </button>
              )
            })}
          </div>
          <div className={styles.lookRow} role="radiogroup" aria-label="Workspace color">
            {WORKSPACE_COLORS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={color === id}
                aria-label={COLOR_NAMES[id]}
                title={COLOR_NAMES[id]}
                className={cx(styles.lookOption, color === id && styles.lookOn)}
                onClick={() => void update(project.id, { settings: { color: id, customColor: null } })}
              >
                <span className={styles.swatch} style={{ background: WORKSPACE_COLOR[id] }} />
              </button>
            ))}
            {/* Any color, from the system's color picker. */}
            <label className={cx(styles.lookOption, styles.customColor, shownCustom && styles.lookOn)} title="Any color">
              <span className={styles.swatch} style={{ background: shownCustom ?? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
                {!shownCustom && <Pipette aria-hidden className={styles.pipette} />}
              </span>
              <input type="color" aria-label="Pick any color" className={styles.colorInput} value={shownCustom ?? '#7c6cf2'} onChange={(e) => pickColor(e.target.value)} />
            </label>
          </div>
        </>
      )}
    </div>
  )
}
