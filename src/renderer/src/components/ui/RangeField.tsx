import { useId, useState, type CSSProperties } from 'react'
import styles from './form.module.css'

interface RangeFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Text shown beside the label, e.g. "40%". */
  format: (value: number) => string
  /** Every movement (cheap live preview). */
  onPreview?: (value: number) => void
  /** Once, when the thumb is released or a key step ends. */
  onCommit: (value: number) => void
}

/**
 * Native range slider with live preview and a single save on release, so
 * dragging never floods persistence with writes.
 */
export function RangeField({ label, value, min, max, step, format, onPreview, onCommit }: RangeFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [saved, setSaved] = useState(value)
  // A new saved value (e.g. from another window) replaces the draft.
  if (value !== saved) {
    setSaved(value)
    setDraft(value)
  }
  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }
  const fill = `${((draft - min) / (max - min)) * 100}%`
  return (
    <div className={styles.range}>
      <div className={styles.rangeHead}>
        <label htmlFor={id} className={styles.fieldLabel}>
          {label}
        </label>
        <output htmlFor={id} className={styles.rangeValue}>
          {format(draft)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className={styles.rangeInput}
        style={{ '--fill': fill } as CSSProperties}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => {
          const next = Number(e.target.value)
          setDraft(next)
          onPreview?.(next)
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  )
}
