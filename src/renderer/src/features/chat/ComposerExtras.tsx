import { useEffect, useState } from 'react'
import { AppWindow, FileDiff, Loader2, Undo2 } from 'lucide-react'
import type { ChatMessage, ChatUsage } from '@shared/domain/chat'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Modal } from '../../components/ui/Modal'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import { DiffStat } from '../changes/ChangesPanel'
import { showChanges } from '../changes/changes-store'
import { shortCount } from '../changes/change-tree'
import styles from './Chat.module.css'
import composer from './Composer.module.css'

/** The newest reply that reported its context use. */
export const latestUsage = (messages: ChatMessage[]): ChatUsage | undefined => [...messages].reverse().find((m) => m.usage?.window && m.usage.used)?.usage

/** How full the model's context is (ADR 0058): a ring that fills, with the numbers on hover. */
export function ContextMeter({ usage }: { usage: ChatUsage }) {
  const share = Math.min(1, usage.used / (usage.window ?? usage.used))
  const percent = Math.round(share * 100)
  const r = 7
  const length = 2 * Math.PI * r
  const label = `Context: ${shortCount(usage.used)} of ${shortCount(usage.window ?? 0)} tokens (${percent}%)`
  return (
    <span className={composer.meter} role="img" aria-label={label} title={label} data-full={percent >= 80 || undefined}>
      <svg viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r={r} className={composer.meterTrack} />
        <circle cx="9" cy="9" r={r} className={composer.meterFill} strokeDasharray={length} strokeDashoffset={length * (1 - share)} />
      </svg>
    </span>
  )
}

/**
 * A picture of one open window, attached to the draft (ADR 0058, after T3 Code's SnapShots): pick it
 * from the windows open on this computer.
 */
export function WindowPicker({ open, onClose, onPick }: { open: boolean; onClose(): void; onPick(sourceId: string): void }) {
  return (
    <Modal open={open} title="Attach a picture of a window" onClose={onClose} width="lg">
      {open && <WindowList onClose={onClose} onPick={onPick} />}
    </Modal>
  )
}

/** Mounted while the picker is open: the windows are listed fresh each time. */
function WindowList({ onClose, onPick }: { onClose(): void; onPick(sourceId: string): void }) {
  const [windows, setWindows] = useState<Array<{ id: string; name: string; thumbnail: string }> | null>(null)
  useEffect(() => {
    let live = true
    void runAction('List windows', () => api('chat.windows')).then((list) => live && setWindows(list ?? []))
    return () => {
      live = false
    }
  }, [])
  return (
    <>
      {!windows ? (
        <p className={styles.modelNote}>
          <Loader2 className="spin" aria-hidden /> Looking for open windows…
        </p>
      ) : windows.length === 0 ? (
        <p className={styles.modelNote}>No windows to capture.</p>
      ) : (
        <ul className={composer.windows}>
          {windows.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                className={composer.windowOption}
                onClick={() => {
                  onPick(w.id)
                  onClose()
                }}
              >
                <img src={w.thumbnail} alt="" />
                <span className={composer.windowName}>
                  <AppWindow aria-hidden />
                  {w.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * What one turn changed (ADR 0058, after T3 Code's checkpoints): its files and lines, a view of its
 * own diff in the Changes tab, and Undo, which puts those files back as they were before the turn.
 */
export function TurnChanges({ chatId, message, workspaceId }: { chatId: string; message: ChatMessage; workspaceId?: string }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const checkpoint = message.checkpoint
  if (!checkpoint?.after || !checkpoint.files) return null
  const files = `${checkpoint.files} ${checkpoint.files === 1 ? 'file' : 'files'} changed`
  return (
    <div className={composer.turnChanges}>
      <FileDiff aria-hidden />
      <span>{checkpoint.reverted ? `${files} · undone` : files}</span>
      <DiffStat additions={checkpoint.additions ?? 0} deletions={checkpoint.deletions ?? 0} />
      {workspaceId && (
        <button type="button" className={composer.turnAction} onClick={() => showChanges(workspaceId, { kind: 'turn', chatId, messageId: message.id })}>
          View
        </button>
      )}
      {!checkpoint.reverted && (
        <button type="button" className={composer.turnAction} onClick={() => setConfirm(true)}>
          <Undo2 aria-hidden /> Undo
        </button>
      )}
      <ConfirmDialog
        open={confirm}
        title="Undo this turn's changes?"
        confirmLabel="Undo changes"
        danger
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setBusy(true)
          void runAction('Undo turn', () => api('chat.revertTurn', { chatId, messageId: message.id })).finally(() => {
            setBusy(false)
            setConfirm(false)
          })
        }}
      >
        <p>
          The {checkpoint.files === 1 ? 'file' : `${checkpoint.files} files`} this turn changed go back to how they were before it. Changes made to them since,
          by you or an agent, are lost too. The conversation stays as it is.
        </p>
      </ConfirmDialog>
    </div>
  )
}
