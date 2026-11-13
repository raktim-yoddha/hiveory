import { useEffect, useRef, useState, type DragEvent } from 'react'
import { cx } from '../../lib/cx'
import { useNotices } from '../../stores/notices'
import { droppedPathsText } from './drop-paths'
import type { TerminalLink } from './terminal-links'
import '@xterm/xterm/css/xterm.css'
import { attachTerminal, fitTerminal, pasteIntoTerminal, setTerminalConcealed, terminalSearch } from './terminal-registry'
import { onTerminalFindRequest } from './terminal-search'
import { TerminalFindBar } from './TerminalFindBar'
import styles from './TerminalView.module.css'

/** Settle time after the last size change before re-fitting; pane animations resize continuously. */
const FIT_DEBOUNCE_MS = 60

const firstLine = (text: string): string => text.split(/\r?\n/)[0] ?? ''

interface TerminalViewProps {
  instanceId: string
  /** The CLI's measured layout needs (from the CLI registry); absent: it adapts to any size. */
  minColumns?: number
  minRows?: number
  /**
   * Files dropped here type their paths (ADR 0061), quoted for this platform's shells; false where the
   * terminal runs on another machine, whose files these are not.
   */
  dropFiles?: 'windows' | 'posix' | false
  /** Opens a Ctrl/⌘-clicked link in the output; without it, links are plain text. */
  onLink?: (link: TerminalLink) => void
  /** Mounted but out of sight (a background tab): output then marks its tab. */
  concealed?: boolean
}

/** Hosts an agent's persistent terminal and keeps it fitted to the pane. */
export function TerminalView({ instanceId, minColumns = 0, minRows = 0, dropFiles = false, onLink, concealed = false }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef(onLink)
  useEffect(() => {
    linkRef.current = onLink
  })
  const linkable = Boolean(onLink)
  const [over, setOver] = useState(false)
  // The find bar (ADR 0072): open, the text it started with, and a counter that refocuses it.
  const [find, setFind] = useState<{ seed: string; focusKey: number } | null>(null)
  useEffect(
    () =>
      onTerminalFindRequest(instanceId, () =>
        setFind((open) => ({ seed: open?.seed ?? firstLine(terminalSearch(instanceId)?.term.getSelection() ?? ''), focusKey: (open?.focusKey ?? 0) + 1 }))
      ),
    [instanceId]
  )
  const hasFiles = (e: DragEvent): boolean => [...e.dataTransfer.types].includes('Files')
  const onDragOver = (e: DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = dropFiles ? 'copy' : 'none'
    if (!over) setOver(true)
  }
  const onDrop = (e: DragEvent): void => {
    setOver(false)
    if (!hasFiles(e)) return
    e.preventDefault()
    if (!dropFiles) {
      useNotices.getState().push({ level: 'warning', message: 'This terminal runs on another machine: files from this computer are not there.' })
      return
    }
    const text = droppedPathsText([...e.dataTransfer.files].map((f) => window.hiveory.pathForFile(f)), dropFiles)
    if (text) pasteIntoTerminal(instanceId, text)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const detach = attachTerminal(instanceId, host, { minColumns, minRows }, linkable ? (link) => linkRef.current?.(link) : undefined)
    let timer: ReturnType<typeof setTimeout> | undefined
    // One trailing fit per resize burst: the TUI redraws once, at its final size.
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => fitTerminal(instanceId), FIT_DEBOUNCE_MS)
    })
    observer.observe(host)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
      detach()
    }
  }, [instanceId, minColumns, minRows, linkable])

  useEffect(() => setTerminalConcealed(instanceId, concealed), [instanceId, concealed])

  return (
    <>
      <div
        ref={hostRef}
        className={cx(styles.host, over && dropFiles && styles.dropping)}
        onDragOver={onDragOver}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
        onDrop={onDrop}
      />
      {find && <TerminalFindBar instanceId={instanceId} seed={find.seed} focusKey={find.focusKey} onClose={() => setFind(null)} />}
    </>
  )
}
