import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cx } from '../../lib/cx'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.button, styles[variant], styles[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className={styles.spin} aria-hidden /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: icon-only buttons must have an accessible name (AGENTS.md rule 20). */
  label: string
  icon: ReactNode
  size?: ButtonSize
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'sm', active, className, type = 'button', title, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx(styles.iconButton, styles[`icon-${size}`], active && styles.active, className)}
      {...rest}
    >
      {icon}
    </button>
  )
})
