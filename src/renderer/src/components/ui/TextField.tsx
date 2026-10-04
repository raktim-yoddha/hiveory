import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import styles from './form.module.css'

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
}

/** Bare text input with the shared field styling. Needs an aria-label or external label. */
export function TextInput({ value, onChange, className, ...rest }: InputProps) {
  return (
    <input
      className={className ? `${styles.input} ${className}` : styles.input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
      {...rest}
    />
  )
}

interface TextFieldProps extends InputProps {
  label: string
  /** Control rendered beside the input, e.g. a regenerate button. */
  adornment?: ReactNode
}

export function TextField({ label, adornment, ...rest }: TextFieldProps) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <div className={styles.inputRow}>
        <TextInput id={id} {...rest} />
        {adornment}
      </div>
    </div>
  )
}
