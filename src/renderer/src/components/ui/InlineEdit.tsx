import { useEffect, useRef, useState } from 'react'
import styles from './InlineEdit.module.css'

interface InlineEditProps {
  value: string
  label: string
  onCommit: (value: string) => void
  onCancel: () => void
  maxLength?: number
}

/** A text field that replaces a label in place: Enter or blur saves, Escape cancels. */
export function InlineEdit({ value, label, onCommit, onCancel, maxLength = 80 }: InlineEditProps) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    const next = draft.trim()
    if (save && next && next !== value) onCommit(next)
    else onCancel()
  }

  return (
    <input
      ref={ref}
      className={styles.input}
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
    />
  )
}
