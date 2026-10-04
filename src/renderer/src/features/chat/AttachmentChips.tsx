import { File, FileText, Film, Image, Loader2, X } from 'lucide-react'
import type { ChatAttachment } from '@shared/domain/chat'
import styles from './Chat.module.css'

const ICONS = { image: Image, video: Film, text: FileText, file: File }

export const formatSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

interface Chip {
  key: string
  name: string
  kind: ChatAttachment['kind']
  size: number
  preview?: string
  pending?: boolean
}

/** Attachment chips: thumbnail or type icon, name and size; removable in the composer, read-only in messages. */
export function AttachmentChips({ items, onRemove }: { items: Chip[]; onRemove?: (key: string) => void }) {
  if (items.length === 0) return null
  return (
    <ul className={styles.chips} aria-label="Attachments">
      {items.map((item) => {
        const Icon = ICONS[item.kind]
        return (
          <li key={item.key} className={styles.chip} title={item.name}>
            {item.preview ? (
              <img className={styles.chipThumb} src={item.preview} alt="" />
            ) : (
              <span className={styles.chipIcon}>{item.pending ? <Loader2 className="spin" aria-hidden /> : <Icon aria-hidden />}</span>
            )}
            <span className={styles.chipText}>
              <span className={styles.chipName}>{item.name}</span>
              <span className={styles.chipMeta}>{item.pending ? 'Attaching…' : formatSize(item.size)}</span>
            </span>
            {onRemove && (
              <button type="button" className={styles.chipRemove} aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.key)}>
                <X aria-hidden />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
