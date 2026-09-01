import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Cookie,
  Crosshair,
  Ellipsis,
  ExternalLink,
  Globe2,
  Import,
  Lock,
  MessageSquarePlus,
  Monitor,
  PenLine,
  Plus,
  RotateCw,
  Settings2,
  X,
} from 'lucide-react'
import {
  hiveoryClient,
  normalizeBrowserInput,
  type BrowserCaptureEvent,
  type BrowserConfiguration,
  type BrowserEvent,
  type BrowserFrame,
  type BrowserProfile,
  type BrowserRuntimeState,
  type CodePreviewSummary,
} from '../../../../shared/api/hiveory-client'
import { HiveoryBrowserDraw } from '../../../browser/components/HiveoryBrowserDraw'
import { BrowserAgentDelivery } from '../../../browser/components/BrowserAgentDelivery'
import {
  BROWSER_ANNOTATION_LIMIT,
  BROWSER_VIEWPORT_PRESETS,
  browserFrameUrl,
  browserViewportLabel,
  copyBrowserRegion,
  formatBrowserAnnotations,
  formatBrowserGrab,
  parseBrowserElementPayload,
  type BrowserPageAnnotation,
} from '../../../browser/model/browser-models'

const BROWSER_EVENT = 'hiveory-browser-event'
const BROWSER_CAPTURE_EVENT = 'hiveory-browser-capture-event'
const GOOGLE_HOME = 'https://www.google.com/'
const IMPORT_HINT_STORAGE_KEY = 'hiveory.browser.import-hint-dismissed'

type BrowserOverlay = 'menu' | 'draw' | 'agent' | null
type BrowserMenuSection = 'root' | 'cookies' | 'viewport'
type BrowserPickerAction = 'grab' | 'annotate'

interface CodePreviewPaneProps {
  workspaceId: string
  preview?: CodePreviewSummary
  initialUrl?: string
  onStateChange?: (state: BrowserRuntimeState) => void
}

function initialBrowserState(browserId: string, workspaceId: string, url: string): BrowserRuntimeState {
  return {
    browser_id: browserId,
    workspace_id: workspaceId,
    url,
    title: '',
    loading: false,
    can_go_back: false,
    can_go_forward: false,
    error: null,
    profile_id: 'default',
    viewport_id: 'default',
  }
}

