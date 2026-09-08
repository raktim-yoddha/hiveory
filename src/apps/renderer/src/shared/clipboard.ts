import { hiveoryClient } from './api/hiveory-client'

const MAX_CLIPBOARD_TEXT = 4 * 1024 * 1024

function assertClipboardSize(text: string): string {
  if (text.length > MAX_CLIPBOARD_TEXT) throw new Error('Clipboard text is larger than 4 MB.')
  return text
}

export async function readClipboardText(): Promise<string> {
  if (navigator.clipboard?.readText) {
    try {
      return assertClipboardSize(await navigator.clipboard.readText())
    } catch {
      // Tauri/WebView2 may expose the API but reject it without a user gesture.
    }
  }
  return assertClipboardSize(await hiveoryClient.readClipboardText())
}

export async function writeClipboardText(text: string): Promise<void> {
  const value = assertClipboardSize(text)
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall through to the native clipboard bridge.
    }
  }
  const written = await hiveoryClient.writeClipboardText(value)
  if (!written) throw new Error('The system clipboard could not be written.')
}

