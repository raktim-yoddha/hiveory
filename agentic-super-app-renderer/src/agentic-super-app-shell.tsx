import {
  Activity,
  Bell,
  Bot,
  CheckCircle2,
  Code2,
  Columns2,
  Command,
  Download,
  FolderArchive,
  Grid2X2,
  KeyRound,
  Keyboard,
  LayoutTemplate,
  MessageSquare,
  Minus,
  PanelLeft,
  Rows2,
  Settings2,
  Sparkles,
  X,
  Square as SquareIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  agenticSuperAppClient,
  type ApplicationMode,
  type CodePanePreset,
  type DiagnosticSnapshot,
  type UpdateSnapshot,
} from './api/agentic-super-app-client'
import { AgenticSuperAppChat } from './chat/agentic-super-app-chat'
import { AgenticSuperAppCodeWorkspace } from './code-workspace/AgenticSuperAppCodeWorkspace'
import { AgenticSuperAppAgent } from './agent/agentic-super-app-agent'

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
type ShellPreferences = { fontScale: 100 | 110 | 125; compact: boolean; reducedMotion: boolean }
type CommandAction = {
  id: string
  label: string
  description: string
  shortcut?: string
  keywords: string[];
  run: () => void
}

const defaultPreferences: ShellPreferences = { fontScale: 100, compact: false, reducedMotion: false }

const codeLayoutOptions: Array<{
  id: CodePanePreset
  label: string
  description: string
  Icon: typeof LayoutTemplate
}> = [
  { id: 'main_left', label: 'Focus grid', description: 'Main pane left, supporting panes stacked right', Icon: LayoutTemplate },
  { id: 'equal_columns', label: 'Dual grid', description: 'Equal side-by-side columns', Icon: Columns2 },
  { id: 'equal_rows', label: 'Stack grid', description: 'Equal stacked horizontal rows', Icon: Rows2 },
  { id: 'grid', label: 'Quad grid', description: 'Balanced 2 × 2 workspace', Icon: Grid2X2 },
  { id: 'tidy', label: 'Tidy', description: 'Automatically balance the workspace', Icon: Sparkles },
]

