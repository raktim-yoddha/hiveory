import type { IconReference } from '@shared/domain'
import { CLI_ICONS } from './icon-data'

/** Official mark for a CLI; a neutral monogram only if none is bundled. */
export const officialIcon = (id: string, fallback: string): IconReference =>
  CLI_ICONS[id] ? { kind: 'image', src: CLI_ICONS[id] } : { kind: 'monogram', text: fallback }
