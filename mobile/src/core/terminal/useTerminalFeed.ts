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
 * screen: the snapshot, then only this terminal's live output (ADR 0027), merged
 * without repeats. `send` posts to the page. The page reports the grid that fits
 * this screen; while the stream is open the computer sizes the terminal to it and
 * gives the desktop's size back when it closes (ADR 0048).
 */
export const useTerminalFeed = (instanceId: string, send: (message: object) => void) => {
  const { computer, token } = useConnection()
  const { colors } = useTheme()
  // The page's grid once it is ready ({} from a page that measures nothing).
  const [size, setSize] = useState<{ cols?: number; rows?: number } | null>(null)
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
    if (!computer || !token || !size) return
    written.current = -1
    pending.current = []
    const fit = size.cols && size.rows ? { cols: size.cols, rows: size.rows } : undefined
    const stream = openStream(
      computer,
      token,
      instanceId,
      (e) => {
        if (e.event !== 'terminal.data') return
        const { data, offset } = e.payload as { data: string; offset: number }
        if (written.current < 0) return void pending.current.push({ data, offset })
        const next = mergeChunk(written.current, data, offset)
        written.current = next.written
        if (next.write) send({ type: 'write', data: next.write })
      },
      // Once open, the computer has sized the terminal to this phone: read the screen then (and after a reconnect).
      (status) => {
        if (status !== 'online') return
        written.current = -1
        pending.current = []
        void load()
      },
      fit
    )
    return () => stream.close()
    // Reconnects follow the computer, terminal and the page's grid; `load` reads the latest theme itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computer?.id, token, instanceId, generation, size?.cols, size?.rows])

  /** The page's own messages ('ready' with its grid when xterm is up). */
  const onPageMessage = useCallback((raw: string): void => {
    try {
      const m = JSON.parse(raw) as { type?: string; cols?: number; rows?: number }
      if (m.type === 'ready') setSize({ cols: m.cols, rows: m.rows })
    } catch {
      // Not ours.
    }
  }, [])
  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  return {
    loaded,
    onPageMessage,
    reload,
    background: colors.terminal.bg
  }
}
