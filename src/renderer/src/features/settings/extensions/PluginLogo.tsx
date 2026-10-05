import { cx } from '../../../lib/cx'
import { PLUGIN_LOGOS } from './plugin-logos'
import styles from './Extensions.module.css'

/** The official brand mark on a light tile (data URL image: no markup injection). */
export function PluginLogo({ id, name, large }: { id: string; name: string; large?: boolean }) {
  const svg = PLUGIN_LOGOS[id]
  return (
    <span className={cx(styles.logoTile, large && styles.logoLarge)} aria-hidden>
      {svg && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={name} draggable={false} />}
    </span>
  )
}
