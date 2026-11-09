import { useMemo } from 'react'
import { cx } from '../../lib/cx'
import { diffLines } from './change-tree'
import styles from './DiffView.module.css'

const MAX_DIFF_LINES = 3000

/**
 * A unified diff, colored by line; very long ones are cut. `numbered` shows each line's old and new
 * number (the review pane, ADR 0064); `bounded` scrolls a long diff in place (the Changes tab).
 */
export function DiffView({ patch, numbered = false, bounded = false }: { patch: string; numbered?: boolean; bounded?: boolean }) {
  const lines = useMemo(() => diffLines(patch), [patch])
  if (lines.length === 0) return <p className={styles.empty}>No line changes.</p>
  return (
    <pre className={cx(styles.code, bounded && styles.bounded)}>
      {lines.slice(0, MAX_DIFF_LINES).map((line, i) =>
        line.kind === 'hunk' || line.kind === 'note' ? (
          <span key={i} className={cx(styles.line, styles[line.kind])}>
            {line.text || ' '}
            {'\n'}
          </span>
        ) : (
          <span key={i} className={cx(styles.line, styles[line.kind])}>
            {numbered && (
              <>
                <span className={styles.num} aria-hidden>
                  {line.old ?? ''}
                </span>
                <span className={styles.num} aria-hidden>
                  {line.new ?? ''}
                </span>
              </>
            )}
            <span className={styles.sign} aria-hidden>
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
            </span>
            {line.text || ' '}
            {'\n'}
          </span>
        )
      )}
      {lines.length > MAX_DIFF_LINES && <span className={cx(styles.line, styles.note)}>… {lines.length - MAX_DIFF_LINES} more lines</span>}
    </pre>
  )
}
