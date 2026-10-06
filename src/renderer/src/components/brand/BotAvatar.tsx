import type { CSSProperties } from 'react'
import { cx } from '../../lib/cx'
import styles from './BotAvatar.module.css'

const TILES = 6

/** A stable tile color per bot: the same id always gets the same one. */
const tileOf = (id: string): number => {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (hash % TILES) + 1
}

/** The first letters of up to two words ("Release notes" → "RN"). */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('') || '?'

/** A bot's identity tile (Bots mode). Decorative: the bot's name is always shown beside it. */
export function BotAvatar({ id, name, size = 'md' }: { id: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cx(styles.avatar, size !== 'md' && styles[size])} style={{ '--tile': `var(--bot-tile-${tileOf(id)})` } as CSSProperties} aria-hidden>
      {initials(name)}
    </span>
  )
}
