import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { useSelectionBox } from '../../lib/useSelectionBox'
import styles from './Tabs.module.css'

export interface TabOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  badge?: ReactNode
}

interface TabsProps<T extends string> {
  label: string
  options: TabOption<T>[]
  value: T
  onChange: (value: T) => void
  /** `underline` for page tabs, `segmented` for compact mode switches. */
  variant?: 'underline' | 'segmented'
  /** Segmented only: `lg` for a section's main switch. */
  size?: 'md' | 'lg'
  className?: string
}

/**
 * Roving-focus tablist used for page tabs and segmented controls alike. The
 * selection is one indicator that glides to the chosen tab (transform and
 * width only), instead of each tab painting its own background.
 */
export function Tabs<T extends string>({ label, options, value, onChange, variant = 'underline', size = 'md', className }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const indicator = useSelectionBox(listRef, '[aria-selected="true"]', [value, options.length])

  const onKeyDown = (event: KeyboardEvent): void => {
    const index = options.findIndex((o) => o.value === value)
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const next = options[(index + delta + options.length) % options.length]
    if (!next) return
    onChange(next.value)
    listRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
  }

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={cx(styles.list, styles[variant], size === 'lg' && styles.lg, className)} onKeyDown={onKeyDown}>
      {indicator && <span className={styles.indicator} aria-hidden style={indicator} />}
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            data-value={option.value}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cx(styles.tab, selected && styles.selected)}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label}
            {option.badge}
          </button>
        )
      })}
    </div>
  )
}
