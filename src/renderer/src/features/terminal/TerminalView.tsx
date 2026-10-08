import { useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { attachTerminal, fitTerminal } from './terminal-registry'
import styles from './TerminalView.module.css'

/** Settle time after the last size change before re-fitting; pane animations resize continuously. */
const FIT_DEBOUNCE_MS = 60

interface TerminalViewProps {
  instanceId: string
  /** The CLI's measured layout needs (from the CLI registry); absent: it adapts to any size. */
  minColumns?: number
  minRows?: number
}

/** Hosts an agent's persistent terminal and keeps it fitted to the pane. */
export function TerminalView({ instanceId, minColumns = 0, minRows = 0 }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)

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

  return <div ref={hostRef} className={styles.host} />
}
