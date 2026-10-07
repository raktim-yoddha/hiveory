import EventSource from 'react-native-sse'
import { baseUrl, type Computer } from './client'
import type { ServerEvent } from './contract'

const FIRST_RETRY_MS = 1000
const MAX_RETRY_MS = 20_000

export type StreamStatus = 'connecting' | 'online' | 'offline'

export interface Stream {
  close(): void
  /** Reconnect now (the app came back to the foreground). */
  retry(): void
}

/**
 * One live event stream from a computer, reconnecting with backoff while it
 * is open. `terminal` narrows it (ADR 0027): 'none' = everything but terminal
 * output (the app's main stream), an instance id = that terminal's output only.
 */
export const openStream = (
  computer: Computer,
  token: string,
  terminal: string,
  onEvent: (event: ServerEvent) => void,
  onStatus: (status: StreamStatus) => void = () => undefined
): Stream => {
  let source: EventSource | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let delay = FIRST_RETRY_MS
  let closed = false

  const connect = (): void => {
    if (closed) return
    onStatus('connecting')
    const es = new EventSource(`${baseUrl(computer)}/events?terminal=${encodeURIComponent(terminal)}`, {
      headers: { authorization: `Bearer ${token}` },
      // Reconnects are ours (with backoff and status), not the library's fixed interval.
      pollingInterval: 0
    })
    source = es
    es.addEventListener('open', () => {
      delay = FIRST_RETRY_MS
      onStatus('online')
    })
    es.addEventListener('message', (e) => {
      if (!e.data) return
      try {
        onEvent(JSON.parse(e.data) as ServerEvent)
      } catch {
        // A malformed frame is skipped; the next one is independent.
      }
    })
    es.addEventListener('error', () => {
      es.removeAllEventListeners()
      es.close()
      if (closed || source !== es) return
      onStatus('offline')
      timer = setTimeout(connect, delay)
      delay = Math.min(MAX_RETRY_MS, delay * 2)
    })
  }

  connect()
  return {
    close: () => {
      closed = true
      if (timer) clearTimeout(timer)
      source?.removeAllEventListeners()
      source?.close()
    },
    retry: () => {
      if (closed) return
      if (timer) clearTimeout(timer)
      source?.removeAllEventListeners()
      source?.close()
      delay = FIRST_RETRY_MS
      connect()
    }
  }
}
