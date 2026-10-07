import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { cx } from '../../lib/cx'
import styles from './Settings.module.css'

/** Literal swatches, so a card previews its own theme whatever the active one is. */
export interface ThemePreview {
  bg: string
  panel: string
  pane: string
  line: string
  accent: string
}

interface ThemeCardProps {
  name: string
  description: string
  preview: ThemePreview
  selected: boolean
  index: number
  onSelect: () => void
}

/** One theme as a radio card with a miniature of the app in its colors (built-in and VS Code themes alike). */
export function ThemeCard({ name, description, preview: p, selected, index, onSelect }: ThemeCardProps) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={styles.themeCard} style={{ '--i': index } as CSSProperties} onClick={onSelect}>
      <span className={styles.themePreview} style={{ background: p.bg }} aria-hidden>
        <span className={styles.previewSide} style={{ background: p.panel }}>
          <span style={{ background: p.line }} />
          <span style={{ background: p.line }} />
          <span style={{ background: p.line }} />
        </span>
        <span className={styles.previewPane} style={{ background: p.pane }}>
          <span className={styles.previewLine} style={{ background: p.line }} />
          <span className={styles.previewLine} style={{ background: p.line, width: '62%' }} />
          <span className={styles.previewBar} style={{ background: p.accent }} />
        </span>
      </span>
      <span className={styles.themeMeta}>
        <span className={styles.themeText}>
          <span className={styles.themeName}>{name}</span>
          <span className={styles.themeDescription}>{description}</span>
        </span>
        <span className={cx(styles.check, selected && styles.checkOn)} aria-hidden>
          <Check />
        </span>
      </span>
    </button>
  )
}
