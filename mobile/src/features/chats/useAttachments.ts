import { useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import type { ChatAttachment } from '@shared/domain/chat'
import { useAction } from '@/core/api'
import { useNotices } from '@/core/notices'

/** The computer keeps at most this much per attachment (chat.attach). */
const MAX_BYTES = 25 * 1024 * 1024

/**
 * Files from the phone for the next message (ADR 0053): picked with the system's file picker, copied
 * to the computer (chat.attach), and sent with the message by path, as the desktop's attachments are.
 */
export const useAttachments = (chatId: string) => {
  const attach = useAction('chat.attach')
  const [files, setFiles] = useState<ChatAttachment[]>([])

  const pick = async (): Promise<void> => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
    const asset = result.canceled ? undefined : result.assets[0]
    if (!asset) return
    if ((asset.size ?? 0) > MAX_BYTES) {
      useNotices.getState().push({ level: 'error', message: `${asset.name} is over 25 MB.` })
      return
    }
    const data = await new File(asset.uri).base64()
    attach.mutate({ chatId, name: asset.name.slice(0, 200), mime: (asset.mimeType ?? 'application/octet-stream').slice(0, 100), data }, { onSuccess: (file) => setFiles((now) => [...now, file]) })
  }

  return { files, pick, busy: attach.isPending, remove: (path: string) => setFiles((now) => now.filter((f) => f.path !== path)), clear: () => setFiles([]) }
}
