import { useState } from 'react'
import { cx } from '../../lib/cx'
import styles from './InlineRename.module.css'

interface InlineRenameProps {
  value: string
  label: string
  maxLength?: number
  /** Called with the trimmed new name when it differs; Enter or leaving the field commits it. */
  onCommit: (name: string) => void
  onDone: () => void
  className?: string
}

/** A name edited in place (a pane or tab title): Enter saves, Escape cancels, all text selected to start. */
export function InlineRename({ value, label, maxLength = 32, onCommit, onDone, className }: InlineRenameProps) {
  const [draft, setDraft] = useState(value)
  const finish = (save: boolean): void => {
    const next = draft.trim()
    if (save && next && next !== value) onCommit(next)
    onDone()
  }
  return (
    <input
      className={cx(styles.input, className)}
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
      }}
    />
  )
}
