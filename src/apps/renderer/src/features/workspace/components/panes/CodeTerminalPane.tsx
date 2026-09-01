import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { AlertTriangle, RotateCw, ShieldCheck, ShieldOff } from 'lucide-react'
import {
  hiveoryClient,
  type CodeTerminalEvent,
  type CodeTerminalSummary,
} from '../../../../shared/api/hiveory-client'

interface CodeTerminalPaneProps {
  terminalId: string
  summary?: CodeTerminalSummary
  onRelaunch?: () => void
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function formatTerminalError(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    for (const key of ['message', 'error', 'detail']) {
      if (typeof value[key] === 'string') return value[key] as string
    }
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function isExpectedInactiveError(error: unknown): boolean {
  return /terminal (was )?not found|no such process|session (is )?(closed|inactive)|invalid handle|already exited/i.test(formatTerminalError(error))
}

export const CodeTerminalPane: React.FC<CodeTerminalPaneProps> = ({
  terminalId,
  summary,
  onRelaunch,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const summaryRef = useRef(summary)
  summaryRef.current = summary
  const [isInterrupted, setIsInterrupted] = useState(
    summary?.state === 'interrupted' || summary?.state === 'failed' || summary?.state === 'exited' || summary?.state === 'dormant',
  )
  const [transportError, setTransportError] = useState<string | null>(null)
  const [historyEnabled, setHistoryEnabled] = useState(true)
  const [historyBusy, setHistoryBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    setHistoryEnabled(true)
    void hiveoryClient.getCodeTerminalHistoryEnabled(terminalId)
      .then((enabled) => {
        if (mounted) setHistoryEnabled(enabled)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [terminalId])

  useEffect(() => {
    setIsInterrupted(
      summary?.state === 'interrupted' || summary?.state === 'failed' || summary?.state === 'exited' || summary?.state === 'dormant',
    )
  }, [summary?.state])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let snapshotReady = false
    let lastSequence = 0
    let resyncPromise: Promise<void> | null = null
    let pendingEvents: CodeTerminalEvent[] = []
    let sessionActive = !summaryRef.current || summaryRef.current.state === 'starting' || summaryRef.current.state === 'running'
    const canAttach = !summaryRef.current || summaryRef.current.state === 'starting' || summaryRef.current.state === 'running'

    const term = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "'JetBrains Mono', Consolas, 'Cascadia Code', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 10_000,
      theme: {
        background: '#0b0b0c',
        foreground: '#f3f4f6',
        cursor: '#f3f4f6',
        selectionBackground: 'rgba(92, 136, 255, 0.32)',
        black: '#202124',
        red: '#f4777f',
        green: '#9ad68a',
        yellow: '#f2c777',
        blue: '#8fb7ff',
        magenta: '#d1a8ff',
        cyan: '#7fd5d2',
        white: '#f3f4f6',
        brightBlack: '#7b8088',
        brightRed: '#ff8e95',
        brightGreen: '#b1e99d',
        brightYellow: '#ffdc8a',
        brightBlue: '#aac7ff',
        brightMagenta: '#e0c3ff',
        brightCyan: '#9be8e4',
        brightWhite: '#ffffff',
      },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    termRef.current = term
    fitAddonRef.current = fitAddon

    const fit = () => {
      if (disposed || !fitAddonRef.current || !termRef.current) return
      try {
        fitAddonRef.current.fit()
      } catch {
        // xterm can be measured before the pane has entered the layout tree.
      }
    }
    window.requestAnimationFrame(fit)

    const writeSnapshot = (outputBase64: string) => {
      if (!outputBase64 || disposed) return
      try {
        term.write(decodeBase64(outputBase64))
      } catch {
        setTransportError('The terminal output could not be decoded.')
      }
    }

    const writeEventOutput = (event: CodeTerminalEvent) => {
      if (event.kind !== 'output' || !event.data_base64) return
      try {
        term.write(decodeBase64(event.data_base64))
      } catch {
        setTransportError('The terminal output could not be decoded.')
      }
    }

    const handleEvent = (event: CodeTerminalEvent) => {
      if (disposed || event.sequence <= lastSequence) return
      if (event.sequence > lastSequence + 1) {
        pendingEvents.push(event)
        if (!resyncPromise) {
          resyncPromise = hiveoryClient.getCodeTerminalSnapshot(terminalId)
            .then((snapshot) => {
              if (disposed) return
              term.reset()
              writeSnapshot(snapshot.output_base64)
              lastSequence = snapshot.sequence
              const queued = pendingEvents
              pendingEvents = []
              queued.sort((left, right) => left.sequence - right.sequence).forEach(handleEvent)
            })
            .catch((error: unknown) => {
              if (!isExpectedInactiveError(error)) {
                setTransportError(`Terminal resync failed: ${formatTerminalError(error)}`)
              }
            })
            .finally(() => {
              resyncPromise = null
            })
        }
        return
      }

      writeEventOutput(event)
      lastSequence = event.sequence
      if (event.kind === 'error') {
        setTransportError(event.message || 'The terminal reported an error.')
      }
      if (event.kind === 'exited') {
        sessionActive = false
        setIsInterrupted(true)
        term.writeln(`\r\n\x1b[90m[process exited with code ${event.exit_code ?? 0}]\x1b[0m\r\n`)
      }
    }

    const unsubscribe = canAttach
      ? hiveoryClient.subscribeCodeTerminalEvents(
          terminalId,
          0,
          (event) => {
            if (!snapshotReady || resyncPromise) {
              pendingEvents.push(event)
              return
            }
            handleEvent(event)
          },
        )
      : () => undefined

    if (canAttach) {
      void hiveoryClient.getCodeTerminalSnapshot(terminalId)
        .then((snapshot) => {
          if (disposed) return
          writeSnapshot(snapshot.output_base64)
          lastSequence = snapshot.sequence
          snapshotReady = true
          const queued = pendingEvents
          pendingEvents = []
          queued.sort((left, right) => left.sequence - right.sequence).forEach(handleEvent)
          fit()
        })
        .catch((error: unknown) => {
          snapshotReady = true
          if (!isExpectedInactiveError(error)) {
            setTransportError(`Unable to attach to terminal: ${formatTerminalError(error)}`)
          }
        })
    } else {
      snapshotReady = true
    }

    const dataListener = term.onData((data) => {
      if (!sessionActive) return
      void hiveoryClient.writeCodeTerminal({ terminal_id: terminalId, data })
        .then(() => setTransportError(null))
        .catch((error: unknown) => {
          if (!isExpectedInactiveError(error)) {
            setTransportError(`Input was not sent: ${formatTerminalError(error)}`)
          }
        })
    })

    const resize = () => {
      fit()
      if (!sessionActive || !termRef.current || disposed) return
      const bounds = container.getBoundingClientRect()
      if (bounds.width < 4 || bounds.height < 4) return
      const cols = Math.max(1, Math.min(500, termRef.current.cols))
      const rows = Math.max(1, Math.min(500, termRef.current.rows))
      const dimensions = `${cols}x${rows}`
      if (dimensions === lastDimensions) return
      lastDimensions = dimensions
      void hiveoryClient.resizeCodeTerminal({
        terminal_id: terminalId,
        cols,
        rows,
      }).then((resized) => {
        if (!resized) {
          sessionActive = false
          setIsInterrupted(true)
        }
      }).catch((error: unknown) => {
        if (!isExpectedInactiveError(error)) {
          setTransportError(`Terminal resize failed: ${formatTerminalError(error)}`)
        }
      })
    }
    let lastDimensions: string | null = null
    let resizeTimer: number | null = null
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(resize, 120)
    })
    resizeObserver?.observe(container)
    window.requestAnimationFrame(resize)

    return () => {
      disposed = true
      snapshotReady = false
      dataListener.dispose()
      unsubscribe()
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      resizeObserver?.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [terminalId, summary?.state])

  const toggleHistory = async () => {
    if (historyBusy) return
    const nextValue = !historyEnabled
    setHistoryEnabled(nextValue)
    setHistoryBusy(true)
    try {
      await hiveoryClient.setCodeTerminalHistoryEnabled({ terminal_id: terminalId, enabled: nextValue })
    } catch (error: unknown) {
      setHistoryEnabled(!nextValue)
      setTransportError(`History setting could not be saved: ${formatTerminalError(error)}`)
    } finally {
      setHistoryBusy(false)
    }
  }

  return (
    <div className="code-terminal-pane">
      {isInterrupted && (
        <div className="code-terminal-notice" role="status">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>
            {summary?.state === 'dormant'
              ? 'Session ended when the app closed'
              : summary?.state === 'exited'
                ? 'Session ended'
                : 'Session ended or interrupted'}
          </span>
          {onRelaunch && (
            <button type="button" onClick={onRelaunch}>
              <RotateCw size={11} aria-hidden="true" />
              Relaunch
            </button>
          )}
        </div>
      )}
      {transportError && (
        <div className="code-terminal-error" role="alert">
          <span>{transportError}</span>
          <button type="button" onClick={() => setTransportError(null)} aria-label="Dismiss terminal error">×</button>
        </div>
      )}
      <div ref={containerRef} className="code-terminal-container" aria-label="Interactive terminal" />
      <div className="code-terminal-history-control">
        {historyEnabled ? <ShieldCheck size={12} aria-hidden="true" /> : <ShieldOff size={12} aria-hidden="true" />}
        <label>
          <input
            type="checkbox"
            checked={historyEnabled}
            disabled={historyBusy}
            onChange={() => void toggleHistory()}
          />
          <span>{historyEnabled ? 'Save encrypted terminal history' : 'Terminal history is off'}</span>
        </label>
      </div>
    </div>
  )
}
