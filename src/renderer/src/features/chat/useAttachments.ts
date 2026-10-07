import { useCallback, useState } from 'react'
import type { ChatAttachment } from '@shared/domain/chat'
import { api } from '../../lib/api'
import { reportError } from '../../stores/notices'

/** Pasted text longer than this becomes an attachment (CLIs take prompts on the command line). */
export const LONG_TEXT_CHARS = 4000
/** In-memory pastes (screenshots, clips) are uploaded to main; larger ones are refused. */
const MAX_PASTE_BYTES = 25 * 1024 * 1024
/** Images up to this size get an inline thumbnail. */
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024

export interface PendingAttachment {
  key: string
  name: string
  kind: ChatAttachment['kind']
  size: number
  /** data: URL thumbnail for images. */
  preview?: string
  /** Set once main has accepted the file. */
  attachment?: ChatAttachment
}

const kindOf = (file: File): ChatAttachment['kind'] =>
  file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('text/') ? 'text' : 'file'

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsDataURL(blob)
  })

export const base64Of = async (blob: Blob): Promise<string> => (await readAsDataUrl(blob)).split(',')[1] ?? ''

let counter = 0
let pastedTexts = 0

/**
 * Attachments for one chat: files from disk are sent by path; pasted data
 * (screenshots, clips, long text) is saved by main first. Every CLI then reads
 * them by path — or natively, where the CLI supports images/files.
 */
export function useAttachments(chatId: string) {
  const [items, setItems] = useState<PendingAttachment[]>([])

  const add = useCallback(
    async (pending: Omit<PendingAttachment, 'key'>, upload: () => Promise<ChatAttachment>): Promise<void> => {
      const key = `a${++counter}`
      setItems((list) => [...list, { ...pending, key }])
      try {
        const attachment = await upload()
        setItems((list) => list.map((item) => (item.key === key ? { ...item, attachment, name: attachment.name, kind: attachment.kind, size: attachment.size } : item)))
      } catch (error) {
        setItems((list) => list.filter((item) => item.key !== key))
        reportError(error, 'Attach file')
      }
    },
    []
  )

  const addFiles = useCallback(
    (files: File[]): void => {
      for (const file of files) {
        const path = window.hiveory.pathForFile(file)
        const kind = kindOf(file)
        void (async () => {
          const preview = kind === 'image' && file.size <= MAX_PREVIEW_BYTES ? await readAsDataUrl(file).catch(() => undefined) : undefined
          if (path) {
            await add({ name: file.name, kind, size: file.size, preview }, () => api('chat.attachPath', { chatId, path }))
            return
          }
          if (file.size > MAX_PASTE_BYTES) {
            reportError(new Error('Pasted data larger than 25 MB cannot be attached. Save it to a file and drop the file instead.'), 'Attach file')
            return
          }
          // Screenshots arrive as a nameless "image.png"; main adds the extension from the type.
          const name = file.name && file.name !== 'image.png' ? file.name : `pasted-${kind}`
          await add({ name, kind, size: file.size, preview }, async () =>
            api('chat.attach', { chatId, name, mime: file.type, data: await base64Of(file) })
          )
        })()
      }
    },
    [add, chatId]
  )

  const addText = useCallback(
    (text: string): void => {
      const name = `pasted-text-${++pastedTexts}.txt`
      const blob = new Blob([text], { type: 'text/plain' })
      void add({ name, kind: 'text', size: blob.size }, async () =>
        api('chat.attach', { chatId, name, mime: 'text/plain', data: await base64Of(blob) })
      )
    },
    [add, chatId]
  )

  const remove = useCallback((key: string) => setItems((list) => list.filter((item) => item.key !== key)), [])
  const clear = useCallback(() => setItems([]), [])

  const ready = items.every((item) => item.attachment)
  const attachments = items.flatMap((item) => (item.attachment ? [item.attachment] : []))
  return { items, attachments, ready, addFiles, addText, remove, clear }
}
