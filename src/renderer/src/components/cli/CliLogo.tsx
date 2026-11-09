import type { IconReference } from '@shared/domain'
import { useClis } from '../../stores/data'
import { BrandMark } from '../brand/BrandMark'

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
  return <BrandMark icon={icon} label={name} size={size} className={className} />
}
