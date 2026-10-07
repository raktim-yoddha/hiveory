import { useState } from 'react'
import { Check, ChevronRight, Copy, FolderOpen, HardDrive, House, Layers } from 'lucide-react'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { pathSegments, type PathRoot } from '../../lib/path-segments'
import styles from './PathTrail.module.css'

const MAX_VISIBLE = 4

const ROOT: Record<NonNullable<PathRoot> | 'none', { icon: typeof House; label: string }> = {
  home: { icon: House, label: 'Home folder' },
  workspaces: { icon: Layers, label: 'Hiveory worktree folder' },
  none: { icon: HardDrive, label: 'Drive' }
}

interface PathTrailProps {
  path: string
  /** Lets "Open folder" reveal a known location via main (never an arbitrary path). */
  reveal?: { projectId?: string; workspaceId?: string }
}

/**
 * A folder path as one compact, machined control: a root chip (home, drive or
 * a Hiveory-managed workspace), the meaningful folders, then copy / open.
 * Long paths collapse their middle; in a narrow container only the last folder
 * stays, so it reads well even in the side panel. The full path is in the tooltip.
 */
export function PathTrail({ path, reveal }: PathTrailProps) {
  const [copied, setCopied] = useState(false)
  const { root, parts } = pathSegments(path)
  const visible = parts.length > MAX_VISIBLE ? [parts[0] as string, '…', ...parts.slice(-2)] : parts
  const Root = ROOT[root ?? 'none']
  // A drive letter is implied by the chip (and spelled out in the tooltip).
  const crumbs = !root && /^[A-Za-z]:$/.test(visible[0] ?? '') ? visible.slice(1) : visible

  const copy = (): void => {
    void api('clipboard.writeText', { text: path }).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  return (
    <div className={styles.trail}>
      <div className={styles.pill}>
        <button type="button" className={styles.crumbs} onClick={copy} title={`${path}\nClick to copy`}>
          <span className={styles.root} aria-label={Root.label}>
            {copied ? <Check aria-hidden /> : <Root.icon aria-hidden />}
          </span>
          {crumbs.map((part, i) => {
            const last = i === crumbs.length - 1
            return (
              <span key={`${part}-${i}`} className={cx(styles.segment, !last && styles.middle)}>
                {last && i > 0 && (
                  <span className={styles.collapsed} aria-hidden>
                    …
                  </span>
                )}
                {i > 0 && <ChevronRight className={styles.sep} aria-hidden />}
                <span className={cx(styles.part, last && styles.last)}>{part}</span>
              </span>
            )
          })}
          <span className="sr-only">{copied ? 'Path copied' : 'Copy path'}</span>
        </button>
        <span className={styles.divider} aria-hidden />
        <button type="button" className={styles.action} onClick={copy} aria-label="Copy path" title="Copy path">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </button>
        {reveal && (
          <button
            type="button"
            className={styles.action}
            aria-label="Open folder"
            title="Open folder"
            onClick={() => void api('system.revealPath', reveal).catch(() => undefined)}
          >
            <FolderOpen aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
