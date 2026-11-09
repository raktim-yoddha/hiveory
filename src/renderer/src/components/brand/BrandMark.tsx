import type { IconReference } from '@shared/domain'
import { cx } from '../../lib/cx'
import styles from '../cli/CliLogo.module.css'

interface BrandMarkProps {
  icon: IconReference
  /** Its accessible name; absent, the mark is decoration beside its name. */
  label?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

/** A product's own mark (a CLI, a code editor, the file manager), as main describes it: never hardcoded in the UI. */
export function BrandMark({ icon, label, size = 'md', className }: BrandMarkProps) {
  return (
    <span className={cx(styles.logo, styles[size], className)} {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}>
      {icon.kind === 'image' ? (
        <img src={icon.src} alt="" aria-hidden draggable={false} />
      ) : icon.kind === 'svg' ? (
        <svg viewBox={icon.viewBox} aria-hidden fill={icon.color}>
          <path d={icon.path} fillRule={icon.fillRule} />
        </svg>
      ) : (
        <span className={styles.monogram} style={icon.color ? { color: icon.color } : undefined} aria-hidden>
          {icon.text}
        </span>
      )}
    </span>
  )
}
