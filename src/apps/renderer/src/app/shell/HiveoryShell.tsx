import {
  Activity,
  Bell,
  Bot,
  CheckCircle2,
  Code2,
  Command,
  Copy,
  Download,
  FolderArchive,
  Globe2,
  KeyRound,
  Keyboard,
  MessageSquare,
  Minus,
  PanelLeft,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  UserRound,
  X,
  Square as SquareIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  formatHiveoryClientError,
  hiveoryClient,
  type ApplicationMode,
  type BrowserConfiguration,
  type BrowserSettings,
  type DiagnosticSnapshot,
  type UpdateSnapshot,
} from '../../shared/api/hiveory-client'
import { HiveoryChat } from '../../features/chat/views/HiveoryChat'
import { HiveoryCodeWorkspace } from '../../features/workspace/views/HiveoryCodeWorkspace'
import { HiveoryAgent } from '../../features/agent/views/HiveoryAgent'
import { PRIMARY_PRESETS } from '../../features/workspace/model/code-layout-presets-meta'
import { BROWSER_VIEWPORT_PRESETS, browserViewportLabel } from '../../features/browser/model/browser-models'
import { isHiveoryDev } from '../edition'
import { useBrowserSurfaceBlocker } from '../../features/browser/hooks/use-browser-surface-blocker'

type ModeDefinition = {
  mode: ApplicationMode
  label: string
  description: string
  icon: typeof Bot
  navigation: string[]
}

const modes: ModeDefinition[] = [
  {
    mode: 'agent',
    label: 'Agent',
    description: 'Named assistants, explicit tools, durable runs, and inspectable memory.',
    icon: Bot,
    navigation: ['Workspace', 'Runs', 'Routines', 'Plugins', 'Skills'],
  },
  {
    mode: 'code',
    label: 'Code',
    description: 'Projects, panes, and local tools live here.',
    icon: Code2,
    navigation: [],
  },
  {
    mode: 'chat',
    label: 'Chat',
    description: 'Focused conversations and artifacts will appear here.',
    icon: MessageSquare,
    navigation: ['Conversations', 'Artifacts', 'Archive'],
  },
]

const previewSnapshot: DiagnosticSnapshot = {
  providers: [],
  recent_jobs: [],
  notifications: [],
  recovery_message: null,
}

type ShellScreen = 'workspace' | 'diagnostics' | 'settings'
type ShellPreferences = { fontScale: 100 | 110 | 125; compact: boolean; reducedMotion: boolean; sidebarCollapsed: boolean }
type CommandAction = {
  id: string
  label: string
  description: string
  shortcut?: string
  keywords: string[];
  run: () => void
}

const defaultPreferences: ShellPreferences = { fontScale: 100, compact: false, reducedMotion: false, sidebarCollapsed: false }
const updateCheckIntervalMs = 24 * 60 * 60 * 1000
const dismissedUpdateStorageKey = 'hiveory.dismissed-update-version'