async function copyText(value: string): Promise<void> {
  if (hiveoryClient.isTauri) {
    try {
      if (await hiveoryClient.browserCopyText({ text: value })) return
    } catch {
      // Fall through to the renderer clipboard for hosts without native access.
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // Tauri/WebView clipboard permissions can reject even when the API exists.
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  const parent = document.body ?? document.documentElement
  parent.appendChild(textarea)
  let copied = false
  try {
    textarea.focus()
    textarea.select()
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    textarea.remove()
  }
  if (!copied) throw new Error('Text clipboard access is unavailable.')
}

function readImportHint(): boolean {
  try {
    return window.localStorage.getItem(IMPORT_HINT_STORAGE_KEY) !== 'true'
  } catch {
    return true
  }
}

function readBrowserAnnotations(browserId: string): BrowserPageAnnotation[] {
  try {
    const value = window.sessionStorage.getItem(`hiveory.browser.annotations.${browserId}`)
    if (!value) return []
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.slice(0, BROWSER_ANNOTATION_LIMIT) as BrowserPageAnnotation[] : []
  } catch {
    return []
  }
}

function BrowserMenu({
  section,
  configuration,
  activeProfileId,
  activeViewportId,
  onSection,
  onClose,
  onNewProfile,
  onSwitchProfile,
  onImport,
  onViewport,
  onSettings,
}: {
  section: BrowserMenuSection
  configuration: BrowserConfiguration
  activeProfileId: string
  activeViewportId: string
  onSection: (section: BrowserMenuSection) => void
  onClose: () => void
  onNewProfile: () => void
  onSwitchProfile: (profile: BrowserProfile) => void
  onImport: (source: 'chrome' | 'edge' | 'brave' | 'file') => void
  onViewport: (viewportId: string) => void
  onSettings: () => void
}) {
  return (
    <div className="code-preview-menu-stack">
      {section === 'cookies' && (
        <div className="code-preview-menu code-preview-submenu" role="menu" aria-label="Import cookies">
          <button type="button" className="code-preview-menu-item" role="menuitem" onClick={() => onImport('chrome')}><span>From Google Chrome</span></button>
          <button type="button" className="code-preview-menu-item" role="menuitem" onClick={() => onImport('edge')}><span>From Microsoft Edge</span></button>
          <button type="button" className="code-preview-menu-item" role="menuitem" onClick={() => onImport('brave')}><span>From Brave</span></button>
          <div className="code-preview-menu-separator" />
          <button type="button" className="code-preview-menu-item" role="menuitem" onClick={() => onImport('file')}><span>From File…</span></button>
          <div className="code-preview-menu-disclosure"><span aria-hidden="true">ⓘ</span><p><strong>Google logins aren’t imported</strong>Sign in to Google directly in this Browser profile.</p></div>
        </div>
      )}
      {section === 'viewport' && (
        <div className="code-preview-menu code-preview-submenu" role="menu" aria-label="Viewport size">
          {BROWSER_VIEWPORT_PRESETS.map((viewport, index) => (
            <React.Fragment key={viewport.id}>
              {index === 1 && <div className="code-preview-menu-separator" />}
              <button type="button" className={activeViewportId === viewport.id ? 'code-preview-menu-item is-selected' : 'code-preview-menu-item'} role="menuitemradio" aria-checked={activeViewportId === viewport.id} onClick={() => onViewport(viewport.id)}>
                {activeViewportId === viewport.id ? <Check size={14} /> : <span className="code-preview-menu-placeholder" />}
                <span>{viewport.label}{viewport.width ? ` — ${viewport.dimensions}` : ''}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="code-preview-menu" role="menu" aria-label="Browser options">
        {configuration.profiles.map((profile) => (
          <button type="button" key={profile.id} className={activeProfileId === profile.id ? 'code-preview-menu-item is-selected' : 'code-preview-menu-item'} role="menuitemradio" aria-checked={activeProfileId === profile.id} onClick={() => onSwitchProfile(profile)}>
            {activeProfileId === profile.id ? <Check size={14} /> : <span className="code-preview-menu-placeholder" />}
            <span>{profile.name}</span>
          </button>
        ))}
        <div className="code-preview-menu-separator" />
        <button type="button" className="code-preview-menu-item" role="menuitem" onClick={onNewProfile}><Plus size={14} /><span>New Profile…</span></button>
        <div className="code-preview-menu-separator" />
        <button type="button" className={section === 'cookies' ? 'code-preview-menu-item is-selected' : 'code-preview-menu-item'} role="menuitem" onMouseEnter={() => onSection('cookies')} onClick={() => onSection('cookies')}><Cookie size={14} /><span>Import Cookies</span><ChevronRight size={14} className="code-preview-menu-chevron" /></button>
        <div className="code-preview-menu-separator" />
        <button type="button" className={section === 'viewport' ? 'code-preview-menu-item is-selected' : 'code-preview-menu-item'} role="menuitem" onMouseEnter={() => onSection('viewport')} onClick={() => onSection('viewport')}><Monitor size={14} /><span>Viewport Size</span><ChevronRight size={14} className="code-preview-menu-chevron" /></button>
        <div className="code-preview-menu-separator" />
        <button type="button" className="code-preview-menu-item" role="menuitem" onClick={onSettings}><Settings2 size={14} /><span>Browser Settings…</span></button>
      </div>
      <button type="button" className="code-preview-menu-dismiss" onClick={onClose} aria-label="Close browser menu" />
    </div>
  )
}

export const CodePreviewPane: React.FC<CodePreviewPaneProps> = ({ workspaceId, preview, initialUrl = GOOGLE_HOME, onStateChange }) => {
  const browserId = preview?.id ?? 'hiveory-browser-' + workspaceId
  const initialUrlRef = useRef(preview?.url || initialUrl)
  const hasExplicitInitialUrlRef = useRef(Boolean(preview?.url) || initialUrl !== GOOGLE_HOME)
  const fallbackHistoryRef = useRef({ entries: [initialUrlRef.current], index: 0 })
  const surfaceRef = useRef<HTMLDivElement>(null)
  const browserStateRef = useRef<BrowserRuntimeState>(initialBrowserState(browserId, workspaceId, initialUrlRef.current))
  const browserOpenedRef = useRef(false)
  const captureUnlistenRef = useRef<(() => void) | null>(null)
  const closeTimersRef = useRef(new Map<string, number>())
  const [address, setAddress] = useState(initialUrlRef.current)
  const [browserState, setBrowserState] = useState(() => browserStateRef.current)
  const [notice, setNotice] = useState<string | null>(null)
  const [iframeReloadKey, setIframeReloadKey] = useState(0)
  const [configuration, setConfiguration] = useState<BrowserConfiguration>({
    profiles: [{ id: 'default', name: 'Default', built_in: true }],
    settings: { home_url: GOOGLE_HOME, search_engine: 'google', default_profile_id: 'default', default_viewport_id: 'default' },
  })
  const [overlayMode, setOverlayMode] = useState<BrowserOverlay>(null)
  const [overlayFrame, setOverlayFrame] = useState<BrowserFrame | null>(null)
  const [menuSection, setMenuSection] = useState<BrowserMenuSection>('root')
  const [menuBusy, setMenuBusy] = useState(false)
  const [profileDialog, setProfileDialog] = useState<'create' | 'switch' | null>(null)
  const [profileName, setProfileName] = useState('')
  const [pendingProfile, setPendingProfile] = useState<BrowserProfile | null>(null)
  const [pickerAction, setPickerAction] = useState<BrowserPickerAction | null>(null)
  const [surfaceSuspended, setSurfaceSuspended] = useState(false)
  const pickerActionRef = useRef<BrowserPickerAction | null>(null)
  const [annotations, setAnnotations] = useState<BrowserPageAnnotation[]>(() => readBrowserAnnotations(browserId))
  const annotationsRef = useRef(annotations)
  const [showImportHint, setShowImportHint] = useState(readImportHint)
  const onStateChangeRef = useRef(onStateChange)
  const syncBoundsRef = useRef<() => void>(() => undefined)
  onStateChangeRef.current = onStateChange
  browserStateRef.current = browserState
  pickerActionRef.current = pickerAction
  annotationsRef.current = annotations

  const applyState = useCallback((state: BrowserRuntimeState | null) => {
    if (!state) return
    browserStateRef.current = state
    setBrowserState(state)
    setAddress(state.url)
    onStateChangeRef.current?.(state)
  }, [])

  const syncBounds = useCallback(() => {
    if (!hiveoryClient.isTauri || !surfaceRef.current) return
    const rect = surfaceRef.current.getBoundingClientRect()
    void hiveoryClient.browserSetBounds({ browser_id: browserId, x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: Math.max(0, rect.width), height: Math.max(0, rect.height), visible: overlayMode === null && !surfaceSuspended && rect.width >= 1 && rect.height >= 1 }).catch(() => undefined)
  }, [browserId, overlayMode, surfaceSuspended])
  syncBoundsRef.current = syncBounds

  const setNativeVisibility = useCallback(async (visible: boolean) => {
    if (!hiveoryClient.isTauri || !surfaceRef.current) return
    const rect = surfaceRef.current.getBoundingClientRect()
    await hiveoryClient.browserSetBounds({ browser_id: browserId, x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: Math.max(0, rect.width), height: Math.max(0, rect.height), visible: visible && rect.width >= 1 && rect.height >= 1 })
  }, [browserId])

  const syncAnnotations = useCallback((items: BrowserPageAnnotation[]) => {
    if (!hiveoryClient.isTauri || !browserOpenedRef.current) return
    void hiveoryClient.browserSyncAnnotations({
      browser_id: browserId,
      annotations: items as unknown as Record<string, unknown>[],
    }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Browser annotations could not be displayed.'))
  }, [browserId])

  useEffect(() => {
    annotationsRef.current = annotations
    try {
      window.sessionStorage.setItem(`hiveory.browser.annotations.${browserId}`, JSON.stringify(annotations))
    } catch {
      // Session persistence is optional; the current pane still owns the annotations.
    }
    syncAnnotations(annotations)
  }, [annotations, browserId, syncAnnotations])

  const cancelPickerSession = useCallback((message: string) => {
    pickerActionRef.current = null
    setPickerAction(null)
    void hiveoryClient.browserCancelCapture({ browser_id: browserId }).catch(() => undefined)
    syncAnnotations(annotationsRef.current)
    setNotice(message)
  }, [browserId, syncAnnotations])

  useEffect(() => {
    if (!pickerAction || !hiveoryClient.isTauri) return
    const timeout = window.setTimeout(() => {
      cancelPickerSession('Page element tool timed out after two minutes.')
    }, 120_000)
    return () => window.clearTimeout(timeout)
  }, [cancelPickerSession, pickerAction])

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
      applyState(event.payload.state)
      if (event.payload.notice) setNotice(event.payload.notice)
      if (event.payload.state.loading && pickerActionRef.current) {
        cancelPickerSession('Page element tool cancelled because the page changed.')
      }
      if (!event.payload.state.loading) window.setTimeout(() => syncAnnotations(annotationsRef.current), 80)
    }).then((remove) => {
      if (disposed) remove()
      else unlisten = remove
    }).catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [applyState, browserId, cancelPickerSession, syncAnnotations])

  useEffect(() => {
    if (!hiveoryClient.isTauri) return
    let disposed = false
    void listen<BrowserCaptureEvent>(BROWSER_CAPTURE_EVENT, (event) => {
      if (event.payload.browser_id !== browserId) return
      if (event.payload.action === 'cancel') {
        pickerActionRef.current = null
        setPickerAction(null)
        setNotice('Page element tool cancelled.')
        syncAnnotations(annotationsRef.current)
        return
      }
      void (async () => {
        try {
          if (event.payload.action === 'annotation-copy') {
            await copyText(formatBrowserAnnotations(annotationsRef.current))
            setNotice('Browser annotations copied.')
            return
          }
          if (event.payload.action === 'annotation-clear') {
            setAnnotations([])
            setNotice('Browser annotations cleared.')
            return
          }
          if (event.payload.action === 'annotation-delete') {
            const annotationId = typeof event.payload.payload.id === 'string' ? event.payload.payload.id : ''
            if (annotationId) setAnnotations((items) => items.filter((item) => item.id !== annotationId))
            return
          }
          if (event.payload.action === 'annotation-send') {
            pickerActionRef.current = null
            setPickerAction(null)
            await hiveoryClient.browserCancelCapture({ browser_id: browserId }).catch(() => false)
            const frame = await hiveoryClient.browserCaptureFrame({ browser_id: browserId })
            await setNativeVisibility(false)
            setOverlayFrame(frame)
            setOverlayMode('agent')
            return
          }
          const payload = parseBrowserElementPayload(event.payload.payload, browserStateRef.current)
          if (event.payload.action === 'annotate') {
            const comment = typeof event.payload.payload.comment === 'string' ? event.payload.payload.comment.trim().slice(0, 2000) : ''
            const intent: BrowserPageAnnotation['intent'] = event.payload.payload.intent === 'question' ? 'question' : 'change'
            if (comment) {
              setAnnotations((items) => [...items, {
                id: `browser-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                browserId,
                comment,
                intent,
                createdAt: new Date().toISOString(),
                payload,
              }].slice(-BROWSER_ANNOTATION_LIMIT))
              setNotice('Annotation added.')
            }
          } else if (payload.delivery === 'screenshot') {
            const frame = await hiveoryClient.browserCaptureFrame({ browser_id: browserId })
            await copyBrowserRegion(frame, payload)
            setNotice('Element screenshot copied.')
          } else {
            await copyText(formatBrowserGrab(payload))
            setNotice('Page element context copied.')
          }
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'The page context could not be copied.')
        } finally {
          const activeAction = pickerActionRef.current
          if (activeAction && event.payload.action !== 'annotation-send') {
            try {
              await hiveoryClient.browserStartCapture({ browser_id: browserId, action: activeAction })
            } catch (error) {
              setPickerAction(null)
              setNotice(error instanceof Error ? error.message : 'The page element tool could not continue.')
            }
          }
        }
      })()
    }).then((remove) => {
      if (disposed) remove()
      else captureUnlistenRef.current = remove
    }).catch(() => undefined)
    return () => {
      disposed = true
      captureUnlistenRef.current?.()
      captureUnlistenRef.current = null
    }
  }, [browserId, setNativeVisibility, syncAnnotations])

  useEffect(() => {
    if (!hiveoryClient.isTauri) return
    const closeTimers = closeTimersRef.current
    let disposed = false
    void (async () => {
      try {
        const nextConfiguration = await hiveoryClient.browserConfiguration()
        if (disposed) return
        setConfiguration(nextConfiguration)
        if (!hasExplicitInitialUrlRef.current) {
          initialUrlRef.current = nextConfiguration.settings.home_url
          setAddress(initialUrlRef.current)
        }
        const state = await hiveoryClient.browserOpen({ browser_id: browserId, workspace_id: workspaceId, url: initialUrlRef.current })
        if (disposed) return
        browserOpenedRef.current = true
        applyState(state)
        syncAnnotations(annotationsRef.current)
        requestAnimationFrame(() => syncBoundsRef.current())
      } catch (error: unknown) {
        if (!disposed) setNotice(error instanceof Error ? error.message : 'The Browser could not be opened.')
      }
    })()
    return () => {
      disposed = true
      const closeTimer = window.setTimeout(() => {
        closeTimers.delete(browserId)
        if (disposed) {
          browserOpenedRef.current = false
          void hiveoryClient.browserClose({ browser_id: browserId }).catch(() => undefined)
        }
      }, 0)
      closeTimers.set(browserId, closeTimer)
    }
  }, [applyState, browserId, syncAnnotations, workspaceId])

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

  useEffect(() => {
    const handleSurfaceSuspension = (event: Event) => {
      const suspended = (event as CustomEvent<{ suspended?: unknown }>).detail?.suspended === true
      setSurfaceSuspended(suspended)
      void setNativeVisibility(!suspended && overlayMode === null).catch(() => undefined)
    }
    window.addEventListener('hiveory-browser-suspend-surface', handleSurfaceSuspension)
    return () => window.removeEventListener('hiveory-browser-suspend-surface', handleSurfaceSuspension)
  }, [overlayMode, setNativeVisibility])

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
        void hiveoryClient.browserNavigate({ browser_id: browserId, url: target }).then(applyState).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'The Browser could not navigate.'))
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
    void hiveoryClient.browserBack({ browser_id: browserId }).then(applyState).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Back navigation failed.'))
  }

  const handleForward = () => {
    if (!hiveoryClient.isTauri) {
      const history = fallbackHistoryRef.current
      if (history.index + 1 < history.entries.length) applyFallbackHistoryState(history.index + 1)
      return
    }
    void hiveoryClient.browserForward({ browser_id: browserId }).then(applyState).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Forward navigation failed.'))
  }

  const handleReload = () => {
    if (!hiveoryClient.isTauri) {
      setBrowserState((state) => ({ ...state, loading: true }))
      setIframeReloadKey((key) => key + 1)
      return
    }
    void hiveoryClient.browserReload({ browser_id: browserId }).then(applyState).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'The Browser could not reload.'))
  }

  const closeOverlay = useCallback(() => {
    setOverlayMode(null)
    setOverlayFrame(null)
    setMenuSection('root')
    window.requestAnimationFrame(() => {
      void setNativeVisibility(true).catch(() => undefined)
      syncBoundsRef.current()
      window.setTimeout(() => syncAnnotations(annotationsRef.current), 50)
    })
  }, [setNativeVisibility, syncAnnotations])

  const handleAgentDelivery = useCallback((message: string) => {
    setPickerAction(null)
    closeOverlay()
    setNotice(message)
  }, [closeOverlay])

  const handleAgentDeliveryError = useCallback((message: string) => setNotice(message), [])

  const openMenu = async (section: BrowserMenuSection = 'root') => {
    if (overlayMode === 'menu') {
      setMenuSection(section)
      return
    }
    if (pickerActionRef.current) {
      pickerActionRef.current = null
      setPickerAction(null)
      await hiveoryClient.browserCancelCapture({ browser_id: browserId }).catch(() => false)
    }
    setMenuBusy(true)
    let frame: BrowserFrame | null = null
    if (hiveoryClient.isTauri) {
      try {
        frame = await hiveoryClient.browserCaptureFrame({ browser_id: browserId })
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'The page preview could not be captured.')
      }
    }
    try {
      await setNativeVisibility(false)
    } catch {
      // The menu remains usable even when the native surface has already closed.
    }
    setOverlayFrame(frame)
    setMenuSection(section)
    setOverlayMode('menu')
    setMenuBusy(false)
  }

  const startPicker = async (action: BrowserPickerAction) => {
    if (!hiveoryClient.isTauri) {
      setNotice('Page element tools are available in the desktop app.')
      return
    }
    if (pickerActionRef.current === action) {
      cancelPickerSession('Page element tool cancelled.')
      return
    }
    if (pickerActionRef.current) await hiveoryClient.browserCancelCapture({ browser_id: browserId }).catch(() => false)
    if (overlayMode) {
      closeOverlay()
      await setNativeVisibility(true).catch(() => undefined)
    }
    pickerActionRef.current = action
    setPickerAction(action)
    setNotice(action === 'grab' ? 'Move over the page and click an element. Press Escape to cancel.' : 'Move over the page and click an element to annotate it.')
    try {
      const started = await hiveoryClient.browserStartCapture({ browser_id: browserId, action })
      if (!started) {
        pickerActionRef.current = null
        setPickerAction(null)
        return
      }
      await hiveoryClient.browserFocus({ browser_id: browserId }).catch(() => false)
    } catch (error) {
      pickerActionRef.current = null
      setPickerAction(null)
      setNotice(error instanceof Error ? error.message : 'The page element tool could not start.')
    }
  }

  const cancelPicker = () => {
    if (!pickerAction) return
    cancelPickerSession('Page element tool cancelled.')
  }

  const drawScreenshot = async () => {
    if (!hiveoryClient.isTauri) {
      setNotice('Screenshot drawing is available in the desktop app.')
      return
    }
    if (pickerActionRef.current) {
      pickerActionRef.current = null
      setPickerAction(null)
      await hiveoryClient.browserCancelCapture({ browser_id: browserId }).catch(() => false)
    }
    setMenuBusy(true)
    try {
      if (overlayMode === 'menu') {
        closeOverlay()
        await setNativeVisibility(true)
      }
      const frame = await hiveoryClient.browserCaptureFrame({ browser_id: browserId })
      await setNativeVisibility(false)
      setOverlayFrame(frame)
      setOverlayMode('draw')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The screenshot could not be captured.')
    } finally {
      setMenuBusy(false)
    }
  }

  const newProfile = async () => {
    const name = profileName.trim()
    if (!name) return
    setMenuBusy(true)
    try {
      const next = await hiveoryClient.browserCreateProfile({ name })
      setConfiguration(next)
      const created = next.profiles.find((profile) => profile.name === name)
      if (created) {
        const state = await hiveoryClient.browserSwitchProfile({ browser_id: browserId, profile_id: created.id })
        applyState(state)
      }
      setProfileDialog(null)
      setProfileName('')
      closeOverlay()
      setNotice(`Created and switched to ${name}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The profile could not be created.')
    } finally {
      setMenuBusy(false)
    }
  }

  const switchProfile = (profile: BrowserProfile) => {
    if (profile.id === browserStateRef.current.profile_id) return
    setPendingProfile(profile)
    setProfileDialog('switch')
  }

  const confirmSwitchProfile = async () => {
    const profile = pendingProfile
    if (!profile) return
    setMenuBusy(true)
    closeOverlay()
    try {
      const next = await hiveoryClient.browserSwitchProfile({ browser_id: browserId, profile_id: profile.id })
      applyState(next)
      setNotice(`Switched to ${profile.name}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The profile could not be selected.')
    } finally {
      setPendingProfile(null)
      setProfileDialog(null)
      setMenuBusy(false)
    }
  }

  const importCookies = async (source: 'chrome' | 'edge' | 'brave' | 'file') => {
    if (source !== 'file') {
      closeOverlay()
      try {
        const report = await hiveoryClient.browserImportCookieSource({ browser_id: browserId, source })
        setNotice(report.message)
        dismissImportHint()
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Cookies could not be imported.')
      }
      return
    }
    closeOverlay()
    const path = await hiveoryClient.chooseBrowserCookieFile()
    if (!path) return
    try {
      const report = await hiveoryClient.browserImportCookieFile({ browser_id: browserId, path })
      setNotice(report.message)
      dismissImportHint()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Cookies could not be imported.')
    }
  }

  const selectViewport = async (viewportId: string) => {
    closeOverlay()
    try {
      const next = await hiveoryClient.browserSetViewport({ browser_id: browserId, viewport_id: viewportId })
      applyState(next)
      setNotice(`Viewport set to ${browserViewportLabel(viewportId)}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The viewport could not be changed.')
    }
  }

  const openSettings = () => {
    closeOverlay()
    window.dispatchEvent(new CustomEvent('hiveory-open-browser-settings'))
  }

  const dismissImportHint = () => {
    setShowImportHint(false)
    try {
      window.localStorage.setItem(IMPORT_HINT_STORAGE_KEY, 'true')
    } catch {
      // Optional local preference.
    }
  }

  const viewportPreset = BROWSER_VIEWPORT_PRESETS.find((item) => item.id === browserState.viewport_id) ?? BROWSER_VIEWPORT_PRESETS[0]
  const isEmulatedViewport = viewportPreset.width > 0

  return (
    <div className="code-preview-container">
      <div className="code-preview-toolbar">
        <button type="button" className="code-pane-action-btn" title="Back" onClick={handleBack} disabled={!browserState.can_go_back}><ArrowLeft size={13} /></button>
        <button type="button" className="code-pane-action-btn" title="Forward" onClick={handleForward} disabled={!browserState.can_go_forward}><ArrowRight size={13} /></button>
        <button type="button" className="code-pane-action-btn" title="Reload" onClick={handleReload}><RotateCw size={12} className={browserState.loading ? 'is-spinning' : undefined} /></button>

        <form onSubmit={handleNavigate} className="code-preview-address-form">
          <div className="code-preview-url-bar">
            {browserState.url.startsWith('https://') ? <Lock size={10} style={{ opacity: 0.6 }} /> : <Globe2 size={10} style={{ opacity: 0.6 }} />}
            <input type="text" value={address} onChange={(event) => setAddress(event.target.value)} aria-label="Browser address" spellCheck={false} />
          </div>
        </form>

        <div className="code-preview-browser-actions" role="toolbar" aria-label="Browser tools">
          {showImportHint && (
            <span className="code-preview-import-hint">
              <button type="button" className="code-preview-import-pill" onClick={() => void openMenu('cookies')}><Import size={13} /> Import</button>
              <button type="button" className="code-preview-import-dismiss" onClick={dismissImportHint} aria-label="Dismiss import hint"><X size={11} /></button>
            </span>
          )}
          <button type="button" className={pickerAction === 'grab' ? 'code-preview-tool-btn is-active' : 'code-preview-tool-btn'} onClick={() => void startPicker('grab')} title="Grab page element" aria-label="Grab page element" disabled={menuBusy}><Crosshair size={14} /></button>
          <button type="button" className={pickerAction === 'annotate' ? 'code-preview-tool-btn is-active has-badge' : 'code-preview-tool-btn has-badge'} onClick={() => void startPicker('annotate')} title="Annotate page element" aria-label="Annotate page element" disabled={menuBusy}>{annotations.length > 0 && <span className="code-preview-tool-badge">{annotations.length}</span>}<MessageSquarePlus size={14} /></button>
          <button type="button" className={overlayMode === 'draw' ? 'code-preview-tool-btn is-active' : 'code-preview-tool-btn'} onClick={() => overlayMode === 'draw' ? closeOverlay() : void drawScreenshot()} title="Draw on screenshot" aria-label="Draw on screenshot" disabled={menuBusy || pickerAction !== null}><PenLine size={14} /></button>
          <button type="button" className="code-preview-tool-btn" onClick={() => { closeOverlay(); void hiveoryClient.browserOpenDevtools({ browser_id: browserId }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Developer tools could not open.')) }} title="Open developer tools" aria-label="Open developer tools" disabled={menuBusy}><Code2 size={14} /></button>
          <button type="button" className="code-preview-tool-btn" onClick={() => void hiveoryClient.browserOpenExternal({ browser_id: browserId }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'The page could not open externally.'))} title="Open in default browser" aria-label="Open in default browser" disabled={menuBusy}><ExternalLink size={14} /></button>
          <button type="button" className={overlayMode === 'menu' ? 'code-preview-tool-btn is-active' : 'code-preview-tool-btn'} onClick={() => overlayMode === 'menu' ? closeOverlay() : void openMenu()} title="Browser options" aria-label="Browser options" aria-haspopup="menu" aria-expanded={overlayMode === 'menu'} disabled={menuBusy}><Ellipsis size={16} /></button>
        </div>
        {browserState.loading && <span className="code-preview-loading" aria-label="Loading">Loading…</span>}
      </div>

      {pickerAction && <div className="code-preview-picker-status" role="status"><Crosshair size={12} /> <span>{pickerAction === 'annotate' ? annotations.length ? `${annotations.length} annotations ready. Select another element or send the feedback.` : 'Click an element to add feedback for an agent.' : 'Click or hover an element, then press C to copy or S to screenshot.'}</span><button type="button" onClick={cancelPicker}>Cancel</button></div>}
      {notice && <div className="code-preview-notice" role="status">{notice}</div>}
      <div className={`code-preview-stage${isEmulatedViewport ? ' is-emulated' : ''}`}>
        <div className="code-preview-device-canvas">
        <div
          className="code-preview-native-surface"
          ref={surfaceRef}
          aria-busy={browserState.loading}
          style={isEmulatedViewport ? { width: viewportPreset.width, height: viewportPreset.height } : undefined}
          onMouseDown={() => { if (hiveoryClient.isTauri) void hiveoryClient.browserFocus({ browser_id: browserId }).catch(() => undefined) }}
        >
          {!hiveoryClient.isTauri && <iframe key={`${browserState.url}:${iframeReloadKey}`} src={browserState.url} className="code-preview-iframe" title="Browser" sandbox="allow-scripts allow-same-origin allow-forms allow-modals" referrerPolicy="no-referrer" onLoad={() => setBrowserState((state) => ({ ...state, loading: false }))} />}
          {hiveoryClient.isTauri && <div className="code-preview-native-placeholder" aria-hidden="true">{!browserState.title && !browserState.loading && <span>Browser ready</span>}</div>}
        </div>
        </div>

        {overlayMode === 'menu' && (
          <div className="code-preview-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOverlay() }}>
            {overlayFrame && <img className="code-preview-overlay-image" src={browserFrameUrl(overlayFrame)} alt="Current browser page" />}
            <BrowserMenu section={menuSection} configuration={configuration} activeProfileId={browserState.profile_id} activeViewportId={browserState.viewport_id} onSection={setMenuSection} onClose={closeOverlay} onNewProfile={() => setProfileDialog('create')} onSwitchProfile={switchProfile} onImport={(source) => void importCookies(source)} onViewport={(viewportId) => void selectViewport(viewportId)} onSettings={openSettings} />
            {profileDialog === 'create' && (
              <form className="hiveory-browser-profile-dialog" onSubmit={(event) => { event.preventDefault(); void newProfile() }}>
                <div className="hiveory-browser-profile-dialog-head"><div><span>Browser profile</span><strong>Create a separate profile</strong></div><button type="button" onClick={() => { setProfileDialog(null); setProfileName('') }} aria-label="Close profile dialog"><X size={15} /></button></div>
                <p>Profiles keep cookies, logins, and site storage isolated from one another.</p>
                <label>Profile name<input autoFocus maxLength={80} value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Work, Personal, Testing…" /></label>
                <div className="hiveory-browser-profile-dialog-actions"><button type="button" onClick={() => { setProfileDialog(null); setProfileName('') }}>Cancel</button><button type="submit" className="is-primary" disabled={!profileName.trim() || menuBusy}>{menuBusy ? 'Creating…' : 'Create'}</button></div>
              </form>
            )}
            {profileDialog === 'switch' && pendingProfile && (
              <div className="hiveory-browser-profile-dialog" role="alertdialog" aria-modal="true" aria-labelledby="browser-switch-profile-title">
                <div className="hiveory-browser-profile-dialog-head"><div><span>Switch profile</span><strong id="browser-switch-profile-title">Reload this page with {pendingProfile.name}?</strong></div><button type="button" onClick={() => { setProfileDialog(null); setPendingProfile(null) }} aria-label="Close profile dialog"><X size={15} /></button></div>
                <p>The current page will reload using that profile’s separate cookies and site storage.</p>
                <div className="hiveory-browser-profile-dialog-actions"><button type="button" onClick={() => { setProfileDialog(null); setPendingProfile(null) }}>Cancel</button><button type="button" className="is-primary" onClick={() => void confirmSwitchProfile()} disabled={menuBusy}>Switch profile</button></div>
              </div>
            )}
          </div>
        )}

        {overlayMode === 'draw' && overlayFrame && (
          <div className="code-preview-overlay code-preview-draw-overlay">
            <HiveoryBrowserDraw frame={overlayFrame} onCancel={closeOverlay} onCopied={() => setNotice('Marked screenshot copied to the clipboard.')} onError={setNotice} />
          </div>
        )}

        {overlayMode === 'agent' && (
          <div className="code-preview-overlay code-preview-agent-overlay">
            {overlayFrame && <img className="code-preview-overlay-image" src={browserFrameUrl(overlayFrame)} alt="Current browser page" />}
            <BrowserAgentDelivery
              prompt={formatBrowserAnnotations(annotations)}
              onCancel={closeOverlay}
              onDelivered={handleAgentDelivery}
              onError={handleAgentDeliveryError}
            />
          </div>
        )}
      </div>
    </div>
  )
}
