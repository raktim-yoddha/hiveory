import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { ArrowUp, GitCommitHorizontal } from 'lucide-react'
import type { GitStatusView } from '@shared/ipc/contract'
import { Button } from '../../components/ui/Button'
import { api, subscribe } from '../../lib/api'
import { runAction, useNotices } from '../../stores/notices'
import styles from './ChangesPanel.module.css'

interface CommitBarProps {
  workspaceId: string
  /** Files with uncommitted changes right now. */
  changedFiles: number
  /** Called after a commit or push, so the tab reads Git again. */
  onDone: () => void
}

/**
 * The Changes tab's bottom bar (ADR 0060): a message and Commit (every change, untracked files
 * included), Commit & push, and Push for commits not on the remote yet. Ctrl/⌘+Enter commits.
 */
export function CommitBar({ workspaceId, changedFiles, onDone }: CommitBarProps) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<'commit' | 'push' | null>(null)
  const [status, setStatus] = useState<GitStatusView | null>(null)

  const readStatus = useCallback(() => {
    void api('workspaces.gitStatus', { workspaceId })
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [workspaceId])

  useEffect(() => {
    readStatus()
    return subscribe('runtime.changed', readStatus)
  }, [readStatus, changedFiles])

  const toPush = status?.branch ? (status.upstream ? status.ahead : 1) : 0
  const canCommit = changedFiles > 0 && message.trim().length > 0 && !busy

  const push = async (): Promise<void> => {
    setBusy('push')
    const pushed = await runAction('Push', () => api('changes.push', { workspaceId }))
    setBusy(null)
    if (pushed) useNotices.getState().push({ level: 'info', message: `Pushed ${pushed.branch} to ${pushed.upstream}.` })
    readStatus()
    onDone()
  }

  const commit = async (andPush: boolean): Promise<void> => {
    if (!canCommit) return
    setBusy('commit')
    const done = await runAction('Commit', () => api('changes.commit', { workspaceId, message }))
    setBusy(null)
    if (!done) return
    setMessage('')
    onDone()
    if (andPush) await push()
    else readStatus()
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void commit(event.shiftKey)
    }
  }

  if (!changedFiles && !toPush) return null
  return (
    <div className={styles.commitBar}>
      {changedFiles > 0 && (
        <textarea
          className={styles.message}
          aria-label="Commit message"
          placeholder="Commit message"
          rows={2}
          maxLength={5000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={onKey}
        />
      )}
      <div className={styles.commitActions}>
        {changedFiles > 0 && (
          <>
            <Button size="sm" variant="primary" icon={<GitCommitHorizontal />} disabled={!canCommit} loading={busy === 'commit'} onClick={() => void commit(false)} title="Commit every change (Ctrl+Enter)">
              Commit
            </Button>
            {status?.branch && (
              <Button size="sm" disabled={!canCommit} onClick={() => void commit(true)} title="Commit, then push (Ctrl+Shift+Enter)">
                Commit & push
              </Button>
            )}
          </>
        )}
        <span className={styles.flex} />
        {toPush > 0 && (
          <Button size="sm" variant={changedFiles ? 'ghost' : 'secondary'} icon={<ArrowUp />} loading={busy === 'push'} disabled={Boolean(busy)} onClick={() => void push()}>
            {status?.upstream ? `Push ${status.ahead}` : 'Publish branch'}
          </Button>
        )}
      </div>
    </div>
  )
}
