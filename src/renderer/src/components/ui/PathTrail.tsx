import { useState } from 'react'
import { Check, ChevronRight, Copy, FolderOpen, House } from 'lucide-react'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { pathSegments } from '../../lib/path-segments'
import { IconButton } from './Button'
import styles from './PathTrail.module.css'

const MAX_VISIBLE = 4

interface PathTrailProps {
  path: string
  /** Lets "Open folder" reveal a known location via main (never an arbitrary path). */
  reveal?: { projectId?: string; workspaceId?: string }
}

/**
 * A folder path as a quiet breadcrumb: "⌂ › Downloads › ade-starter-docs".
 * Middle segments collapse when deep; the full path is one click to copy.
 */
export function PathTrail({ path, reveal }: PathTrailProps) {
  const [copied, setCopied] = useState(false)
  const { home, parts } = pathSegments(path)
  const visible = parts.length > MAX_VISIBLE ? [parts[0] as string, '…', ...parts.slice(-2)] : parts

  const copy = (): void => {
    void api('clipboard.writeText', { text: path }).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  return (
    <div className={styles.trail}>
      <button type="button" className={styles.crumbs} onClick={copy} title={`${path}\nClick to copy`}>
        {home && <House className={styles.home} aria-label="Home folder" />}
        {visible.map((part, i) => (
          <span key={`${part}-${i}`} className={styles.segment}>
            {(home || i > 0) && <ChevronRight className={styles.sep} aria-hidden />}
            <span className={cx(styles.part, i === visible.length - 1 && styles.last)}>{part}</span>
          </span>
        ))}
        <span className={styles.copy} aria-hidden>
          {copied ? <Check /> : <Copy />}
        </span>
        <span className="sr-only">{copied ? 'Path copied' : 'Copy path'}</span>
      </button>
      {reveal && (
        <IconButton
          label="Open folder"
          icon={<FolderOpen />}
          onClick={() => void api('system.revealPath', reveal).catch(() => undefined)}
        />
      )}
    </div>
  )
}
