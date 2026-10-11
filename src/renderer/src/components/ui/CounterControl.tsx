import { Minus, Plus } from 'lucide-react'
import styles from './form.module.css'

interface CounterControlProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max: number
  /** Names what is being counted, e.g. "Claude Code instances". */
  label: string
  /** How much each press changes it (default 1). */
  step?: number
  /** How the value reads, e.g. "18 pt". */
  format?: (value: number) => string
}

export function CounterControl({ value, onChange, min = 0, max, label, step = 1, format = String }: CounterControlProps) {
  // Whole steps only, so 1.15 + 0.01 never drifts into 1.1600000001.
  const move = (by: number): void => onChange(Math.min(max, Math.max(min, Math.round((value + by) / step) * step)))
  return (
    <div className={styles.counter} role="group" aria-label={label}>
      <button
        type="button"
        className={styles.counterButton}
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => move(-step)}
      >
        <Minus />
      </button>
      <span className={styles.counterValue} aria-live="polite">
        {format(value)}
      </span>
      <button
        type="button"
        className={styles.counterButton}
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => move(step)}
      >
        <Plus />
      </button>
    </div>
  )
}
