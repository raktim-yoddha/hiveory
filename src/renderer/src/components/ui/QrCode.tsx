import { useMemo } from 'react'
import { encode } from 'uqr'
import styles from './QrCode.module.css'

/** Light margin around the code, in modules (scanners need a quiet zone). */
const QUIET = 2

/**
 * A QR code drawn as SVG, dark on a light tile in every theme so phones read it.
 * `label` names what it holds for screen readers (never the secret itself).
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { border: 0 })
    let d = ''
    qr.data.forEach((row, y) => row.forEach((on, x) => (d += on ? `M${x + QUIET} ${y + QUIET}h1v1h-1z` : '')))
    return { size: qr.size + QUIET * 2, path: d }
  }, [value])
  return (
    <svg className={styles.qr} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} className={styles.tile} />
      <path d={path} className={styles.dots} />
    </svg>
  )
}
