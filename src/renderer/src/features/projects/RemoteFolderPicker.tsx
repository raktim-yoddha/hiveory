import { useState } from 'react'
import { ArrowUp, Folder, FolderOpen, Server } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import styles from './AddProjectDialog.module.css'

export const SSH_DESTINATION = /^[A-Za-z0-9_][A-Za-z0-9._-]*(@[A-Za-z0-9_][A-Za-z0-9._-]*)?$/

interface RemoteFolderPickerProps {
  destination: string
  onDestination: (value: string) => void
  folder: string
  onFolder: (value: string) => void
}

const parentOf = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  const at = trimmed.lastIndexOf('/')
  return at <= 0 ? '/' : trimmed.slice(0, at)
}

/**
 * A folder on an SSH host (ADR 0022): the host is an alias from ~/.ssh/config or
 * user@host; Browse lists that machine's folders (installing Hiveory's host there
 * on first use), or the path can be typed (/home/me/app or ~/app).
 */
export function RemoteFolderPicker({ destination, onDestination, folder, onFolder }: RemoteFolderPickerProps) {
  const [listing, setListing] = useState<{ path: string; dirs: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const valid = SSH_DESTINATION.test(destination.trim())

  const browse = async (path?: string): Promise<void> => {
    setBusy(true)
    const result = await runAction('Browse folders', () => api('hosts.listDir', { destination: destination.trim(), path }))
    setBusy(false)
    if (!result) return
    setListing({ path: result.path, dirs: result.dirs })
    onFolder(result.path)
  }

  return (
    <>
      <TextField
        label="SSH host"
        value={destination}
        placeholder="devbox or me@build.example.com"
        onChange={(v) => {
          onDestination(v)
          setListing(null)
        }}
        adornment={<Server aria-hidden />}
      />
      <TextField
        label="Folder on that machine"
        value={folder}
        placeholder="~/projects/app or /srv/app"
        onChange={onFolder}
        adornment={
          <Button size="sm" variant="secondary" icon={<FolderOpen />} loading={busy} disabled={!valid} onClick={() => void browse(folder || '~')}>
            Browse
          </Button>
        }
      />
      {listing && (
        <ul className={styles.list} aria-label={`Folders in ${listing.path}`}>
          {listing.path !== '/' && (
            <li>
              <button type="button" className={styles.item} onClick={() => void browse(parentOf(listing.path))}>
                <span className={styles.itemTop}>
                  <ArrowUp aria-hidden /> <span className={styles.itemName}>Up to {parentOf(listing.path)}</span>
                </span>
              </button>
            </li>
          )}
          {listing.dirs.map((dir) => (
            <li key={dir}>
              <button type="button" className={styles.item} onClick={() => void browse(`${listing.path.replace(/\/+$/, '')}/${dir}`)}>
                <span className={styles.itemTop}>
                  <Folder aria-hidden /> <span className={styles.itemName}>{dir}</span>
                </span>
              </button>
            </li>
          ))}
          {listing.dirs.length === 0 && <li className={styles.none}>No folders here.</li>}
        </ul>
      )}
      <span className={styles.note}>
        Uses your own SSH setup (~/.ssh/config, keys, agent). Connect once in a terminal to trust a new host. Agents, git and files stay on that machine;
        it needs Node 20 or newer.
      </span>
    </>
  )
}
