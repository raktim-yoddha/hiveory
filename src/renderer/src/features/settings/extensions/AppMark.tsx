import { APP_LOGOS } from './app-logos'
import styles from './Extensions.module.css'

/** An app's official brand mark on a light tile (data URL image: no markup injection). */
export function AppMark({ id, name }: { id: string; name: string }) {
  const svg = APP_LOGOS[id]
  return (
    <span className={styles.logoTile} aria-hidden>
      {svg && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={name} draggable={false} />}
    </span>
  )
}
