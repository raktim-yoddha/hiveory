import { useEffect, useState } from 'react'
import { Download, Rocket, X } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { api } from '../../lib/api'
import { UPDATE_INTERVAL_MS, updateOverdue } from '@shared/domain'
import { useSettings, useUpdates } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { releaseHighlights } from './release-notes'
import styles from './UpdatePrompt.module.css'

const RELEASES = 'https://github.com/raktim-yoddha/hiveory/releases'

/** How often a dismissed reminder is re-checked. */
const TICK_MS = 60_000

/**
 * Pop-up when an update is found, downloading or ready. "Later" hides it for that version this session —
 * unless it is overdue (two days after its release): then it returns after Settings › Updates › Remind me
 * (ADR 0039). A downloaded update still installs on quit, and Settings → Updates always shows the state.
 */
export function UpdatePrompt() {
  const { status, load } = useUpdates()
  const remindEvery = useSettings((s) => s.settings.updateRemindEvery)
  const [dismissed, setDismissed] = useState<{ version: string; at: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'downloaded') return null
  const due = updateOverdue(status.releaseDate, now) && dismissed !== null && now - dismissed.at >= UPDATE_INTERVAL_MS[remindEvery]
  if (dismissed?.version === status.version && !due) return null
  const later = () => setDismissed({ version: status.version, at: Date.now() })
  const notes = releaseHighlights(status.notes)

  return (
    <section className={styles.card} role="dialog" aria-labelledby="update-title" aria-describedby="update-detail">
      <div className={styles.head}>
        <h2 id="update-title" className={styles.title}>
          {status.state === 'downloaded' ? `Hiveory ${status.version} is ready` : `Hiveory ${status.version} is available`}
        </h2>
        <IconButton label="Close" icon={<X />} onClick={later} />
      </div>
      <p id="update-detail" className={styles.detail}>
        {status.state === 'available' && 'A new version is out.'}
        {status.state === 'downloading' && `Downloading… ${status.percent}%`}
        {status.state === 'downloaded' && 'Restart to finish updating, or it installs when you quit.'}
      </p>
      {status.state === 'downloading' && (
        <div className={styles.progress} role="progressbar" aria-label="Download progress" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.bar} style={{ width: `${status.percent}%` }} />
        </div>
      )}
      {notes.length > 0 && (
        <ul className={styles.notes}>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <a className={styles.link} href={`${RELEASES}/tag/v${status.version}`} target="_blank" rel="noreferrer">
          What's new
        </a>
        <Button variant="ghost" onClick={later}>
          Later
        </Button>
        {status.state === 'available' && (
          <Button variant="primary" icon={<Download />} onClick={() => void runAction('Download update', () => api('updates.download'))}>
            Download
          </Button>
        )}
        {status.state === 'downloaded' && (
          <Button variant="primary" icon={<Rocket />} onClick={() => void runAction('Install update', () => api('updates.install'))}>
            Restart and update
          </Button>
        )}
      </div>
    </section>
  )
}
