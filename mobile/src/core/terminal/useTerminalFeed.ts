import { useCallback, useEffect, useRef, useState } from 'react'
import { call, openStream, useConnection } from '../api'
import { useTheme, type Palette } from '../theme'
import { mergeChunk } from './merge'

/** The palette's terminal colors as xterm reads them. */
const xtermTheme = (c: Palette) => {
  const t = c.terminal
  return {
    background: t.bg,
    foreground: t.fg,
    cursor: t.cursor,
    selectionBackground: t.selection,
    black: t.black,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.white,
    brightBlack: t.brightBlack,
    brightRed: t.brightRed,
    brightGreen: t.brightGreen,
    brightYellow: t.brightYellow,
    brightBlue: t.brightBlue,
    brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan,
    brightWhite: t.brightWhite
  }
}

/**
 * Feeds a terminal page (WebView on phones, iframe on the web) with one agent's
 * screen: the snapshot at the computer's own size, then only this terminal's
 * live output (ADR 0027), merged without repeats. `send` posts to the page.
 */
export const useTerminalFeed = (instanceId: string, send: (message: object) => void) => {
  const { computer, token } = useConnection()
  const { colors } = useTheme()
  const ready = useRef(false)
  const written = useRef(-1)
  const pending = useRef<{ data: string; offset: number }[]>([])
  const [loaded, setLoaded] = useState(false)
  const [generation, setGeneration] = useState(0)

  const load = useCallback(async () => {
    if (!computer || !token) return
    const snapshot = await call(computer, token, 'terminal.snapshot', { instanceId }).catch(() => null)
    if (!snapshot) return
    written.current = snapshot.end
    send({ type: 'init', cols: snapshot.cols ?? 120, rows: snapshot.rows ?? 32, theme: xtermTheme(colors), data: snapshot.data })
    for (const chunk of pending.current) {
      const next = mergeChunk(written.current, chunk.data, chunk.offset)
      written.current = next.written
      if (next.write) send({ type: 'write', data: next.write })
    }
    pending.current = []
    setLoaded(true)
  }, [computer, token, instanceId, colors, send])

  useEffect(() => {
    if (!computer || !token) return
    written.current = -1
    pending.current = []
    const stream = openStream(computer, token, instanceId, (e) => {
      if (e.event !== 'terminal.data') return
      const { data, offset } = e.payload as { data: string; offset: number }
      if (written.current < 0) return void pending.current.push({ data, offset })
      const next = mergeChunk(written.current, data, offset)
      written.current = next.written
      if (next.write) send({ type: 'write', data: next.write })
    })
    if (ready.current) void load()
    return () => stream.close()
    // Reconnects follow the computer and terminal; `load` runs once the page says it is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computer?.id, token, instanceId, generation])

  /** The page's own messages ('ready' when xterm is up). */
  const onPageMessage = useCallback(
    (raw: string): void => {
      try {
        if ((JSON.parse(raw) as { type?: string }).type !== 'ready') return
        ready.current = true
        void load()
      } catch {
        // Not ours.
      }
    },
    [load]
  )
  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  return {
    loaded,
    onPageMessage,
    reload,
    background: colors.terminal.bg
  }
}
