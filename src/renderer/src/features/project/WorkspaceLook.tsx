import { WORKSPACE_COLORS, WORKSPACE_ICONS, workspaceColor, type Project } from '@shared/domain'
import { cx } from '../../lib/cx'
import { useProjects } from '../../stores/data'
import { WORKSPACE_COLOR, WORKSPACE_ICON } from '../projects/WorkspaceMark'
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

/** The Workspace's sidebar mark: one of a few icons, in one of the theme's colors (ADR 0038). */
export function WorkspaceLook({ project }: { project: Project }) {
  const update = useProjects((s) => s.update)
  const icon = project.settings?.icon ?? 'folder'
  const color = workspaceColor(project)
  return (
    <div className={styles.look}>
      <div className={styles.lookRow} role="radiogroup" aria-label="Workspace icon">
        {WORKSPACE_ICONS.map((id) => {
          const Icon = WORKSPACE_ICON[id]
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={icon === id}
              aria-label={id}
              title={id}
              className={cx(styles.lookOption, icon === id && styles.lookOn)}
              style={{ color: WORKSPACE_COLOR[color] }}
              onClick={() => void update(project.id, { settings: { icon: id === 'folder' ? null : id } })}
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
            onClick={() => void update(project.id, { settings: { color: id } })}
          >
            <span className={styles.swatch} style={{ background: WORKSPACE_COLOR[id] }} />
          </button>
        ))}
      </div>
    </div>
  )
}
