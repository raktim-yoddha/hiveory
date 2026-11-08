import { useEffect, useRef, useState, type DragEvent } from 'react'
import { cx } from '../../lib/cx'
import { useNotices } from '../../stores/notices'
import { droppedPathsText } from './drop-paths'
import '@xterm/xterm/css/xterm.css'
import { attachTerminal, fitTerminal, pasteIntoTerminal } from './terminal-registry'
import styles from './TerminalView.module.css'

/** Settle time after the last size change before re-fitting; pane animations resize continuously. */
const FIT_DEBOUNCE_MS = 60

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
}

/** Hosts an agent's persistent terminal and keeps it fitted to the pane. */
export function TerminalView({ instanceId, minColumns = 0, minRows = 0, dropFiles = false }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
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
    const detach = attachTerminal(instanceId, host, { minColumns, minRows })
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
  }, [instanceId, minColumns, minRows])

  return (
    <div
      ref={hostRef}
      className={cx(styles.host, over && dropFiles && styles.dropping)}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={onDrop}
    />
  )
}