function readPreferences(): ShellPreferences {
  if (typeof window === 'undefined') return defaultPreferences
  try {
    const value = JSON.parse(window.localStorage.getItem('agentic-super-app.preferences') ?? '{}') as Partial<ShellPreferences>
    return {
      ...defaultPreferences,
      ...value,
      fontScale: value.fontScale === 110 || value.fontScale === 125 ? value.fontScale : 100,
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

export function AgenticSuperAppShell() {
  const [activeMode, setActiveMode] = useState<ApplicationMode>('code')
  const [screen, setScreen] = useState<ShellScreen>('workspace')
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>(previewSnapshot)
  const [preferences, setPreferences] = useState<ShellPreferences>(readPreferences)
  const [commandOpen, setCommandOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [codeLayoutMenuOpen, setCodeLayoutMenuOpen] = useState(false)

  const refresh = async () => {
    try {
      setSnapshot(await agenticSuperAppClient.diagnostics())
    } catch {
      // preview fallback
    }
  }

  useEffect(() => {
    void agenticSuperAppClient
      .bootstrap()
      .then((item) => {
        setActiveMode(item.active_mode)
      })
      .catch(() => undefined)
    void refresh()
    agenticSuperAppClient.subscribe(() => {
      void refresh()
    })
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--agentic-super-app-font-scale', String(preferences.fontScale / 100))
    document.documentElement.dataset.agenticDensity = preferences.compact ? 'compact' : 'comfortable'
    document.documentElement.dataset.reducedMotion = preferences.reducedMotion ? 'true' : 'false'
    try {
      window.localStorage.setItem('agentic-super-app.preferences', JSON.stringify(preferences))
    } catch {
      // optional
    }
  }, [preferences])

  const selectMode = (mode: ApplicationMode) => {
    setScreen('workspace')
    setNotificationsOpen(false)
    setCodeLayoutMenuOpen(false)
    setActiveMode(mode)
    void agenticSuperAppClient
      .setActiveMode(mode)
      .then((item) => setActiveMode(item.active_mode))
      .catch(() => undefined)
  }

  const handleMinimize = () => {
    try {
      const win = getCurrentWindow()
      void win.minimize()
    } catch {
      // not in tauri
    }
  }

  const handleToggleMaximize = () => {
    try {
      const win = getCurrentWindow()
      void win.toggleMaximize()
    } catch {
      // not in tauri
    }
  }

  const handleCloseWindow = () => {
    try {
      const win = getCurrentWindow()
      void win.close()
    } catch {
      // not in tauri
    }
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
    window.addEventListener('agentic-super-app-open-code-layout-menu', openCodeLayoutMenu)
    return () => window.removeEventListener('agentic-super-app-open-code-layout-menu', openCodeLayoutMenu)
  }, [activeMode, screen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
        setNotificationsOpen(false)
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
      <a className="agentic-super-app-skip-link" href="#agentic-super-app-main-content">
        Skip to main content
      </a>
      <main className="agentic-super-app-shell">
        {/* Unified Frameless Window Header / Titlebar */}
        <header
          className="agentic-super-app-titlebar"
          data-tauri-drag-region
          onDoubleClick={handleToggleMaximize}
        >
          <div className="agentic-super-app-brand" data-tauri-drag-region>
            <span style={{ color: '#f59e0b', fontSize: 16, lineHeight: 1 }}>⚡</span>
            <span>Agentic Super App</span>
            <PanelLeft size={15} style={{ opacity: 0.5, cursor: 'pointer', marginLeft: 8 }} />
          </div>

          <nav className="agentic-super-app-mode-switch" aria-label="Workspace mode">
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

          <div className="agentic-super-app-title-actions">
            {screen === 'workspace' && activeMode === 'code' && (
              <div className="agentic-super-app-layout-menu">
                <button
                  type="button"
                  className="agentic-super-app-title-action"
                  aria-haspopup="menu"
                  aria-expanded={codeLayoutMenuOpen}
                  onClick={() => setCodeLayoutMenuOpen((value) => !value)}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  Tidy
                  <span className="agentic-super-app-layout-chevron" aria-hidden="true">⌄</span>
                </button>
                {codeLayoutMenuOpen && (
                  <div className="agentic-super-app-layout-dropdown" role="menu" aria-label="Workspace layout">
                    {codeLayoutOptions.map(({ id, label, description, Icon }) => (
                      <button
                        type="button"
                        key={id}
                        role="menuitem"
                        className="agentic-super-app-layout-option"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('agentic-super-app-apply-code-layout-preset', { detail: { preset: id } }))
                          setCodeLayoutMenuOpen(false)
                        }}
                      >
                        <span className="agentic-super-app-layout-option-icon"><Icon size={14} aria-hidden="true" /></span>
                        <span>
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="agentic-super-app-icon-button agentic-super-app-command-trigger"
              onClick={() => {
                setCommandOpen(true)
                setNotificationsOpen(false)
              }}
              aria-label="Open command palette"
              title="Command palette (Ctrl K)"
            >
              <Command size={15} />
            </button>

            <button
              type="button"
              className={
                notificationsOpen
                  ? 'agentic-super-app-icon-button is-active agentic-super-app-notification-trigger'
                  : 'agentic-super-app-icon-button agentic-super-app-notification-trigger'
              }
              onClick={() => {
                setNotificationsOpen((value) => !value)
                setCommandOpen(false)
                void refresh()
              }}
              aria-label={`Open notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`}
              title="Notifications"
            >
              <Bell size={15} />
              {unreadNotifications > 0 && (
                <span className="agentic-super-app-notification-count">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </button>

            <button
              type="button"
              className={screen === 'settings' ? 'agentic-super-app-icon-button is-active' : 'agentic-super-app-icon-button'}
              onClick={() => {
                setScreen(screen === 'settings' ? 'workspace' : 'settings')
                setCommandOpen(false)
              }}
              aria-label="Open settings"
              title="Settings (Ctrl ,)"
            >
              <Settings2 size={15} />
            </button>

            {/* Window Controls (Minimize, Maximize, Close) */}
            <div className="agentic-window-controls" data-tauri-drag-region="false">
              <button
                type="button"
                className="agentic-win-btn minimize"
                onClick={handleMinimize}
                title="Minimize"
                aria-label="Minimize"
              >
                <Minus size={13} />
              </button>
              <button
                type="button"
                className="agentic-win-btn maximize"
                onClick={handleToggleMaximize}
                title="Maximize"
                aria-label="Maximize"
              >
                <SquareIcon size={11} />
              </button>
              <button
                type="button"
                className="agentic-win-btn close"
                onClick={handleCloseWindow}
                title="Close"
                aria-label="Close"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Workspace Container */}
        <section
          id="agentic-super-app-main-content"
          tabIndex={-1}
          className="agentic-super-app-workspace is-code-app"
        >
          {screen === 'diagnostics' ? (
            <AgenticSuperAppDiagnostics snapshot={snapshot} refresh={refresh} />
          ) : screen === 'settings' ? (
            <AgenticSuperAppSettings
              preferences={preferences}
              setPreferences={setPreferences}
              onOpenDiagnostics={() => {
                setScreen('diagnostics')
                void refresh()
              }}
            />
          ) : activeMode === 'agent' ? (
            <AgenticSuperAppAgent />
          ) : activeMode === 'chat' ? (
            <AgenticSuperAppChat />
          ) : (
            <AgenticSuperAppCodeWorkspace />
          )}
        </section>

        {notificationsOpen && (
          <AgenticSuperAppNotificationCenter
            notifications={snapshot.notifications}
            onClose={() => setNotificationsOpen(false)}
            onRead={async (id) => {
              await agenticSuperAppClient.markNotificationRead(id)
              await refresh()
            }}
            onReadAll={async () => {
              await agenticSuperAppClient.markAllNotificationsRead()
              await refresh()
            }}
          />
        )}

        {commandOpen && (
          <AgenticSuperAppCommandPalette actions={commandActions} onClose={() => setCommandOpen(false)} />
        )}
      </main>
    </>
  )
}

function AgenticSuperAppCommandPalette({
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
    <div className="agentic-super-app-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="agentic-super-app-command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agentic-super-app-command-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="agentic-super-app-command-heading">
          <div>
            <p className="agentic-super-app-eyebrow">Workspace control</p>
            <h2 id="agentic-super-app-command-title">Command palette</h2>
          </div>
          <button
            type="button"
            className="agentic-super-app-icon-button"
            onClick={onClose}
            aria-label="Close command palette"
          >
            <X size={16} />
          </button>
        </div>
        <label className="agentic-super-app-command-search">
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
        <div className="agentic-super-app-command-list" role="listbox" aria-label="Available commands">
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
            <p className="agentic-super-app-command-empty">No actions match “{query}”.</p>
          )}
        </div>
        <footer className="agentic-super-app-command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
        </footer>
      </section>
    </div>
  )
}

function AgenticSuperAppNotificationCenter({
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
      className="agentic-super-app-notification-center"
      role="dialog"
      aria-modal="false"
      aria-labelledby="agentic-super-app-notification-title"
    >
      <div className="agentic-super-app-notification-heading">
        <div>
          <p className="agentic-super-app-eyebrow">Activity stream</p>
          <h2 id="agentic-super-app-notification-title">Notifications</h2>
        </div>
        <div className="agentic-super-app-notification-heading-actions">
          {notifications.some((item) => !item.read) && (
            <button type="button" className="agentic-super-app-text-button" onClick={() => void onReadAll()}>
              Mark all read
            </button>
          )}
          <button type="button" className="agentic-super-app-icon-button" onClick={onClose} aria-label="Close notifications">
            <X size={16} />
          </button>
        </div>
      </div>
      {notifications.length ? (
        <div className="agentic-super-app-notification-list">
          {notifications.map((item) => (
            <article key={item.id} className={item.read ? '' : 'is-unread'}>
              <span className={`agentic-super-app-notification-severity ${item.severity}`} aria-label={item.severity}>
                <CheckCircle2 size={14} aria-hidden="true" />
              </span>
              <div>
                <div className="agentic-super-app-notification-row-title">
                  <strong>{item.title}</strong>
                  {!item.read && (
                    <button type="button" className="agentic-super-app-text-button" onClick={() => void onRead(item.id)}>
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
        <div className="agentic-super-app-notification-empty">
          <Bell size={22} aria-hidden="true" />
          <p>No notifications yet.</p>
          <small>Run completions, approvals, and recovery events will appear here.</small>
        </div>
      )}
    </aside>
  )
}

function AgenticSuperAppSettings({
  preferences,
  setPreferences,
  onOpenDiagnostics,
}: {
  preferences: ShellPreferences
  setPreferences: React.Dispatch<React.SetStateAction<ShellPreferences>>
  onOpenDiagnostics: () => void
}) {
  const [update, setUpdate] = useState<UpdateSnapshot | null>(null)
  const [version, setVersion] = useState('1.0.0')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void agenticSuperAppClient.buildInformation().then((info) => setVersion(info.version)).catch(() => undefined)
  }, [])

  const action = async (name: string, work: () => Promise<string | void>) => {
    setBusy(name)
    setMessage(null)
    try {
      setMessage((await work()) ?? 'Completed.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The action could not be completed.')
    } finally {
      setBusy(null)
    }
  }

  const checkUpdate = () =>
    action('update', async () => {
      const next = await agenticSuperAppClient.checkForUpdate()
      setUpdate(next)
      return next.status === 'available'
        ? `Version ${next.available_version} is ready to install.`
        : next.status === 'not_configured'
        ? 'This build has no signed update channel configured.'
        : 'You are up to date.'
    })

  const installUpdate = () =>
    action('install', async () => {
      await agenticSuperAppClient.installUpdate()
      return 'Update installation started. The application will restart when ready.'
    })

  const createBackup = () =>
    action('backup', async () => {
      const destination = await agenticSuperAppClient.chooseBackupDestination()
      if (!destination) return 'Backup cancelled.'
      const summary = await agenticSuperAppClient.createBackup(destination)
      return `Backup saved to ${summary.path} (${formatBytes(summary.bytes)}).`
    })

  const restoreBackup = () =>
    action('restore', async () => {
      if (!window.confirm('Restore will restart the application and replace its local database and artifacts. Continue?')) {
        return 'Restore cancelled.'
      }
      const source = await agenticSuperAppClient.chooseBackupSource()
      if (!source) return 'Restore cancelled.'
      await agenticSuperAppClient.prepareRestore(source)
      return 'Restore staged. The application will restart.'
    })

  return (
    <section className="agentic-super-app-settings agentic-super-app-content" aria-labelledby="agentic-super-app-settings-title">
      <div className="agentic-super-app-content-header">
        <Settings2 size={22} aria-hidden="true" />
        <div>
          <p className="agentic-super-app-eyebrow">Global preferences</p>
          <h1 id="agentic-super-app-settings-title">Settings</h1>
        </div>
      </div>
      <p className="agentic-super-app-description">
        Tune the shared shell, protect local data, and verify the release channel. Secrets remain in the operating-system credential manager.
      </p>
      <div className="agentic-super-app-settings-grid">
        <section className="agentic-super-app-settings-card">
          <div className="agentic-super-app-card-heading">
            <Keyboard size={17} aria-hidden="true" />
            <h2>Appearance and access</h2>
          </div>
          <label htmlFor="agentic-super-app-font-scale">Interface scale</label>
          <select
            id="agentic-super-app-font-scale"
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
          <label className="agentic-super-app-settings-check">
            <input
              type="checkbox"
              checked={preferences.compact}
              onChange={(event) => setPreferences((current) => ({ ...current, compact: event.target.checked }))}
            />
            Compact navigation density
          </label>
          <label className="agentic-super-app-settings-check">
            <input
              type="checkbox"
              checked={preferences.reducedMotion}
              onChange={(event) => setPreferences((current) => ({ ...current, reducedMotion: event.target.checked }))}
            />
            Reduce interface motion
          </label>
          <p>Keyboard shortcuts: <kbd>Ctrl K</kbd> palette, <kbd>Ctrl 1–3</kbd> modes, <kbd>Ctrl ,</kbd> settings.</p>
        </section>
        <section className="agentic-super-app-settings-card">
          <div className="agentic-super-app-card-heading">
            <FolderArchive size={17} aria-hidden="true" />
            <h2>Local data</h2>
          </div>
          <p>Backups include a consistent SQLite snapshot and application-managed artifacts.</p>
          <div className="agentic-super-app-settings-actions">
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
        <section className="agentic-super-app-settings-card">
          <div className="agentic-super-app-card-heading">
            <Download size={17} aria-hidden="true" />
            <h2>Updates</h2>
          </div>
          <p>Updates are signature-verified and only run when this build has an HTTPS endpoint configured.</p>
          <div className="agentic-super-app-settings-version">
            <span>Installed version</span>
            <strong>{version}</strong>
          </div>
          <button type="button" disabled={busy !== null} onClick={checkUpdate}>
            {busy === 'update' ? 'Checking…' : 'Check for updates'}
          </button>
          {update?.status === 'available' && (
            <button type="button" disabled={busy !== null} onClick={installUpdate}>
              {busy === 'install' ? 'Installing…' : `Install ${update.available_version}`}
            </button>
          )}
        </section>
      </div>
      {message && <div className="agentic-super-app-feedback" role="status">{message}</div>}
    </section>
  )
}

function AgenticSuperAppDiagnostics({
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
    <section className="agentic-super-app-diagnostics" aria-labelledby="agentic-super-app-diagnostics-title">
      <div className="agentic-super-app-content-header">
        <Settings2 size={22} aria-hidden="true" />
        <div>
          <p className="agentic-super-app-eyebrow">Global utility</p>
          <h1 id="agentic-super-app-diagnostics-title">Diagnostics</h1>
        </div>
      </div>
      <div className="agentic-super-app-diagnostic-grid">
        <section className="agentic-super-app-diagnostic-card">
          <div className="agentic-super-app-card-heading">
            <KeyRound size={17} />
            <h2>OpenAI Responses</h2>
          </div>
          <label htmlFor="agentic-super-app-secret">API key</label>
          <input
            id="agentic-super-app-secret"
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
                await agenticSuperAppClient.setSecret(secret)
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
