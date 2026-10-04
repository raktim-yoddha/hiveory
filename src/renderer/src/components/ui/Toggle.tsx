import styles from './form.module.css'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  id?: string
}

export function Toggle({ checked, onChange, label, disabled, id }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.toggle}
      onClick={() => onChange(!checked)}
    />
  )
}
