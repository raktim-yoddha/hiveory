import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import styles from './PaneFrame.module.css'

interface PaneFrameProps {
  label: string
  children: ReactNode
  onHeaderPointerDown?: (event: ReactPointerEvent) => void
  /** Double-clicking empty header space (or the pane's name, marked data-pane-grip) toggles maximize. */
  onHeaderDoubleClick?: () => void
  highlighted?: boolean
  /** Selected though DOM focus is elsewhere: a browser page's native view has the keyboard (ADR 0043). */
  focused?: boolean
  /** Tints the frame so state reads at a glance (e.g. an agent that needs you). */
  tone?: 'waiting'
  /** The area's tab strip (ADR 0042): every pane shows its area's tabs as its header. */
  tabStrip: ReactNode
}

/** A pane surface: its area's tabs as a draggable header + content. Content-agnostic. */
export function PaneFrame({ label, children, onHeaderPointerDown, onHeaderDoubleClick, highlighted, focused, tone, tabStrip }: PaneFrameProps) {
  return (
    <section className={cx(styles.frame, highlighted && styles.highlighted)} data-tone={tone} data-focused={focused || undefined} aria-label={label}>
      <header
        className={styles.header}
        data-tabs
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest('button:not([data-pane-grip])')) onHeaderDoubleClick?.()
        }}
      >
        {tabStrip}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  )
}
