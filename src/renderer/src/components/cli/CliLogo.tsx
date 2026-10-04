import type { IconReference } from '@shared/domain'
import { useClis } from '../../stores/data'
import { cx } from '../../lib/cx'
import styles from './CliLogo.module.css'

interface CliLogoProps {
  cliId: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const FALLBACK: IconReference = { kind: 'monogram', text: '?' }

/**
 * The CLI's logo is its primary identity (STARTER_PROMPT §6). Icon data comes
 * from the main-process registry, so the UI never hardcodes providers.
 */
export function CliLogo({ cliId, size = 'md', className }: CliLogoProps) {
  const cli = useClis((s) => s.clis.find((c) => c.id === cliId))
  const icon = cli?.icon ?? FALLBACK
  const name = cli?.displayName ?? cliId
  return (
    <span className={cx(styles.logo, styles[size], className)} role="img" aria-label={name} title={name}>
      {icon.kind === 'image' ? (
        <img src={icon.src} alt="" aria-hidden draggable={false} />
      ) : icon.kind === 'svg' ? (
        <svg viewBox={icon.viewBox} aria-hidden fill={icon.color}>
          <path d={icon.path} />
        </svg>
      ) : (
        <span className={styles.monogram} style={icon.color ? { color: icon.color } : undefined} aria-hidden>
          {icon.text}
        </span>
      )}
    </span>
  )
}