function readPreferences(): ShellPreferences {
  if (typeof window === 'undefined') return defaultPreferences
  try {
    const value = JSON.parse(window.localStorage.getItem('hiveory.preferences') ?? '{}') as Partial<ShellPreferences>
    return {
      ...defaultPreferences,
      ...value,
      fontScale: value.fontScale === 110 || value.fontScale === 125 ? value.fontScale : 100,
      sidebarCollapsed: value.sidebarCollapsed === true,
    }
  } catch {
    return defaultPreferences
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function readDismissedUpdateVersion(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(dismissedUpdateStorageKey)
  } catch {
    return null
  }
}

function rememberDismissedUpdateVersion(version: string): void {
  try {
    window.localStorage.setItem(dismissedUpdateStorageKey, version)
  } catch {
    // Optional; the prompt can still be dismissed for the current session.
  }
}

export function HiveoryShell() {
  const [activeMode, setActiveMode] = useState<ApplicationMode>('code')
  const [screen, setScreen] = useState<ShellScreen>('workspace')
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>(previewSnapshot)
  const [preferences, setPreferences] = useState<ShellPreferences>(readPreferences)
  const [commandOpen, setCommandOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [codeLayoutMenuOpen, setCodeLayoutMenuOpen] = useState(false)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [windowControlError, setWindowControlError] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateSnapshot | null>(null)
  const [updatePromptOpen, setUpdatePromptOpen] = useState(false)
  const [updateInstalling, setUpdateInstalling] = useState(false)
  const [updatePromptError, setUpdatePromptError] = useState<string | null>(null)
  useBrowserSurfaceBlocker(
    commandOpen || notificationsOpen || codeLayoutMenuOpen || updatePromptOpen,
    'application-shell-overlay',
  )

  const refresh = async () => {
    try {
      setSnapshot(await hiveoryClient.diagnostics())
    } catch {
      // preview fallback
    }
  }

  useEffect(() => {
    void hiveoryClient
      .bootstrap()
      .then((item) => {
        setActiveMode(item.active_mode)
      })
      .catch(() => undefined)
    void refresh()
    hiveoryClient.subscribe(() => {
      void refresh()
    })
  }, [])

  useEffect(() => {
    const openGlobalSettings = () => {
      setScreen('settings')
      setCommandOpen(false)
      setNotificationsOpen(false)
    }
    const openBrowserSettings = () => {
      openGlobalSettings()
      window.setTimeout(() => document.getElementById('hiveory-browser-settings')?.focus(), 0)
    }
    window.addEventListener('hiveory-open-global-settings', openGlobalSettings)
    window.addEventListener('hiveory-open-browser-settings', openBrowserSettings)
    return () => {
      window.removeEventListener('hiveory-open-global-settings', openGlobalSettings)
      window.removeEventListener('hiveory-open-browser-settings', openBrowserSettings)
    }
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--hiveory-font-scale', String(preferences.fontScale / 100))
    document.documentElement.dataset.hiveoryDensity = preferences.compact ? 'compact' : 'comfortable'
    document.documentElement.dataset.reducedMotion = preferences.reducedMotion ? 'true' : 'false'
    try {
      window.localStorage.setItem('hiveory.preferences', JSON.stringify(preferences))
    } catch {
      // optional
    }
  }, [preferences])

  const checkForUpdates = useCallback(async (showPrompt: boolean): Promise<UpdateSnapshot> => {
    const next = await hiveoryClient.checkForUpdate()
    setUpdate(next)
    if (
      showPrompt &&
      next.status === 'available' &&
      next.available_version &&
      readDismissedUpdateVersion() !== next.available_version
    ) {
      setUpdatePromptError(null)
      setUpdatePromptOpen(true)
    }
    return next
  }, [])

  const installUpdate = useCallback(async (): Promise<void> => {
    setUpdateInstalling(true)
    setUpdatePromptError(null)
    try {
      await hiveoryClient.installUpdate()
      setUpdatePromptOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The update could not be installed.'
      setUpdatePromptError(message)
      throw error
    } finally {
      setUpdateInstalling(false)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const check = async () => {
      try {
        const next = await checkForUpdates(true)
        if (disposed) return
        setUpdate(next)
      } catch {
        // Background update checks stay quiet; Settings exposes manual errors.
      }
    }

    void check()
    const interval = window.setInterval(() => void check(), updateCheckIntervalMs)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [checkForUpdates])

  const dismissUpdatePrompt = () => {
    if (update?.available_version) rememberDismissedUpdateVersion(update.available_version)
    setUpdatePromptOpen(false)
    setUpdatePromptError(null)
  }

  const openUpdateSettings = () => {
    setUpdatePromptOpen(false)
    setCommandOpen(false)
    setNotificationsOpen(false)
    setScreen('settings')
  }

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return

    let disposed = false
    let unlisten: (() => void) | undefined

    try {
      const win = getCurrentWindow()
      const syncMaximizedState = async () => {
        try {
          const maximized = await win.isMaximized()
          if (!disposed) setWindowMaximized(maximized)
        } catch {
          // Browser previews and older native sessions may not expose this state.
        }
      }

      void syncMaximizedState()
      void win
        .onResized(() => {
          void syncMaximizedState()
        })
        .then((removeListener) => {
          if (disposed) removeListener()
          else unlisten = removeListener
        })
        .catch(() => undefined)
    } catch {
      // The renderer can still be exercised outside the native host.
    }

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const selectMode = (mode: ApplicationMode) => {
    setScreen('workspace')
    setNotificationsOpen(false)
    setCodeLayoutMenuOpen(false)
    setActiveMode(mode)
    void hiveoryClient
      .setActiveMode(mode)
      .then((item) => setActiveMode(item.active_mode))
      .catch(() => undefined)
  }

  const handleMinimize = () => {
    setWindowControlError(null)
    try {
      const win = getCurrentWindow()
      void win.minimize().catch(() => setWindowControlError('The window could not be minimized.'))
    } catch {
      setWindowControlError('Window controls are unavailable in preview mode.')
    }
  }

  const handleToggleMaximize = () => {
    setWindowControlError(null)
    try {
      const win = getCurrentWindow()
      void win
        .toggleMaximize()
        .then(() => win.isMaximized())
        .then(setWindowMaximized)
        .catch(() => setWindowControlError('The window could not change size.'))
    } catch {
      setWindowControlError('Window controls are unavailable in preview mode.')
    }
  }

  const handleCloseWindow = () => {
    setWindowControlError(null)
    try {
      const win = getCurrentWindow()
      void win.close().catch(() => setWindowControlError('The window could not be closed.'))
    } catch {
      setWindowControlError('Window controls are unavailable in preview mode.')
    }
  }

  const handleToggleSidebar = () => {
    const collapsed = !preferences.sidebarCollapsed
    setPreferences((current) => ({ ...current, sidebarCollapsed: collapsed }))
    window.dispatchEvent(new CustomEvent('hiveory-sidebar-toggle', { detail: { collapsed } }))
  }

  const commandActions: CommandAction[] = [
    ...modes.map(({ mode, label, description }) => ({
      id: `mode-${mode}`,
      label: `Switch to ${label}`,
      description,
      shortcut: mode === 'agent' ? 'Ctrl 1' : mode === 'code' ? 'Ctrl 2' : 'Ctrl 3',
      keywords: [label, 'mode', 'workspace'],
      run: () => selectMode(mode),
    })),
    {
      id: 'diagnostics',
      label: 'Open diagnostics',
      description: 'Inspect providers, jobs, notifications, and recovery state.',
      shortcut: 'Ctrl Shift D',
      keywords: ['system', 'health', 'provider'],
      run: () => {
        setScreen('diagnostics')
        setCommandOpen(false)
        void refresh()
      },
    },
    {
      id: 'settings',
      label: 'Open settings',
      description: 'Manage appearance, backups, updates, and privacy controls.',
      shortcut: 'Ctrl ,',
      keywords: ['preferences', 'backup', 'update', 'privacy'],
      run: () => {
        setScreen('settings')
        setCommandOpen(false)
      },
    },
    {
      id: 'notifications',
      label: 'Open notifications',
      description: 'Review durable in-app notifications.',
      shortcut: 'Ctrl Shift N',
      keywords: ['alerts', 'activity'],
      run: () => {
        setNotificationsOpen(true)
        setCommandOpen(false)
        void refresh()
      },
    },
  ]

  useEffect(() => {
    const openCodeLayoutMenu = () => {
      if (activeMode === 'code' && screen === 'workspace') setCodeLayoutMenuOpen(true)
    }
    window.addEventListener('hiveory-open-code-layout-menu', openCodeLayoutMenu)
    return () => window.removeEventListener('hiveory-open-code-layout-menu', openCodeLayoutMenu)
  }, [activeMode, screen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
        setNotificationsOpen(false)
      }
      if (modifier && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        handleToggleSidebar()
      }
      if (modifier && event.key === ',') {
        event.preventDefault()
        setScreen('settings')
        setCommandOpen(false)
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setScreen('diagnostics')
        setCommandOpen(false)
        void refresh()
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setNotificationsOpen(true)
        setCommandOpen(false)
        void refresh()
      }
      if (modifier && !event.shiftKey && ['1', '2', '3'].includes(event.key)) {
        const shortcutMode: ApplicationMode | undefined = ({
          '1': 'agent',
          '2': 'code',
          '3': 'chat',
        } as Record<string, ApplicationMode>)[event.key]
        if (shortcutMode) {
          event.preventDefault()
          selectMode(shortcutMode)
        }
      }
      if (event.key === 'Escape') {
        setCommandOpen(false)
        setNotificationsOpen(false)
        setCodeLayoutMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const unreadNotifications = snapshot.notifications.filter((item) => !item.read).length

  return (
    <>
      <a className="hiveory-skip-link" href="#hiveory-main-content">
        Skip to main content
      </a>
      <main className="hiveory-shell">
        {/* Unified Frameless Window Header / Titlebar */}
        <header
          className="hiveory-titlebar"
          data-tauri-drag-region
          onDoubleClick={handleToggleMaximize}
        >
          <div className="hiveory-brand">
            <img className="hiveory-brand-logo" src="/hiveory-logo.png" alt="" draggable={false} />
            <span className="hiveory-brand-name">Hiveory</span>
            {isHiveoryDev && <span className="hiveory-dev-tag" title="Hiveory Dev build">DEV</span>}
            <button
              type="button"
              className="hiveory-icon-button hiveory-sidebar-toggle"
              onClick={handleToggleSidebar}
              onDoubleClick={(event) => event.stopPropagation()}
              aria-label={preferences.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-expanded={!preferences.sidebarCollapsed}
              aria-keyshortcuts="Control+B"
              title={`${preferences.sidebarCollapsed ? 'Show' : 'Hide'} sidebar (Ctrl B)`}
            >
              <PanelLeft size={13} aria-hidden="true" />
            </button>
          </div>

          <nav className="hiveory-mode-switch" aria-label="Workspace mode">
            {modes.map(({ mode, label }) => (
              <button
                type="button"
                key={mode}
                className={mode === activeMode && screen === 'workspace' ? 'is-active' : ''}
                onClick={() => selectMode(mode)}
                aria-pressed={mode === activeMode && screen === 'workspace'}
                aria-keyshortcuts={`Control+${mode === 'agent' ? '1' : mode === 'code' ? '2' : '3'}`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="hiveory-title-actions" onDoubleClick={(event) => event.stopPropagation()}>
            {screen === 'workspace' && activeMode === 'code' && (
              <div className="hiveory-layout-menu">
                <button
                  type="button"
                  className="hiveory-title-action"
                  aria-haspopup="menu"
                  aria-expanded={codeLayoutMenuOpen}
                  onClick={() => setCodeLayoutMenuOpen((value) => !value)}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  Layout
                  <span className="hiveory-layout-chevron" aria-hidden="true">⌄</span>
                </button>
                {codeLayoutMenuOpen && (
                  <div className="hiveory-layout-dropdown" role="menu" aria-label="Workspace layout">
                    {PRIMARY_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset.id}
                        role="menuitem"
                        className="hiveory-layout-option"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('hiveory-apply-code-layout-preset', { detail: { preset: preset.id } }))
                          setCodeLayoutMenuOpen(false)
                        }}
                      >
                        <span className="hiveory-layout-option-icon"><Sparkles size={13} aria-hidden="true" /></span>
                        <span>
                          <strong>{preset.label}</strong>
                          <small>{preset.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="hiveory-icon-button hiveory-command-trigger"
              onClick={() => {
                setCommandOpen(true)
                setNotificationsOpen(false)
              }}
              aria-label="Open command palette"
              title="Command palette (Ctrl K)"
            >
              <Command size={13} />
            </button>

            <button
              type="button"
              className={
                notificationsOpen
                  ? 'hiveory-icon-button is-active hiveory-notification-trigger'
                  : 'hiveory-icon-button hiveory-notification-trigger'
              }
              onClick={() => {
                setNotificationsOpen((value) => !value)
                setCommandOpen(false)
                void refresh()
              }}
              aria-label={`Open notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`}
              title="Notifications"
            >
              <Bell size={13} />
              {unreadNotifications > 0 && (
                <span className="hiveory-notification-count">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </button>

            <button
              type="button"
              className={screen === 'settings' ? 'hiveory-icon-button is-active' : 'hiveory-icon-button'}
              onClick={() => {
                setScreen(screen === 'settings' ? 'workspace' : 'settings')
                setCommandOpen(false)
              }}
              aria-label="Open settings"
              title="Settings (Ctrl ,)"
            >
              <Settings2 size={13} />
            </button>

            {windowControlError && (
              <span className="hiveory-window-control-error" role="status" aria-live="polite">
                {windowControlError}
              </span>
            )}

            {/* Window Controls (Minimize, Maximize, Close) */}
            <div className="hiveory-window-controls">
              <button
                type="button"
                className="hiveory-win-btn minimize"
                onClick={handleMinimize}
                onDoubleClick={(event) => event.stopPropagation()}
                title="Minimize"
                aria-label="Minimize"
              >
                <Minus size={11} />
              </button>
              <button
                type="button"
                className="hiveory-win-btn maximize"
                onClick={handleToggleMaximize}
                onDoubleClick={(event) => event.stopPropagation()}
                title={windowMaximized ? 'Restore' : 'Maximize'}
                aria-label={windowMaximized ? 'Restore' : 'Maximize'}
              >
                {windowMaximized ? <Copy size={11} /> : <SquareIcon size={10} />}
              </button>
              <button
                type="button"
                className="hiveory-win-btn close"
                onClick={handleCloseWindow}
                onDoubleClick={(event) => event.stopPropagation()}
                title="Close"
                aria-label="Close"
              >
                <X size={11} />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Workspace Container */}
        <section
          id="hiveory-main-content"
          tabIndex={-1}
          className="hiveory-workspace is-code-app"
        >
          {screen === 'diagnostics' ? (
            <HiveoryDiagnostics snapshot={snapshot} refresh={refresh} />
          ) : screen === 'settings' ? (
            <HiveorySettings
              preferences={preferences}
              setPreferences={setPreferences}
              update={update}
              onCheckUpdate={() => checkForUpdates(false)}
              onInstallUpdate={installUpdate}
              updateInstalling={updateInstalling}
              onOpenDiagnostics={() => {
                setScreen('diagnostics')
                void refresh()
              }}
            />
          ) : activeMode === 'agent' ? (
            <HiveoryAgent />
          ) : activeMode === 'chat' ? (
            <HiveoryChat />
          ) : (
            <HiveoryCodeWorkspace />
          )}
        </section>

        {updatePromptOpen && update?.status === 'available' && update.available_version && (
          <HiveoryUpdatePrompt
            update={update}
            busy={updateInstalling}
            error={updatePromptError}
            onDismiss={dismissUpdatePrompt}
            onOpenSettings={openUpdateSettings}
            onInstall={() => void installUpdate().catch(() => undefined)}
          />
        )}

        {notificationsOpen && (
          <HiveoryNotificationCenter
            notifications={snapshot.notifications}
            onClose={() => setNotificationsOpen(false)}
            onRead={async (id) => {
              await hiveoryClient.markNotificationRead(id)
              await refresh()
            }}
            onReadAll={async () => {
              await hiveoryClient.markAllNotificationsRead()
              await refresh()
            }}
          />
        )}

        {commandOpen && (
          <HiveoryCommandPalette actions={commandActions} onClose={() => setCommandOpen(false)} />
        )}
      </main>
    </>
  )
}

function HiveoryCommandPalette({
  actions,
  onClose,
}: {
  actions: CommandAction[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtered = actions
    .filter((action) =>
      `${action.label} ${action.description} ${action.keywords.join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
    .slice(0, 12)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    setSelected(0)
  }, [query])

  const runSelected = () => {
    const action = filtered[selected]
    if (!action) return
    onClose()
    action.run()
  }

  return (
    <div className="hiveory-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="hiveory-command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hiveory-command-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="hiveory-command-heading">
          <div>
            <p className="hiveory-eyebrow">Workspace control</p>
            <h2 id="hiveory-command-title">Command palette</h2>
          </div>
          <button
            type="button"
            className="hiveory-icon-button"
            onClick={onClose}
            aria-label="Close command palette"
          >
            <X size={16} />
          </button>
        </div>
        <label className="hiveory-command-search">
          <Command size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelected((value) => Math.min(value + 1, filtered.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((value) => Math.max(value - 1, 0))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                runSelected()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
            placeholder="Search actions…"
            aria-label="Search commands"
          />
        </label>
        <div className="hiveory-command-list" role="listbox" aria-label="Available commands">
          {filtered.length ? (
            filtered.map((action, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                key={action.id}
                className={index === selected ? 'is-selected' : ''}
                onMouseEnter={() => setSelected(index)}
                onClick={() => {
                  onClose()
                  action.run()
                }}
              >
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.description}</small>
                </span>
                {action.shortcut && <kbd>{action.shortcut}</kbd>}
              </button>
            ))
          ) : (
            <p className="hiveory-command-empty">No actions match “{query}”.</p>
          )}
        </div>
        <footer className="hiveory-command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
        </footer>
      </section>
    </div>
  )
}

function HiveoryNotificationCenter({
  notifications,
  onClose,
  onRead,
  onReadAll,
}: {
  notifications: DiagnosticSnapshot['notifications']
  onClose: () => void
  onRead: (id: string) => Promise<void>
  onReadAll: () => Promise<void>
}) {
  return (
    <aside
      className="hiveory-notification-center"
      role="dialog"
      aria-modal="false"
      aria-labelledby="hiveory-notification-title"
    >
      <div className="hiveory-notification-heading">
        <div>
          <p className="hiveory-eyebrow">Activity stream</p>
          <h2 id="hiveory-notification-title">Notifications</h2>
        </div>
        <div className="hiveory-notification-heading-actions">
          {notifications.some((item) => !item.read) && (
            <button type="button" className="hiveory-text-button" onClick={() => void onReadAll()}>
              Mark all read
            </button>
          )}
          <button type="button" className="hiveory-icon-button" onClick={onClose} aria-label="Close notifications">
            <X size={16} />
          </button>
        </div>
      </div>
      {notifications.length ? (
        <div className="hiveory-notification-list">
          {notifications.map((item) => (
            <article key={item.id} className={item.read ? '' : 'is-unread'}>
              <span className={`hiveory-notification-severity ${item.severity}`} aria-label={item.severity}>
                <CheckCircle2 size={14} aria-hidden="true" />
              </span>
              <div>
                <div className="hiveory-notification-row-title">
                  <strong>{item.title}</strong>
                  {!item.read && (
                    <button type="button" className="hiveory-text-button" onClick={() => void onRead(item.id)}>
                      Mark read
                    </button>
                  )}
                </div>
                <p>{item.body}</p>
                <time dateTime={new Date(item.created_at_unix_ms).toISOString()}>
                  {new Date(item.created_at_unix_ms).toLocaleString()}
                </time>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="hiveory-notification-empty">
          <Bell size={22} aria-hidden="true" />
          <p>No notifications yet.</p>
          <small>Run completions, approvals, and recovery events will appear here.</small>
        </div>
      )}
    </aside>
  )
}

function HiveoryUpdatePrompt({
  update,
  busy,
  error,
  onDismiss,
  onOpenSettings,
  onInstall,
}: {
  update: UpdateSnapshot
  busy: boolean
  error: string | null
  onDismiss: () => void
  onOpenSettings: () => void
  onInstall: () => void
}) {
  return (
    <aside
      className="hiveory-update-prompt"
      role="dialog"
      aria-modal="false"
      aria-labelledby="hiveory-update-prompt-title"
      aria-describedby="hiveory-update-prompt-description"
    >
      <div className="hiveory-update-prompt-heading">
        <div>
          <p className="hiveory-eyebrow">Software update</p>
          <h2 id="hiveory-update-prompt-title">Hiveory {update.available_version} is ready</h2>
        </div>
        <button type="button" className="hiveory-icon-button" onClick={onDismiss} disabled={busy} aria-label="Dismiss update">
          <X size={16} />
        </button>
      </div>
      <p id="hiveory-update-prompt-description">
        {update.notes || 'A newer signed version is available. Install it now and Hiveory will restart when ready.'}
      </p>
      {error && <p className="hiveory-update-error" role="alert">{error}</p>}
      <div className="hiveory-update-actions">
        <button type="button" className="is-secondary" onClick={onOpenSettings} disabled={busy}>
          View in Settings
        </button>
        <button type="button" className="is-secondary" onClick={onDismiss} disabled={busy}>
          Later
        </button>
        <button type="button" onClick={onInstall} disabled={busy}>
          <Download size={14} aria-hidden="true" />
          {busy ? 'Installing…' : 'Install now'}
        </button>
      </div>
    </aside>
  )
}

function HiveorySettings({
  preferences,
  setPreferences,
  update,
  onCheckUpdate,
  onInstallUpdate,
  updateInstalling,
  onOpenDiagnostics,
}: {
  preferences: ShellPreferences
  setPreferences: React.Dispatch<React.SetStateAction<ShellPreferences>>
  update: UpdateSnapshot | null
  onCheckUpdate: () => Promise<UpdateSnapshot>
  onInstallUpdate: () => Promise<void>
  updateInstalling: boolean
  onOpenDiagnostics: () => void
}) {
  const [version, setVersion] = useState('0.1.0')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [browserConfiguration, setBrowserConfiguration] = useState<BrowserConfiguration | null>(null)
  const [browserSettings, setBrowserSettings] = useState<BrowserSettings | null>(null)

  useEffect(() => {
    void hiveoryClient.buildInformation().then((info) => setVersion(info.version)).catch(() => undefined)
    void hiveoryClient.browserConfiguration().then((configuration) => {
      setBrowserConfiguration(configuration)
      setBrowserSettings(configuration.settings)
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    const focusBrowserSettings = () => document.getElementById('hiveory-browser-settings')?.focus()
    window.addEventListener('hiveory-focus-browser-settings', focusBrowserSettings)
    window.requestAnimationFrame(focusBrowserSettings)
    return () => window.removeEventListener('hiveory-focus-browser-settings', focusBrowserSettings)
  }, [])

  const action = async (name: string, work: () => Promise<string | void>) => {
    setBusy(name)
    setMessage(null)
    try {
      setMessage((await work()) ?? 'Completed.')
    } catch (error) {
      setMessage(formatHiveoryClientError(error))
    } finally {
      setBusy(null)
    }
  }

  const checkUpdate = () =>
    action('update', async () => {
      const next = await onCheckUpdate()
      return next.status === 'available'
        ? `Version ${next.available_version} is ready to install.`
        : next.status === 'not_configured'
        ? 'This build has no signed update channel configured.'
        : 'You are up to date.'
    })

  const installUpdate = () =>
    action('install', async () => {
      await onInstallUpdate()
      return 'Update installation started. The application will restart when ready.'
    })

  const createBackup = () =>
    action('backup', async () => {
      const destination = await hiveoryClient.chooseBackupDestination()
      if (!destination) return 'Backup cancelled.'
      const summary = await hiveoryClient.createBackup(destination)
      return `Backup saved to ${summary.path} (${formatBytes(summary.bytes)}).`
    })

  const restoreBackup = () =>
    action('restore', async () => {
      if (!window.confirm('Restore will restart the application and replace its local database and artifacts. Continue?')) {
        return 'Restore cancelled.'
      }
      const source = await hiveoryClient.chooseBackupSource()
      if (!source) return 'Restore cancelled.'
      await hiveoryClient.prepareRestore(source)
      return 'Restore staged. The application will restart.'
    })

  const saveBrowserSettings = () =>
    action('browser-settings', async () => {
      if (!browserSettings) return 'Browser settings are still loading.'
      const next = await hiveoryClient.browserUpdateSettings({ settings: browserSettings })
      setBrowserConfiguration(next)
      setBrowserSettings(next.settings)
      return 'Browser settings saved.'
    })

  const createBrowserProfile = () => {
    const name = window.prompt('Name for the new browser profile')?.trim()
    if (!name) return
    void action('browser-profile', async () => {
      const next = await hiveoryClient.browserCreateProfile({ name })
      setBrowserConfiguration(next)
      return `Profile “${name}” created.`
    })
  }

  const deleteBrowserProfile = (profileId: string, profileName: string) => {
    if (!window.confirm(`Remove the ${profileName} profile and its local browser data?`)) return
    void action('browser-profile-delete', async () => {
      const next = await hiveoryClient.browserDeleteProfile({ profile_id: profileId })
      setBrowserConfiguration(next)
      if (browserSettings?.default_profile_id === profileId) setBrowserSettings({ ...next.settings, default_profile_id: next.profiles[0]?.id ?? 'default' })
      return `Profile “${profileName}” removed.`
    })
  }

  return (
    <section className="hiveory-settings hiveory-content" aria-labelledby="hiveory-settings-title">
      <div className="hiveory-content-header">
        <Settings2 size={22} aria-hidden="true" />
        <div>
          <p className="hiveory-eyebrow">Global preferences</p>
          <h1 id="hiveory-settings-title">Settings</h1>
        </div>
      </div>
      <p className="hiveory-description">
        Tune the shared shell, protect local data, and verify the release channel. Secrets remain in the operating-system credential manager.
      </p>
      <div className="hiveory-settings-grid">
        <section className="hiveory-settings-card">
          <div className="hiveory-card-heading">
            <Keyboard size={17} aria-hidden="true" />
            <h2>Appearance and access</h2>
          </div>
          <label htmlFor="hiveory-font-scale">Interface scale</label>
          <select
            id="hiveory-font-scale"
            value={preferences.fontScale}
            onChange={(event) =>
              setPreferences((current) => ({
                ...current,
                fontScale: Number(event.target.value) as ShellPreferences['fontScale'],
              }))
            }
          >
            <option value={100}>100% · Default</option>
            <option value={110}>110% · Comfortable</option>
            <option value={125}>125% · Large</option>
          </select>
          <label className="hiveory-settings-check">
            <input
              type="checkbox"
              checked={preferences.compact}
              onChange={(event) => setPreferences((current) => ({ ...current, compact: event.target.checked }))}
            />
            Compact navigation density
          </label>
          <label className="hiveory-settings-check">
            <input
              type="checkbox"
              checked={preferences.reducedMotion}
              onChange={(event) => setPreferences((current) => ({ ...current, reducedMotion: event.target.checked }))}
            />
            Reduce interface motion
          </label>
          <p>Keyboard shortcuts: <kbd>Ctrl K</kbd> palette, <kbd>Ctrl 1–3</kbd> modes, <kbd>Ctrl ,</kbd> settings.</p>
        </section>
        <section id="hiveory-browser-settings" className="hiveory-settings-card hiveory-browser-settings-card" tabIndex={-1}>
          <div className="hiveory-card-heading">
            <Globe2 size={17} aria-hidden="true" />
            <h2>Browser</h2>
          </div>
          <p>The Browser pane uses one embedded page surface. Google is the default search engine and local HTTP links remain supported.</p>
          {browserSettings && (
            <>
              <label htmlFor="hiveory-browser-home">Home page</label>
              <input id="hiveory-browser-home" value={browserSettings.home_url} onChange={(event) => setBrowserSettings({ ...browserSettings, home_url: event.target.value })} spellCheck={false} />
              <label htmlFor="hiveory-browser-search">Search engine</label>
              <select id="hiveory-browser-search" value={browserSettings.search_engine} onChange={(event) => setBrowserSettings({ ...browserSettings, search_engine: event.target.value })}>
                <option value="google">Google</option>
              </select>
              <label htmlFor="hiveory-browser-profile">Default profile</label>
              <select id="hiveory-browser-profile" value={browserSettings.default_profile_id} onChange={(event) => setBrowserSettings({ ...browserSettings, default_profile_id: event.target.value })}>
                {browserConfiguration?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <label htmlFor="hiveory-browser-viewport">Default viewport</label>
              <select id="hiveory-browser-viewport" value={browserSettings.default_viewport_id} onChange={(event) => setBrowserSettings({ ...browserSettings, default_viewport_id: event.target.value })}>
                {BROWSER_VIEWPORT_PRESETS.map((viewport) => <option key={viewport.id} value={viewport.id}>{browserViewportLabel(viewport.id)}</option>)}
              </select>
              <button type="button" disabled={busy !== null} onClick={saveBrowserSettings}>{busy === 'browser-settings' ? 'Saving…' : 'Save browser settings'}</button>
              <div className="hiveory-browser-profile-list" aria-label="Browser profiles">
                <div className="hiveory-browser-profile-list-heading"><span>Profiles</span><button type="button" className="is-secondary" disabled={busy !== null} onClick={createBrowserProfile}><Plus size={14} /> New profile</button></div>
                {browserConfiguration?.profiles.map((profile) => (
                  <div className="hiveory-browser-profile-row" key={profile.id}>
                    <UserRound size={14} aria-hidden="true" />
                    <span>{profile.name}</span>
                    {profile.built_in ? <small>Built in</small> : <button type="button" className="hiveory-browser-profile-delete" disabled={busy !== null} onClick={() => deleteBrowserProfile(profile.id, profile.name)} aria-label={`Remove ${profile.name} profile`} title={`Remove ${profile.name} profile`}><Trash2 size={13} /></button>}
                  </div>
                ))}
              </div>
              <p>Cookie import is available from the Browser toolbar’s three-dots menu. Use a JSON export so credentials stay local to this app.</p>
            </>
          )}
          {!browserSettings && <p>Loading Browser settings…</p>}
        </section>
        <section className="hiveory-settings-card">
          <div className="hiveory-card-heading">
            <FolderArchive size={17} aria-hidden="true" />
            <h2>Local data</h2>
          </div>
          <p>Backups include a consistent SQLite snapshot and application-managed artifacts.</p>
          <div className="hiveory-settings-actions">
            <button type="button" disabled={busy !== null} onClick={createBackup}>
              {busy === 'backup' ? 'Creating backup…' : 'Create backup'}
            </button>
            <button type="button" className="is-secondary" disabled={busy !== null} onClick={restoreBackup}>
              {busy === 'restore' ? 'Preparing restore…' : 'Restore from backup'}
            </button>
          </div>
          <button type="button" className="is-secondary" onClick={onOpenDiagnostics}>
            <Activity size={15} aria-hidden="true" />
            Open diagnostics
          </button>
        </section>
        <section className="hiveory-settings-card">
          <div className="hiveory-card-heading">
            <Download size={17} aria-hidden="true" />
            <h2>Updates</h2>
          </div>
          <p>Updates are signature-verified and only run when this build has an HTTPS endpoint configured.</p>
          <div className="hiveory-settings-version">
            <span>Installed version</span>
            <strong>{version}</strong>
          </div>
          <button type="button" disabled={busy !== null || updateInstalling} onClick={checkUpdate}>
            {busy === 'update' ? 'Checking…' : 'Check for updates'}
          </button>
          {update?.status === 'available' && update.available_version && (
            <>
              <div className="hiveory-update-status available" role="status">
                Version {update.available_version} is ready to install.
              </div>
              {update.notes && <p>{update.notes}</p>}
            <button type="button" disabled={busy !== null || updateInstalling} onClick={installUpdate}>
              {busy === 'install' ? 'Installing…' : `Install ${update.available_version}`}
            </button>
            </>
          )}
        </section>
      </div>
      {message && <div className="hiveory-feedback" role="status">{message}</div>}
    </section>
  )
}

function HiveoryDiagnostics({
  snapshot,
  refresh,
}: {
  snapshot: DiagnosticSnapshot
  refresh: () => void | Promise<void>
}) {
  const provider = snapshot.providers[0]
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name)
    try {
      await action()
      await refresh()
    } catch {
      // ignore
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="hiveory-diagnostics" aria-labelledby="hiveory-diagnostics-title">
      <div className="hiveory-content-header">
        <Settings2 size={22} aria-hidden="true" />
        <div>
          <p className="hiveory-eyebrow">Global utility</p>
          <h1 id="hiveory-diagnostics-title">Diagnostics</h1>
        </div>
      </div>
      <div className="hiveory-diagnostic-grid">
        <section className="hiveory-diagnostic-card">
          <div className="hiveory-card-heading">
            <KeyRound size={17} />
            <h2>OpenAI Responses</h2>
          </div>
          <label htmlFor="hiveory-secret">API key</label>
          <input
            id="hiveory-secret"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={provider?.secret_configured ? 'Stored securely' : 'Paste API key'}
            autoComplete="off"
          />
          <button
            disabled={busy !== null || !secret}
            onClick={() =>
              run('secret', async () => {
                await hiveoryClient.setSecret(secret)
                setSecret('')
              })
            }
          >
            {busy === 'secret' ? 'Storing…' : 'Store in credential manager'}
          </button>
        </section>
      </div>
    </section>
  )
}
