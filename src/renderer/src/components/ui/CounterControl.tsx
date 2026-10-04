import { Minus, Plus } from 'lucide-react'
import styles from './form.module.css'

interface CounterControlProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max: number
  /** Names what is being counted, e.g. "Claude Code instances". */
  label: string
}

export function CounterControl({ value, onChange, min = 0, max, label }: CounterControlProps) {
  return (
    <div className={styles.counter} role="group" aria-label={label}>
      <button
        type="button"
        className={styles.counterButton}
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus />
      </button>
      <span className={styles.counterValue} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={styles.counterButton}
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus />
      </button>
    </div>
  )
}
