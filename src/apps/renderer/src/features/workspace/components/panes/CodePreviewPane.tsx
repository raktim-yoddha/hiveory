import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listen } from '@tauri-apps/api/event'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Cookie,
  Crosshair,
  Ellipsis,
  ExternalLink,
  Globe2,
  Hand,
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
  formatHiveoryClientError,
  hiveoryClient,
  normalizeBrowserInput,
  type BrowserCaptureEvent,
  type BrowserBoundsRequest,
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
  copyBrowserRegion,
  formatBrowserAnnotations,
  formatBrowserGrab,
  intersectBrowserSurface,
  parseBrowserElementPayload,
  type BrowserPageAnnotation,
} from '../../../browser/model/browser-models'
import {
  areBrowserSurfacesSuspended,
  subscribeBrowserSurfaceSuspension,
} from '../../../browser/model/browser-surface-coordinator'
import { createLatestAsyncQueue, type LatestAsyncQueue } from '../../../browser/model/latest-async-queue'
import { cancelScheduledBrowserClose, scheduleBrowserClose } from '../../../browser/model/browser-lifecycle'

const BROWSER_EVENT = 'hiveory-browser-event'
const BROWSER_CAPTURE_EVENT = 'hiveory-browser-capture-event'
const GOOGLE_HOME = 'https://www.google.com/'
const IMPORT_HINT_STORAGE_KEY = 'hiveory.browser.import-hint-dismissed'

type BrowserOverlay = 'menu' | 'draw' | 'agent' | null
type BrowserMenuSection = 'root' | 'cookies'
type BrowserPickerAction = 'grab' | 'annotate'

interface CodePreviewPaneProps {
  workspaceId: string
  preview?: CodePreviewSummary
  initialUrl?: string
  onStateChange?: (state: BrowserRuntimeState) => void
}

interface BrowserSurfaceGeometry {
  left: number
  top: number
  width: number
  height: number
}

