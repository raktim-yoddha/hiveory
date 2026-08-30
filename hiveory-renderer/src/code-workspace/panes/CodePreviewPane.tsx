import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { ArrowLeft, ArrowRight, Globe2, Lock, RotateCw } from 'lucide-react'
import {
  hiveoryClient,
  normalizeBrowserInput,
  type BrowserEvent,
  type BrowserRuntimeState,
  type CodePreviewSummary,
} from '../../api/hiveory-client'

const BROWSER_EVENT = 'hiveory-browser-event'
const GOOGLE_HOME = 'https://www.google.com/'

interface CodePreviewPaneProps {
  workspaceId: string
  preview?: CodePreviewSummary
  initialUrl?: string
  onStateChange?: (state: BrowserRuntimeState) => void
}

function initialBrowserState(
  browserId: string,
  workspaceId: string,
  url: string,
): BrowserRuntimeState {
  return {
    browser_id: browserId,
    workspace_id: workspaceId,
    url,
    title: '',
    loading: false,
    can_go_back: false,
    can_go_forward: false,
    error: null,
  }
}

export const CodePreviewPane: React.FC<CodePreviewPaneProps> = ({
  workspaceId,
  preview,
  initialUrl = GOOGLE_HOME,
  onStateChange,
}) => {
  const browserId = preview?.id ?? 'hiveory-browser-' + workspaceId
  const initialUrlRef = useRef(preview?.url || initialUrl)
  const fallbackHistoryRef = useRef({ entries: [initialUrlRef.current], index: 0 })
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState(initialUrlRef.current)
  const [browserState, setBrowserState] = useState(() =>
    initialBrowserState(browserId, workspaceId, initialUrlRef.current),
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [iframeReloadKey, setIframeReloadKey] = useState(0)
  const closeTimersRef = useRef(new Map<string, number>())
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  const syncBounds = useCallback(() => {
    if (!hiveoryClient.isTauri || !surfaceRef.current) return
    const rect = surfaceRef.current.getBoundingClientRect()
    void hiveoryClient.browserSetBounds({
      browser_id: browserId,
      x: Math.max(0, rect.left),
      y: Math.max(0, rect.top),
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height),
      visible: rect.width >= 1 && rect.height >= 1,
    }).catch(() => undefined)
  }, [browserId])

  useEffect(() => {
    if (!hiveoryClient.isTauri) return
    const pendingClose = closeTimersRef.current.get(browserId)
    if (pendingClose !== undefined) {
      window.clearTimeout(pendingClose)
      closeTimersRef.current.delete(browserId)
    }
    let disposed = false
    let unlisten: (() => void) | null = null
    void listen<BrowserEvent>(BROWSER_EVENT, (event) => {
      if (event.payload.state.browser_id !== browserId) return
      setBrowserState(event.payload.state)
      setAddress(event.payload.state.url)
      if (event.payload.notice) setNotice(event.payload.notice)
      onStateChangeRef.current?.(event.payload.state)
    }).then((remove) => {
      if (disposed) remove()
      else unlisten = remove
    }).catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [browserId])

  useEffect(() => {
    if (!hiveoryClient.isTauri) return
    const closeTimers = closeTimersRef.current
    let disposed = false
    void hiveoryClient.browserOpen({
      browser_id: browserId,
      workspace_id: workspaceId,
      url: initialUrlRef.current,
    }).then((state) => {
      if (disposed) return
      setBrowserState(state)
      setAddress(state.url)
      onStateChangeRef.current?.(state)
      requestAnimationFrame(syncBounds)
    }).catch((error: unknown) => {
      if (!disposed) setNotice(error instanceof Error ? error.message : 'The Browser could not be opened.')
    })
    return () => {
      disposed = true
      const closeTimer = window.setTimeout(() => {
        closeTimers.delete(browserId)
        if (disposed) void hiveoryClient.browserClose({ browser_id: browserId }).catch(() => undefined)
      }, 0)
      closeTimers.set(browserId, closeTimer)
    }
  }, [browserId, workspaceId, syncBounds])

  useLayoutEffect(() => {
    if (!hiveoryClient.isTauri || !surfaceRef.current) return
    const sync = () => syncBounds()
    sync()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    observer?.observe(surfaceRef.current)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [syncBounds])

  const applyState = (state: BrowserRuntimeState | null) => {
    if (!state) return
    setBrowserState(state)
    setAddress(state.url)
    onStateChangeRef.current?.(state)
  }

  const applyFallbackHistoryState = (index: number) => {
    const history = fallbackHistoryRef.current
    history.index = index
    const state = initialBrowserState(browserId, workspaceId, history.entries[index])
    state.can_go_back = index > 0
    state.can_go_forward = index + 1 < history.entries.length
    applyState(state)
  }

  const handleNavigate = (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const target = normalizeBrowserInput(address)
      setNotice(null)
      if (hiveoryClient.isTauri) {
        void hiveoryClient.browserNavigate({ browser_id: browserId, url: target })
          .then(applyState)
          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'The Browser could not navigate.'))
      } else {
        const history = fallbackHistoryRef.current
        history.entries = history.entries.slice(0, history.index + 1)
        if (history.entries[history.index] !== target) {
          history.entries.push(target)
          history.index = history.entries.length - 1
        }
        applyFallbackHistoryState(history.index)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The Browser address is invalid.')
    }
  }

  const handleBack = () => {
    if (!hiveoryClient.isTauri) {
      const history = fallbackHistoryRef.current
      if (history.index > 0) applyFallbackHistoryState(history.index - 1)
      return
    }
    void hiveoryClient.browserBack({ browser_id: browserId })
      .then(applyState)
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Back navigation failed.'))
  }

  const handleForward = () => {
    if (!hiveoryClient.isTauri) {
      const history = fallbackHistoryRef.current
      if (history.index + 1 < history.entries.length) applyFallbackHistoryState(history.index + 1)
      return
    }
    void hiveoryClient.browserForward({ browser_id: browserId })
      .then(applyState)
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Forward navigation failed.'))
  }

  const handleReload = () => {
    if (!hiveoryClient.isTauri) {
      setBrowserState((state) => ({ ...state, loading: true }))
      setIframeReloadKey((key) => key + 1)
      return
    }
    void hiveoryClient.browserReload({ browser_id: browserId })
      .then(applyState)
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'The Browser could not reload.'))
  }

  return (
    <div className="code-preview-container">
      <div className="code-preview-toolbar">
        <button type="button" className="code-pane-action-btn" title="Back" onClick={handleBack} disabled={!browserState.can_go_back}>
          <ArrowLeft size={13} />
        </button>
        <button type="button" className="code-pane-action-btn" title="Forward" onClick={handleForward} disabled={!browserState.can_go_forward}>
          <ArrowRight size={13} />
        </button>
        <button type="button" className="code-pane-action-btn" title="Reload" onClick={handleReload}>
          <RotateCw size={12} className={browserState.loading ? 'is-spinning' : undefined} />
        </button>

        <form onSubmit={handleNavigate} style={{ flex: 1, display: 'flex' }}>
          <div className="code-preview-url-bar">
            {browserState.url.startsWith('https://') ? <Lock size={10} style={{ opacity: 0.6 }} /> : <Globe2 size={10} style={{ opacity: 0.6 }} />}
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              aria-label="Browser address"
              spellCheck={false}
            />
          </div>
        </form>
        {browserState.loading && <span className="code-preview-loading" aria-label="Loading">Loading…</span>}
      </div>

      {notice && <div className="code-preview-notice" role="status">{notice}</div>}
      <div
        className="code-preview-native-surface"
        ref={surfaceRef}
        aria-busy={browserState.loading}
        onMouseDown={() => {
          if (hiveoryClient.isTauri) void hiveoryClient.browserFocus({ browser_id: browserId }).catch(() => undefined)
        }}
      >
        {!hiveoryClient.isTauri && (
          <iframe
            key={`${browserState.url}:${iframeReloadKey}`}
            src={browserState.url}
            className="code-preview-iframe"
            title="Browser"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
            referrerPolicy="no-referrer"
            onLoad={() => setBrowserState((state) => ({ ...state, loading: false }))}
          />
        )}
        {hiveoryClient.isTauri && (
          <div className="code-preview-native-placeholder" aria-hidden="true">
            {!browserState.title && !browserState.loading && <span>Browser ready</span>}
          </div>
        )}
      </div>
    </div>
  )
}
