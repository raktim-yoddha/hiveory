import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import styles from './form.module.css'

interface SelectProps {
  label: string
  value: string
  options: Array<{ value: string; label: string; disabled?: boolean }>
  onChange: (value: string) => void
  /** Hide the visible label (still announced to assistive tech). */
  hideLabel?: boolean
}

/** Styled native select: keyboard, screen-reader and type-ahead behaviour come for free. */
export function Select({ label, value, options, onChange, hideLabel }: SelectProps) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : styles.fieldLabel}>
        {label}
      </label>
      <div className={styles.selectWrap}>
        <select id={id} className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className={styles.selectIcon} aria-hidden />
      </div>
    </div>
  )
}