interface DeviceMenuPosition {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
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
    touch_enabled: false,
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
  deviceToolbarOpen,
  onSection,
  onClose,
  onNewProfile,
  onSwitchProfile,
  onImport,
  onToggleDeviceToolbar,
  onSettings,
}: {
  section: BrowserMenuSection
  configuration: BrowserConfiguration
  activeProfileId: string
  deviceToolbarOpen: boolean
  onSection: (section: BrowserMenuSection) => void
  onClose: () => void
  onNewProfile: () => void
  onSwitchProfile: (profile: BrowserProfile) => void
  onImport: (source: 'chrome' | 'edge' | 'brave' | 'file') => void
  onToggleDeviceToolbar: () => void
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
        <button type="button" className={deviceToolbarOpen ? 'code-preview-menu-item is-selected' : 'code-preview-menu-item'} role="menuitemcheckbox" aria-checked={deviceToolbarOpen} onClick={onToggleDeviceToolbar}>{deviceToolbarOpen ? <Check size={14} /> : <Monitor size={14} />}<span>{deviceToolbarOpen ? 'Hide Device Toolbar' : 'Show Device Toolbar'}</span></button>
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
  const stageRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const browserStateRef = useRef<BrowserRuntimeState>(initialBrowserState(browserId, workspaceId, initialUrlRef.current))
  const browserOpenedRef = useRef(false)
  const captureUnlistenRef = useRef<(() => void) | null>(null)
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
  const [overlayFrameGeometry, setOverlayFrameGeometry] = useState<BrowserSurfaceGeometry | null>(null)
  const [deviceToolbarOpen, setDeviceToolbarOpen] = useState(false)
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false)
  const [deviceMenuPosition, setDeviceMenuPosition] = useState<DeviceMenuPosition | null>(null)
  const [menuSection, setMenuSection] = useState<BrowserMenuSection>('root')
  const [menuBusy, setMenuBusy] = useState(false)
  const [profileDialog, setProfileDialog] = useState<'create' | 'switch' | null>(null)
  const [profileName, setProfileName] = useState('')
  const [pendingProfile, setPendingProfile] = useState<BrowserProfile | null>(null)
  const [pickerAction, setPickerAction] = useState<BrowserPickerAction | null>(null)
  const [surfaceSuspended, setSurfaceSuspended] = useState(areBrowserSurfacesSuspended)
  const [suspensionFrame, setSuspensionFrame] = useState<BrowserFrame | null>(null)
  const pickerActionRef = useRef<BrowserPickerAction | null>(null)
  const [annotations, setAnnotations] = useState<BrowserPageAnnotation[]>(() => readBrowserAnnotations(browserId))
  const annotationsRef = useRef(annotations)
  const [showImportHint, setShowImportHint] = useState(readImportHint)
  const onStateChangeRef = useRef(onStateChange)
  const syncBoundsRef = useRef<() => void>(() => undefined)
  const overlayModeRef = useRef(overlayMode)
  const surfaceSuspendedRef = useRef(surfaceSuspended)
  const nativeVisibilityRequestedRef = useRef(true)
  const deviceMenuOpenRef = useRef(false)
  const deviceMenuButtonRef = useRef<HTMLButtonElement>(null)
  const deviceMenuRef = useRef<HTMLDivElement>(null)
  const cachedFrameRef = useRef<BrowserFrame | null>(null)
  const boundsAnimationFrameRef = useRef<number | null>(null)
  const boundsQueueRef = useRef<LatestAsyncQueue<BrowserBoundsRequest, boolean> | null>(null)
  if (!boundsQueueRef.current) {
    boundsQueueRef.current = createLatestAsyncQueue((request) => hiveoryClient.browserSetBounds(request))
  }
  onStateChangeRef.current = onStateChange
  browserStateRef.current = browserState
  pickerActionRef.current = pickerAction
  annotationsRef.current = annotations
  overlayModeRef.current = overlayMode
  surfaceSuspendedRef.current = surfaceSuspended
  deviceMenuOpenRef.current = deviceMenuOpen

  const queueBounds = useCallback((request: BrowserBoundsRequest): Promise<boolean> => {
    return boundsQueueRef.current!.enqueue(request)
  }, [])

  const currentBounds = useCallback((visible: boolean): BrowserBoundsRequest | null => {
    if (!hiveoryClient.isTauri || !surfaceRef.current) return null
    const rect = surfaceRef.current.getBoundingClientRect()
    const stageRect = stageRef.current?.getBoundingClientRect() ?? rect
    const clipped = intersectBrowserSurface(rect, stageRect, { width: window.innerWidth, height: window.innerHeight })
    return {
      browser_id: browserId,
      x: clipped.x,
      y: clipped.y,
      width: clipped.width,
      height: clipped.height,
      visible: visible && clipped.width >= 1 && clipped.height >= 1,
    }
  }, [browserId])

  const currentOverlayGeometry = useCallback((): BrowserSurfaceGeometry | null => {
    if (!surfaceRef.current || !stageRef.current) return null
    const rect = surfaceRef.current.getBoundingClientRect()
    const stageRect = stageRef.current.getBoundingClientRect()
    const clipped = intersectBrowserSurface(rect, stageRect, { width: window.innerWidth, height: window.innerHeight })
    return {
      left: Math.max(0, clipped.x - stageRect.left),
      top: Math.max(0, clipped.y - stageRect.top),
      width: clipped.width,
      height: clipped.height,
    }
  }, [])

  const applyState = useCallback((state: BrowserRuntimeState | null) => {
    if (!state) return
    browserStateRef.current = state
    setBrowserState(state)
    setAddress(state.url)
    if (state.viewport_id !== 'default') setDeviceToolbarOpen(true)
    onStateChangeRef.current?.(state)
  }, [])

  const syncBounds = useCallback(() => {
    if (!browserOpenedRef.current) return
    const bounds = currentBounds(
      nativeVisibilityRequestedRef.current && !surfaceSuspendedRef.current && overlayModeRef.current === null && !deviceMenuOpenRef.current,
    )
    if (bounds) void queueBounds(bounds).catch(() => undefined)
  }, [currentBounds, queueBounds])
  syncBoundsRef.current = syncBounds

  const setNativeVisibility = useCallback(async (visible: boolean) => {
    nativeVisibilityRequestedRef.current = visible
    if (!browserOpenedRef.current) return
    const bounds = currentBounds(visible && !surfaceSuspendedRef.current && !deviceMenuOpenRef.current)
    if (bounds) await queueBounds(bounds)
  }, [currentBounds, queueBounds])

  const updateDeviceMenuPosition = useCallback(() => {
    const trigger = deviceMenuButtonRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const gutter = 8
    const gap = 6
    const width = Math.min(300, Math.max(220, window.innerWidth - gutter * 2))
    const left = Math.min(Math.max(gutter, rect.left), Math.max(gutter, window.innerWidth - width - gutter))
    const below = Math.max(0, window.innerHeight - rect.bottom - gutter - gap)
    const above = Math.max(0, rect.top - gutter - gap)
    if (below >= 220 || below >= above) {
      setDeviceMenuPosition({ left, top: rect.bottom + gap, width, maxHeight: Math.max(120, below) })
    } else {
      setDeviceMenuPosition({ left, bottom: window.innerHeight - rect.top + gap, width, maxHeight: Math.max(120, above) })
    }
  }, [])

  const closeDeviceMenu = useCallback((restoreNative = true) => {
    deviceMenuOpenRef.current = false
    setDeviceMenuOpen(false)
    setDeviceMenuPosition(null)
    if (!restoreNative || surfaceSuspendedRef.current || overlayModeRef.current !== null) return
    window.requestAnimationFrame(() => {
      setSuspensionFrame(null)
      void setNativeVisibility(true).catch(() => undefined)
      syncBoundsRef.current()
    })
  }, [setNativeVisibility])

  const openDeviceMenu = useCallback(async () => {
    updateDeviceMenuPosition()
    setMenuBusy(true)
    let frame = cachedFrameRef.current
    if (hiveoryClient.isTauri && browserOpenedRef.current) {
      try {
        frame = await hiveoryClient.browserCaptureFrame({ browser_id: browserId })
        cachedFrameRef.current = frame
      } catch (error) {
        setNotice(formatHiveoryClientError(error))
      }
      setSuspensionFrame(frame)
      try {
        await setNativeVisibility(false)
      } catch {
        // The themed selector remains usable if the native surface has already closed.
      }
    }
    deviceMenuOpenRef.current = true
    setDeviceMenuOpen(true)
    setMenuBusy(false)
  }, [browserId, setNativeVisibility, updateDeviceMenuPosition])

  useEffect(() => {
    if (!deviceMenuOpen) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (deviceMenuRef.current?.contains(target) || deviceMenuButtonRef.current?.contains(target)) return
      closeDeviceMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDeviceMenu()
    }
    const reposition = () => updateDeviceMenuPosition()
    document.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [closeDeviceMenu, deviceMenuOpen, updateDeviceMenuPosition])

  const cacheBrowserFrame = useCallback(() => {
    if (!hiveoryClient.isTauri || !browserOpenedRef.current) return
    void hiveoryClient.browserCaptureFrame({ browser_id: browserId }).then((frame) => {
      cachedFrameRef.current = frame
      if (surfaceSuspendedRef.current) setSuspensionFrame(frame)
    }).catch(() => undefined)
  }, [browserId])

  const syncAnnotations = useCallback((items: BrowserPageAnnotation[]) => {
    if (!hiveoryClient.isTauri || !browserOpenedRef.current) return
    void hiveoryClient.browserSyncAnnotations({
      browser_id: browserId,
      annotations: items as unknown as Record<string, unknown>[],
    }).catch((error: unknown) => setNotice(formatHiveoryClientError(error)))
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
    if (!notice || pickerAction) return
    const timer = window.setTimeout(() => setNotice(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [notice, pickerAction])

  useEffect(() => {
    if (!hiveoryClient.isTauri) return
    cancelScheduledBrowserClose(browserId)
    let disposed = false
    let unlisten: (() => void) | null = null
    void listen<BrowserEvent>(BROWSER_EVENT, (event) => {
      if (event.payload.state.browser_id !== browserId) return
      applyState(event.payload.state)
      if (event.payload.notice) setNotice(event.payload.notice)
      if (event.payload.state.loading && pickerActionRef.current) {
        cancelPickerSession('Page element tool cancelled because the page changed.')
      }
      if (!event.payload.state.loading) {
        window.setTimeout(() => syncAnnotations(annotationsRef.current), 80)
        window.setTimeout(cacheBrowserFrame, 120)
      }
    }).then((remove) => {
      if (disposed) remove()
      else unlisten = remove
    }).catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [applyState, browserId, cacheBrowserFrame, cancelPickerSession, syncAnnotations])

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
          setNotice(formatHiveoryClientError(error))
        } finally {
          const activeAction = pickerActionRef.current
          if (activeAction && event.payload.action !== 'annotation-send') {
            try {
              await hiveoryClient.browserStartCapture({ browser_id: browserId, action: activeAction })
            } catch (error) {
              setPickerAction(null)
              setNotice(formatHiveoryClientError(error))
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
        await setNativeVisibility(true)
      } catch (error: unknown) {
        if (!disposed) setNotice(formatHiveoryClientError(error))
      }
    })()
    return () => {
      disposed = true
      scheduleBrowserClose(browserId, () => {
        browserOpenedRef.current = false
        void hiveoryClient.browserClose({ browser_id: browserId }).catch(() => undefined)
      })
    }
  }, [applyState, browserId, setNativeVisibility, syncAnnotations, workspaceId])

  useLayoutEffect(() => {
    if (!hiveoryClient.isTauri || !surfaceRef.current) return
    const scheduleSync = () => {
      if (boundsAnimationFrameRef.current !== null) return
      boundsAnimationFrameRef.current = window.requestAnimationFrame(() => {
        boundsAnimationFrameRef.current = null
        syncBoundsRef.current()
      })
    }
    scheduleSync()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleSync)
    observer?.observe(surfaceRef.current)
    // A viewport preset has a fixed surface size.  Its rectangle can still move
    // when the surrounding pane is resized, so observing only the surface misses
    // those position-only changes and leaves the native WebView at stale bounds.
    if (stageRef.current) observer?.observe(stageRef.current)
    window.addEventListener('resize', scheduleSync)
    window.addEventListener('scroll', scheduleSync, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', scheduleSync)
      window.removeEventListener('scroll', scheduleSync, true)
      if (boundsAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(boundsAnimationFrameRef.current)
        boundsAnimationFrameRef.current = null
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!hiveoryClient.isTauri) return
    // Run after React has applied the fixed viewport dimensions, then once more
    // after the browser layout has settled. This covers viewport switches where
    // ResizeObserver reports the old box before the new box is painted.
    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame(() => {
      syncBoundsRef.current()
      secondFrame = window.requestAnimationFrame(() => syncBoundsRef.current())
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame)
    }
  }, [browserState.viewport_id])

  useEffect(() => {
    const handleSurfaceSuspension = (suspended: boolean) => {
      surfaceSuspendedRef.current = suspended
      setSurfaceSuspended(suspended)
      if (suspended) {
        setSuspensionFrame(cachedFrameRef.current)
        const bounds = currentBounds(false)
        if (bounds) void queueBounds(bounds).catch(() => undefined)
        return
      }
      setSuspensionFrame(null)
      window.requestAnimationFrame(() => syncBoundsRef.current())
    }
    return subscribeBrowserSurfaceSuspension(handleSurfaceSuspension)
  }, [currentBounds, queueBounds])

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
      void hiveoryClient.browserNavigate({ browser_id: browserId, url: target }).then(applyState).catch((error: unknown) => setNotice(formatHiveoryClientError(error)))
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
      setNotice(formatHiveoryClientError(error))
    }
  }

  const handleBack = () => {
    if (!hiveoryClient.isTauri) {
      const history = fallbackHistoryRef.current
      if (history.index > 0) applyFallbackHistoryState(history.index - 1)
      return
    }
    void hiveoryClient.browserBack({ browser_id: browserId }).then(applyState).catch((error: unknown) => setNotice(formatHiveoryClientError(error)))
  }

  const handleForward = () => {
    if (!hiveoryClient.isTauri) {
      const history = fallbackHistoryRef.current
      if (history.index + 1 < history.entries.length) applyFallbackHistoryState(history.index + 1)
      return
    }
    void hiveoryClient.browserForward({ browser_id: browserId }).then(applyState).catch((error: unknown) => setNotice(formatHiveoryClientError(error)))
  }

  const handleReload = () => {
    if (!hiveoryClient.isTauri) {
      setBrowserState((state) => ({ ...state, loading: true }))
      setIframeReloadKey((key) => key + 1)
      return
    }
    void hiveoryClient.browserReload({ browser_id: browserId }).then(applyState).catch((error: unknown) => setNotice(formatHiveoryClientError(error)))
  }

  const closeOverlay = useCallback(() => {
    setOverlayMode(null)
    setOverlayFrame(null)
    setOverlayFrameGeometry(null)
    setMenuSection('root')
    window.requestAnimationFrame(() => {
      if (!deviceMenuOpenRef.current) void setNativeVisibility(true).catch(() => undefined)
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
    if (deviceMenuOpenRef.current) closeDeviceMenu(false)
    let frame: BrowserFrame | null = null
    const geometry = currentOverlayGeometry()
    if (hiveoryClient.isTauri) {
      try {
        frame = await hiveoryClient.browserCaptureFrame({ browser_id: browserId })
        cachedFrameRef.current = frame
      } catch (error) {
        setNotice(formatHiveoryClientError(error))
      }
    }
    try {
      await setNativeVisibility(false)
    } catch {
      // The menu remains usable even when the native surface has already closed.
    }
    setOverlayFrame(frame)
    setOverlayFrameGeometry(geometry)
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
    setNotice(null)
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
      setNotice(formatHiveoryClientError(error))
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
      setNotice(formatHiveoryClientError(error))
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
      setNotice(formatHiveoryClientError(error))
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
      window.requestAnimationFrame(() => syncBoundsRef.current())
      setNotice(`Switched to ${profile.name}.`)
    } catch (error) {
      setNotice(formatHiveoryClientError(error))
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
        setNotice(formatHiveoryClientError(error))
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
      setNotice(formatHiveoryClientError(error))
    }
  }

  const selectViewport = async (viewportId: string, dismissMenu = false) => {
    if (dismissMenu) closeOverlay()
    try {
      const next = await hiveoryClient.browserSetViewport({ browser_id: browserId, viewport_id: viewportId })
      applyState(next)
      setNotice(null)
    } catch (error) {
      setNotice(formatHiveoryClientError(error))
    }
  }

  const selectDeviceViewport = async (viewportId: string) => {
    await selectViewport(viewportId)
    closeDeviceMenu()
  }

  const toggleTouchEmulation = async () => {
    setMenuBusy(true)
    try {
      const next = await hiveoryClient.browserSetTouchEmulation({
        browser_id: browserId,
        enabled: !browserStateRef.current.touch_enabled,
      })
      applyState(next)
      setNotice(next.touch_enabled ? 'Touch simulation enabled.' : 'Touch simulation disabled.')
    } catch (error) {
      setNotice(formatHiveoryClientError(error))
    } finally {
      setMenuBusy(false)
    }
  }

  const toggleDeviceToolbar = () => {
    const nextOpen = !deviceToolbarOpen
    closeOverlay()
    setDeviceToolbarOpen(nextOpen)
    closeDeviceMenu(false)
    if (!nextOpen && browserStateRef.current.viewport_id !== 'default') {
      void selectViewport('default')
    }
    if (!nextOpen && browserStateRef.current.touch_enabled) {
      void hiveoryClient.browserSetTouchEmulation({ browser_id: browserId, enabled: false }).then(applyState).catch((error: unknown) => setNotice(formatHiveoryClientError(error)))
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
  const viewportLabel = viewportPreset.id === 'default' ? 'Responsive' : viewportPreset.label
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
          <button type="button" className="code-preview-tool-btn" onClick={() => { closeOverlay(); void hiveoryClient.browserOpenDevtools({ browser_id: browserId }).catch((error: unknown) => setNotice(formatHiveoryClientError(error))) }} title="Open developer tools" aria-label="Open developer tools" disabled={menuBusy}><Code2 size={14} /></button>
          <button type="button" className="code-preview-tool-btn" onClick={() => void hiveoryClient.browserOpenExternal({ browser_id: browserId }).catch((error: unknown) => setNotice(formatHiveoryClientError(error)))} title="Open in default browser" aria-label="Open in default browser" disabled={menuBusy}><ExternalLink size={14} /></button>
          <button type="button" className={overlayMode === 'menu' ? 'code-preview-tool-btn is-active' : 'code-preview-tool-btn'} onClick={() => overlayMode === 'menu' ? closeOverlay() : void openMenu()} title="Browser options" aria-label="Browser options" aria-haspopup="menu" aria-expanded={overlayMode === 'menu'} disabled={menuBusy}><Ellipsis size={16} /></button>
        </div>
        {browserState.loading && <span className="code-preview-loading" aria-label="Loading">Loading…</span>}
      </div>

      {deviceToolbarOpen && (
        <div className="code-preview-device-toolbar" role="toolbar" aria-label="Browser device toolbar">
          <span className="code-preview-device-toolbar-label"><Monitor size={13} />Dimensions</span>
          <button
            ref={deviceMenuButtonRef}
            type="button"
            className={`code-preview-device-select${deviceMenuOpen ? ' is-open' : ''}`}
            onClick={() => deviceMenuOpen ? closeDeviceMenu() : void openDeviceMenu()}
            disabled={menuBusy}
            aria-label="Device preset"
            aria-haspopup="listbox"
            aria-expanded={deviceMenuOpen}
          >
            <span>{viewportLabel}</span>
            {viewportPreset.id !== 'default' && <small>{viewportPreset.dimensions}</small>}
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <span className="code-preview-device-dimension" aria-label="Viewport width">{viewportPreset.width || 'Auto'}</span>
          <span className="code-preview-device-separator" aria-hidden="true">×</span>
          <span className="code-preview-device-dimension" aria-label="Viewport height">{viewportPreset.height || 'Auto'}</span>
          <button type="button" className={`code-preview-device-touch${browserState.touch_enabled ? ' is-active' : ''}`} onClick={() => void toggleTouchEmulation()} disabled={menuBusy} aria-pressed={browserState.touch_enabled} title={browserState.touch_enabled ? 'Disable touch simulation' : 'Enable touch simulation'} aria-label={browserState.touch_enabled ? 'Disable touch simulation' : 'Enable touch simulation'}><Hand size={13} /><span>Touch</span></button>
          <button type="button" className="code-preview-device-close" onClick={toggleDeviceToolbar} title="Hide device toolbar" aria-label="Hide device toolbar"><X size={14} /></button>
        </div>
      )}

      {deviceMenuOpen && deviceMenuPosition && createPortal(
        <div
          ref={deviceMenuRef}
          className="code-preview-device-menu"
          role="listbox"
          aria-label="Device presets"
          style={{ left: deviceMenuPosition.left, top: deviceMenuPosition.top, bottom: deviceMenuPosition.bottom, width: deviceMenuPosition.width, maxHeight: deviceMenuPosition.maxHeight }}
        >
          <div className="code-preview-device-menu-heading"><Monitor size={14} /><span>Device presets</span></div>
          {BROWSER_VIEWPORT_PRESETS.map((viewport) => {
            const selected = viewport.id === browserState.viewport_id
            return (
              <button key={viewport.id} type="button" className={selected ? 'is-selected' : undefined} role="option" aria-selected={selected} onClick={() => void selectDeviceViewport(viewport.id)}>
                <span>{viewport.id === 'default' ? 'Responsive' : viewport.label}</span>
                <small>{viewport.id === 'default' ? 'Fit to pane' : viewport.dimensions}</small>
                {selected && <Check size={14} aria-hidden="true" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}

      {pickerAction && <div className="code-preview-picker-status" role="status"><Crosshair size={12} /> <span>{pickerAction === 'annotate' ? annotations.length ? `${annotations.length} annotations ready. Select another element or send the feedback.` : 'Click an element to add feedback for an agent.' : 'Click or hover an element, then press C to copy or S to screenshot.'}</span><button type="button" onClick={cancelPicker}>Cancel</button></div>}
      {notice && <div className="code-preview-notice" role="status">{notice}</div>}
      <div ref={stageRef} className={`code-preview-stage${isEmulatedViewport ? ' is-emulated' : ''}`}>
        <div className="code-preview-device-canvas">
        <div
          className={`code-preview-native-surface${surfaceSuspended || deviceMenuOpen ? ' is-suspended' : ''}`}
          ref={surfaceRef}
          aria-busy={browserState.loading}
          style={isEmulatedViewport ? { width: viewportPreset.width, height: viewportPreset.height } : undefined}
          onMouseDown={() => { if (hiveoryClient.isTauri) void hiveoryClient.browserFocus({ browser_id: browserId }).catch(() => undefined) }}
        >
          {!hiveoryClient.isTauri && <iframe key={`${browserState.url}:${iframeReloadKey}`} src={browserState.url} className="code-preview-iframe" title="Browser" sandbox="allow-scripts allow-same-origin allow-forms allow-modals" referrerPolicy="no-referrer" onLoad={() => setBrowserState((state) => ({ ...state, loading: false }))} />}
          {hiveoryClient.isTauri && <div className="code-preview-native-placeholder" aria-hidden="true" />}
          {hiveoryClient.isTauri && (surfaceSuspended || deviceMenuOpen) && suspensionFrame && <img className="code-preview-suspended-frame" src={browserFrameUrl(suspensionFrame)} alt="" aria-hidden="true" />}
        </div>
        </div>

        {overlayMode === 'menu' && (
          <div className="code-preview-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOverlay() }}>
            {overlayFrame && overlayFrameGeometry && <img className="code-preview-overlay-image is-browser-menu-frame" style={{ left: overlayFrameGeometry.left, top: overlayFrameGeometry.top, width: overlayFrameGeometry.width, height: overlayFrameGeometry.height }} src={browserFrameUrl(overlayFrame)} alt="Current browser page" />}
            <BrowserMenu section={menuSection} configuration={configuration} activeProfileId={browserState.profile_id} deviceToolbarOpen={deviceToolbarOpen} onSection={setMenuSection} onClose={closeOverlay} onNewProfile={() => setProfileDialog('create')} onSwitchProfile={switchProfile} onImport={(source) => void importCookies(source)} onToggleDeviceToolbar={toggleDeviceToolbar} onSettings={openSettings} />
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
