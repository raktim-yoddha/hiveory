import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../lib/cx'
import { Menu, type MenuEntry } from './Menu'
import styles from './SplitButton.module.css'

interface SplitButtonProps {
  /** What the main half does; absent, the whole button opens the menu. */
  onClick?: () => void
  icon: ReactNode
  /** Shown beside the icon; absent, the main half is icon only (then `title` names it). */
  label?: string
  title: string
  /** The menu's accessible name and its items. */
  menuLabel: string
  items: MenuEntry[]
  primary?: boolean
  disabled?: boolean
  loading?: boolean
  className?: string
}

/** An action with its options beside it: the main half runs it, the chevron opens the menu. */
export function SplitButton({ onClick, icon, label, title, menuLabel, items, primary, disabled, loading, className }: SplitButtonProps) {
  return (
    <span className={cx(styles.split, primary && styles.primary, className)}>
      {onClick && (
        <button type="button" className={cx(styles.main, !label && styles.iconOnly)} onClick={onClick} disabled={disabled || loading} title={title} aria-label={label ? undefined : title}>
          <span className={cx(styles.icon, loading && 'spin')} aria-hidden>
            {icon}
          </span>
          {label && (
            <span className={styles.label} data-split-label>
              {label}
            </span>
          )}
        </button>
      )}
      <Menu
        label={menuLabel}
        align="end"
        items={items}
        trigger={(props) => (
          <button type="button" {...props} className={cx(styles.more, !onClick && styles.alone)} title={onClick ? `More: ${menuLabel}` : title} aria-label={onClick ? `More: ${menuLabel}` : title}>
            {!onClick && (
              <span className={styles.icon} aria-hidden>
                {icon}
              </span>
            )}
            {!onClick && label && <span className={styles.label}>{label}</span>}
            <ChevronDown aria-hidden className={styles.chevron} />
          </button>
        )}
      />
    </span>
  )
}
