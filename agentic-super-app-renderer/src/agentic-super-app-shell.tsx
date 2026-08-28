import { Activity, Bell, Bot, CheckCircle2, Clock3, Code2, Command, Download, FolderArchive, KeyRound, Keyboard, LayoutDashboard, MessageSquare, PanelLeft, Play, Puzzle, RotateCcw, Settings2, ShieldCheck, Sparkles, Square, Wifi, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { agenticSuperAppClient, type ApplicationMode, type DiagnosticSnapshot, type SharedEventEnvelope, type UpdateSnapshot } from './api/agentic-super-app-client'
import { AgenticSuperAppChat } from './chat/agentic-super-app-chat'
import { AgenticSuperAppPlugins } from './automation/agentic-super-app-plugins'
import { AgenticSuperAppRoutines } from './automation/agentic-super-app-routines'
const AgenticSuperAppCode = lazy(() => import('./code/agentic-super-app-code').then((module) => ({ default: module.AgenticSuperAppCode })))
const AgenticSuperAppCodeRuns = lazy(() => import('./code/agentic-super-app-code-runs').then((module) => ({ default: module.AgenticSuperAppCodeRuns })))
const AgenticSuperAppAgent = lazy(() => import('./agent/agentic-super-app-agent').then((module) => ({ default: module.AgenticSuperAppAgent })))

type ModeDefinition = { mode: ApplicationMode; label: string; description: string; icon: typeof Bot; navigation: string[] }
const modes: ModeDefinition[] = [
  { mode: 'agent', label: 'Agent', description: 'Named assistants, explicit tools, durable runs, and inspectable memory.', icon: Bot, navigation: ['Workspace', 'Runs', 'Routines', 'Plugins', 'Skills'] },
  { mode: 'code', label: 'Code', description: 'Projects, worker lanes, checkpoints, and reviewable runs live here.', icon: Code2, navigation: ['Workbench', 'Runs'] },
  { mode: 'chat', label: 'Chat', description: 'Focused conversations and artifacts will appear here.', icon: MessageSquare, navigation: ['Conversations', 'Artifacts', 'Archive'] },
]
const previewSnapshot: DiagnosticSnapshot = { providers: [], recent_jobs: [], notifications: [], recovery_message: null }
type ShellScreen = 'workspace' | 'diagnostics' | 'settings'
type GlobalSection = 'dashboard' | 'routines' | 'plugins' | 'skills'
type ShellPreferences = { fontScale: 100 | 110 | 125; compact: boolean; reducedMotion: boolean }
type CommandAction = { id: string; label: string; description: string; shortcut?: string; keywords: string[]; run: () => void }
const defaultPreferences: ShellPreferences = { fontScale: 100, compact: false, reducedMotion: false }

function readPreferences(): ShellPreferences {
  if (typeof window === 'undefined') return defaultPreferences
  try {
    const value = JSON.parse(window.localStorage.getItem('agentic-super-app.preferences') ?? '{}') as Partial<ShellPreferences>
    return { ...defaultPreferences, ...value, fontScale: value.fontScale === 110 || value.fontScale === 125 ? value.fontScale : 100 }
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
  const [activeMode, setActiveMode] = useState<ApplicationMode>('agent')
  const [codeScreen, setCodeScreen] = useState<'workbench' | 'runs'>('workbench')
  const [agentScreen, setAgentScreen] = useState<'workspace' | 'runs' | 'routines' | 'plugins' | 'skills'>('workspace')
  const [globalSection, setGlobalSection] = useState<GlobalSection>('dashboard')
  const [screen, setScreen] = useState<ShellScreen>('workspace')
  const [connected, setConnected] = useState(false)
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>(previewSnapshot)
  const [events, setEvents] = useState<SharedEventEnvelope[]>([])
  const [preferences, setPreferences] = useState<ShellPreferences>(readPreferences)
  const [commandOpen, setCommandOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const definition = useMemo(() => modes.find((item) => item.mode === activeMode)!, [activeMode])
  const refresh = async () => { try { setSnapshot(await agenticSuperAppClient.diagnostics()) } catch { /* the shell remains usable when diagnostics are unavailable */ } }

  useEffect(() => {
    void agenticSuperAppClient.bootstrap().then((item) => { setActiveMode(item.active_mode); setConnected(true) }).catch(() => setConnected(false))
    void refresh()
    agenticSuperAppClient.subscribe((event) => { setEvents((items) => [event, ...items].slice(0, 30)); void refresh() })
  }, [])
  useEffect(() => {
    document.documentElement.style.setProperty('--agentic-super-app-font-scale', String(preferences.fontScale / 100))
    document.documentElement.dataset.agenticDensity = preferences.compact ? 'compact' : 'comfortable'
    document.documentElement.dataset.reducedMotion = preferences.reducedMotion ? 'true' : 'false'
    try { window.localStorage.setItem('agentic-super-app.preferences', JSON.stringify(preferences)) } catch { /* local preferences are optional */ }
  }, [preferences])
  const selectMode = (mode: ApplicationMode) => { setScreen('workspace'); setGlobalSection('dashboard'); setNotificationsOpen(false); if (mode === 'code') setCodeScreen('workbench'); if (mode === 'agent') setAgentScreen('workspace'); setActiveMode(mode); void agenticSuperAppClient.setActiveMode(mode).then((item) => setActiveMode(item.active_mode)).catch(() => undefined) }
  const selectGlobalSection = (section: GlobalSection) => { setScreen('workspace'); setGlobalSection(section); setNotificationsOpen(false) }
  const selectAgentScreen = (item: string) => { if (item === 'Runs' || item === 'Routines' || item === 'Plugins' || item === 'Skills') setAgentScreen(item.toLowerCase() as 'runs' | 'routines' | 'plugins' | 'skills'); else setAgentScreen('workspace') }
  const agentPanel = agentScreen === 'runs' ? 'runs' : agentScreen === 'skills' ? 'skills' : 'overview'
  const commandActions: CommandAction[] = [
    ...modes.map(({ mode, label, description }) => ({ id: `mode-${mode}`, label: `Switch to ${label}`, description, shortcut: mode === 'agent' ? 'Ctrl 1' : mode === 'code' ? 'Ctrl 2' : 'Ctrl 3', keywords: [label, 'mode', 'workspace'], run: () => selectMode(mode) })),
    { id: 'diagnostics', label: 'Open diagnostics', description: 'Inspect providers, jobs, notifications, and recovery state.', shortcut: 'Ctrl Shift D', keywords: ['system', 'health', 'provider'], run: () => { setScreen('diagnostics'); setCommandOpen(false); void refresh() } },
    { id: 'settings', label: 'Open settings', description: 'Manage appearance, backups, updates, and privacy controls.', shortcut: 'Ctrl ,', keywords: ['preferences', 'backup', 'update', 'privacy'], run: () => { setScreen('settings'); setCommandOpen(false) } },
    { id: 'notifications', label: 'Open notifications', description: 'Review durable in-app notifications.', shortcut: 'Ctrl Shift N', keywords: ['alerts', 'activity'], run: () => { setNotificationsOpen(true); setCommandOpen(false); void refresh() } },
  ]
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); setNotificationsOpen(false) }
      if (modifier && event.key === ',') { event.preventDefault(); setScreen('settings'); setCommandOpen(false) }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'd') { event.preventDefault(); setScreen('diagnostics'); setCommandOpen(false); void refresh() }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'n') { event.preventDefault(); setNotificationsOpen(true); setCommandOpen(false); void refresh() }
      if (modifier && !event.shiftKey && ['1', '2', '3'].includes(event.key)) { const shortcutMode: ApplicationMode | undefined = ({ '1': 'agent', '2': 'code', '3': 'chat' } as Record<string, ApplicationMode>)[event.key]; if (shortcutMode) { event.preventDefault(); selectMode(shortcutMode) } }
      if (event.key === 'Escape') { setCommandOpen(false); setNotificationsOpen(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
  const unreadNotifications = snapshot.notifications.filter((item) => !item.read).length
  return <>
    <a className="agentic-super-app-skip-link" href="#agentic-super-app-main-content">Skip to main content</a>
    <main className="agentic-super-app-shell">
    <header className="agentic-super-app-titlebar">
      <div className="agentic-super-app-brand"><PanelLeft size={16} aria-hidden="true" /><span>Agentic Super App</span></div>
      <nav className="agentic-super-app-mode-switch" aria-label="Workspace mode">{modes.map(({ mode, label, icon: Icon }) => <button type="button" key={mode} className={mode === activeMode && screen === 'workspace' ? 'is-active' : ''} onClick={() => selectMode(mode)} aria-pressed={mode === activeMode && screen === 'workspace'} aria-keyshortcuts={`Control+${mode === 'agent' ? '1' : mode === 'code' ? '2' : '3'}`}><Icon size={15} aria-hidden="true" />{label}</button>)}</nav>
      <div className="agentic-super-app-title-actions">
        <button type="button" className="agentic-super-app-icon-button agentic-super-app-command-trigger" onClick={() => { setCommandOpen(true); setNotificationsOpen(false) }} aria-label="Open command palette" title="Command palette (Ctrl K)"><Command size={16} /></button>
        <button type="button" className={notificationsOpen ? 'agentic-super-app-icon-button is-active agentic-super-app-notification-trigger' : 'agentic-super-app-icon-button agentic-super-app-notification-trigger'} onClick={() => { setNotificationsOpen((value) => !value); setCommandOpen(false); void refresh() }} aria-label={`Open notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`} title="Notifications"><Bell size={16} />{unreadNotifications > 0 && <span className="agentic-super-app-notification-count">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}</button>
        <button type="button" className={screen === 'diagnostics' ? 'agentic-super-app-icon-button is-active' : 'agentic-super-app-icon-button'} onClick={() => { setScreen('diagnostics'); setCommandOpen(false); void refresh() }} aria-label="Open diagnostics" title="Diagnostics"><Activity size={16} /></button>
        <button type="button" className={screen === 'settings' ? 'agentic-super-app-icon-button is-active' : 'agentic-super-app-icon-button'} onClick={() => { setScreen('settings'); setCommandOpen(false) }} aria-label="Open settings" title="Settings (Ctrl ,)"><Settings2 size={16} /></button>
        <div className="agentic-super-app-connection" aria-label={connected ? 'Connected to local host' : 'Preview mode'}><ShieldCheck size={15} aria-hidden="true" />{connected ? 'Local host' : 'Preview'}</div>
      </div>
    </header>
    <section id="agentic-super-app-main-content" tabIndex={-1} className={`agentic-super-app-workspace ${screen === 'workspace' && activeMode === 'chat' ? 'is-chat-mode' : ''} ${screen === 'workspace' && activeMode === 'code' ? 'is-code-mode' : ''}`}>
      <aside className="agentic-super-app-rail" aria-label={screen === 'workspace' ? 'Application navigation' : 'Global navigation'}>
        {screen !== 'workspace' ? <><div className="agentic-super-app-rail-heading">System</div><button type="button" className={screen === 'diagnostics' ? 'is-selected' : ''} onClick={() => { setScreen('diagnostics'); void refresh() }} aria-current={screen === 'diagnostics' ? 'page' : undefined}><Activity size={15} aria-hidden="true" />Diagnostics</button><button type="button" className={screen === 'settings' ? 'is-selected' : ''} onClick={() => setScreen('settings')} aria-current={screen === 'settings' ? 'page' : undefined}><Settings2 size={15} aria-hidden="true" />Settings</button><button type="button" onClick={() => setScreen('workspace')}><PanelLeft size={15} aria-hidden="true" />Workspaces</button></> : <><div className="agentic-super-app-rail-heading">Workspace</div><button type="button" className={globalSection === 'dashboard' ? 'is-selected' : ''} onClick={() => selectGlobalSection('dashboard')}><LayoutDashboard size={15} aria-hidden="true" />Dashboard</button><button type="button" className={globalSection === 'routines' ? 'is-selected' : ''} onClick={() => selectGlobalSection('routines')}><Clock3 size={15} aria-hidden="true" />Routines</button><button type="button" className={globalSection === 'plugins' ? 'is-selected' : ''} onClick={() => selectGlobalSection('plugins')}><Puzzle size={15} aria-hidden="true" />Plugins</button><button type="button" className={globalSection === 'skills' ? 'is-selected' : ''} onClick={() => selectGlobalSection('skills')}><Sparkles size={15} aria-hidden="true" />Skills</button><div className="agentic-super-app-rail-divider" /><div className="agentic-super-app-rail-heading">{definition.label}</div>{definition.navigation.filter((item) => !['Routines', 'Plugins', 'Skills'].includes(item)).map((item) => <button type="button" key={item} className={activeMode === 'code' && ((item === 'Runs' && codeScreen === 'runs') || (item === 'Workbench' && codeScreen === 'workbench')) || activeMode === 'agent' && ((item === 'Workspace' && agentScreen === 'workspace') || item.toLowerCase() === agentScreen) ? 'is-selected' : ''} onClick={() => { if (activeMode === 'code') setCodeScreen(item === 'Runs' ? 'runs' : 'workbench'); if (activeMode === 'agent') selectAgentScreen(item) }}>{item}</button>)}</>}
        <div className="agentic-super-app-rail-footer"><button type="button" className="agentic-super-app-rail-action" onClick={() => setCommandOpen(true)}><Keyboard size={14} aria-hidden="true" />Command palette <kbd>Ctrl K</kbd></button><button type="button" className="agentic-super-app-rail-action" onClick={() => setScreen('settings')}><Settings2 size={14} aria-hidden="true" />Settings</button><span className="agentic-super-app-rail-version">v1.0.0 · local-first</span></div>
      </aside>
      {screen === 'diagnostics' ? <AgenticSuperAppDiagnostics snapshot={snapshot} events={events} refresh={refresh} /> : screen === 'settings' ? <AgenticSuperAppSettings preferences={preferences} setPreferences={setPreferences} onOpenDiagnostics={() => { setScreen('diagnostics'); void refresh() }} /> : globalSection === 'routines' ? <AgenticSuperAppRoutines /> : globalSection === 'plugins' ? <AgenticSuperAppPlugins /> : globalSection === 'skills' ? <Suspense fallback={<section className="agentic-super-app-content" role="status">Loading skills…</section>}><AgenticSuperAppAgent initialPanel="skills" /></Suspense> : activeMode === 'chat' ? <AgenticSuperAppChat /> : activeMode === 'code' ? <Suspense fallback={<section className="agentic-super-app-content" role="status">Loading Code workspace…</section>}>{codeScreen === 'runs' ? <AgenticSuperAppCodeRuns /> : <AgenticSuperAppCode />}</Suspense> : agentScreen === 'routines' ? <AgenticSuperAppRoutines /> : agentScreen === 'plugins' ? <AgenticSuperAppPlugins /> : <Suspense fallback={<section className="agentic-super-app-content" role="status">Loading Agent workspace…</section>}><AgenticSuperAppAgent initialPanel={agentPanel} /></Suspense>}
    </section>
    <span className="agentic-super-app-sr-only" aria-live="polite">{connected ? 'Connected to the local application host.' : 'Running in browser preview mode.'}</span>
    {notificationsOpen && <AgenticSuperAppNotificationCenter notifications={snapshot.notifications} onClose={() => setNotificationsOpen(false)} onRead={async (id) => { await agenticSuperAppClient.markNotificationRead(id); await refresh() }} onReadAll={async () => { await agenticSuperAppClient.markAllNotificationsRead(); await refresh() }} />}
    {commandOpen && <AgenticSuperAppCommandPalette actions={commandActions} onClose={() => setCommandOpen(false)} />}
    </main>
  </>
}

function AgenticSuperAppCommandPalette({ actions, onClose }: { actions: CommandAction[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtered = actions.filter((action) => `${action.label} ${action.description} ${action.keywords.join(' ')}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12)
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSelected(0) }, [query])
  const runSelected = () => { const action = filtered[selected]; if (!action) return; onClose(); action.run() }
  return <div className="agentic-super-app-overlay" role="presentation" onMouseDown={onClose}><section className="agentic-super-app-command-palette" role="dialog" aria-modal="true" aria-labelledby="agentic-super-app-command-title" onMouseDown={(event) => event.stopPropagation()}>
    <div className="agentic-super-app-command-heading"><div><p className="agentic-super-app-eyebrow">Workspace control</p><h2 id="agentic-super-app-command-title">Command palette</h2></div><button type="button" className="agentic-super-app-icon-button" onClick={onClose} aria-label="Close command palette"><X size={16} /></button></div>
    <label className="agentic-super-app-command-search"><Command size={16} aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, filtered.length - 1)) } if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)) } if (event.key === 'Enter') { event.preventDefault(); runSelected() } if (event.key === 'Escape') { event.preventDefault(); onClose() } }} placeholder="Search actions…" aria-label="Search commands" /></label>
    <div className="agentic-super-app-command-list" role="listbox" aria-label="Available commands">{filtered.length ? filtered.map((action, index) => <button type="button" role="option" aria-selected={index === selected} key={action.id} className={index === selected ? 'is-selected' : ''} onMouseEnter={() => setSelected(index)} onClick={() => { onClose(); action.run() }}><span><strong>{action.label}</strong><small>{action.description}</small></span>{action.shortcut && <kbd>{action.shortcut}</kbd>}</button>) : <p className="agentic-super-app-command-empty">No actions match “{query}”.</p>}</div>
    <footer className="agentic-super-app-command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></footer>
  </section></div>
}

function AgenticSuperAppNotificationCenter({ notifications, onClose, onRead, onReadAll }: { notifications: DiagnosticSnapshot['notifications']; onClose: () => void; onRead: (id: string) => Promise<void>; onReadAll: () => Promise<void> }) {
  return <aside className="agentic-super-app-notification-center" role="dialog" aria-modal="false" aria-labelledby="agentic-super-app-notification-title"><div className="agentic-super-app-notification-heading"><div><p className="agentic-super-app-eyebrow">Activity stream</p><h2 id="agentic-super-app-notification-title">Notifications</h2></div><div className="agentic-super-app-notification-heading-actions">{notifications.some((item) => !item.read) && <button type="button" className="agentic-super-app-text-button" onClick={() => void onReadAll()}>Mark all read</button>}<button type="button" className="agentic-super-app-icon-button" onClick={onClose} aria-label="Close notifications"><X size={16} /></button></div></div>{notifications.length ? <div className="agentic-super-app-notification-list">{notifications.map((item) => <article key={item.id} className={item.read ? '' : 'is-unread'}><span className={`agentic-super-app-notification-severity ${item.severity}`} aria-label={item.severity}><CheckCircle2 size={14} aria-hidden="true" /></span><div><div className="agentic-super-app-notification-row-title"><strong>{item.title}</strong>{!item.read && <button type="button" className="agentic-super-app-text-button" onClick={() => void onRead(item.id)}>Mark read</button>}</div><p>{item.body}</p><time dateTime={new Date(item.created_at_unix_ms).toISOString()}>{new Date(item.created_at_unix_ms).toLocaleString()}</time></div></article>)}</div> : <div className="agentic-super-app-notification-empty"><Bell size={22} aria-hidden="true" /><p>No notifications yet.</p><small>Run completions, approvals, and recovery events will appear here.</small></div>}</aside>
}

function AgenticSuperAppSettings({ preferences, setPreferences, onOpenDiagnostics }: { preferences: ShellPreferences; setPreferences: React.Dispatch<React.SetStateAction<ShellPreferences>>; onOpenDiagnostics: () => void }) {
  const [update, setUpdate] = useState<UpdateSnapshot | null>(null)
  const [version, setVersion] = useState('1.0.0')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { void agenticSuperAppClient.buildInformation().then((info) => setVersion(info.version)).catch(() => undefined) }, [])
  const action = async (name: string, work: () => Promise<string | void>) => { setBusy(name); setMessage(null); try { setMessage((await work()) ?? 'Completed.') } catch (error) { setMessage(error instanceof Error ? error.message : 'The action could not be completed.') } finally { setBusy(null) } }
  const checkUpdate = () => action('update', async () => { const next = await agenticSuperAppClient.checkForUpdate(); setUpdate(next); return next.status === 'available' ? `Version ${next.available_version} is ready to install.` : next.status === 'not_configured' ? 'This build has no signed update channel configured.' : 'You are up to date.' })
  const installUpdate = () => action('install', async () => { await agenticSuperAppClient.installUpdate(); return 'Update installation started. The application will restart when ready.' })
  const createBackup = () => action('backup', async () => { const destination = await agenticSuperAppClient.chooseBackupDestination(); if (!destination) return 'Backup cancelled.'; const summary = await agenticSuperAppClient.createBackup(destination); return `Backup saved to ${summary.path} (${formatBytes(summary.bytes)}).` })
  const restoreBackup = () => action('restore', async () => { if (!window.confirm('Restore will restart the application and replace its local database and artifacts. Continue?')) return 'Restore cancelled.'; const source = await agenticSuperAppClient.chooseBackupSource(); if (!source) return 'Restore cancelled.'; await agenticSuperAppClient.prepareRestore(source); return 'Restore staged. The application will restart.' })
  return <section className="agentic-super-app-settings agentic-super-app-content" aria-labelledby="agentic-super-app-settings-title">
    <div className="agentic-super-app-content-header"><Settings2 size={22} aria-hidden="true" /><div><p className="agentic-super-app-eyebrow">Global preferences</p><h1 id="agentic-super-app-settings-title">Settings</h1></div></div>
    <p className="agentic-super-app-description">Tune the shared shell, protect local data, and verify the release channel. Secrets remain in the operating-system credential manager.</p>
    <div className="agentic-super-app-settings-grid">
      <section className="agentic-super-app-settings-card"><div className="agentic-super-app-card-heading"><Keyboard size={17} aria-hidden="true" /><h2>Appearance and access</h2></div><label htmlFor="agentic-super-app-font-scale">Interface scale</label><select id="agentic-super-app-font-scale" value={preferences.fontScale} onChange={(event) => setPreferences((current) => ({ ...current, fontScale: Number(event.target.value) as ShellPreferences['fontScale'] }))}><option value={100}>100% · Default</option><option value={110}>110% · Comfortable</option><option value={125}>125% · Large</option></select><label className="agentic-super-app-settings-check"><input type="checkbox" checked={preferences.compact} onChange={(event) => setPreferences((current) => ({ ...current, compact: event.target.checked }))} /> Compact navigation density</label><label className="agentic-super-app-settings-check"><input type="checkbox" checked={preferences.reducedMotion} onChange={(event) => setPreferences((current) => ({ ...current, reducedMotion: event.target.checked }))} /> Reduce interface motion</label><p>Keyboard shortcuts: <kbd>Ctrl K</kbd> palette, <kbd>Ctrl 1–3</kbd> modes, <kbd>Ctrl ,</kbd> settings.</p></section>
      <section className="agentic-super-app-settings-card"><div className="agentic-super-app-card-heading"><FolderArchive size={17} aria-hidden="true" /><h2>Local data</h2></div><p>Backups include a consistent SQLite snapshot and application-managed artifacts. Existing data is retained as a pre-restore copy during recovery.</p><div className="agentic-super-app-settings-actions"><button type="button" disabled={busy !== null} onClick={createBackup}>{busy === 'backup' ? 'Creating backup…' : 'Create backup'}</button><button type="button" className="is-secondary" disabled={busy !== null} onClick={restoreBackup}>{busy === 'restore' ? 'Preparing restore…' : 'Restore from backup'}</button></div><button type="button" className="is-secondary" onClick={onOpenDiagnostics}><Activity size={15} aria-hidden="true" />Open diagnostics</button></section>
      <section className="agentic-super-app-settings-card"><div className="agentic-super-app-card-heading"><Download size={17} aria-hidden="true" /><h2>Updates</h2></div><p>Updates are signature-verified and only run when this build has an HTTPS endpoint and public key configured.</p><div className="agentic-super-app-settings-version"><span>Installed version</span><strong>{version}</strong></div><button type="button" disabled={busy !== null} onClick={checkUpdate}>{busy === 'update' ? 'Checking…' : 'Check for updates'}</button>{update?.status === 'available' && <button type="button" disabled={busy !== null} onClick={installUpdate}>{busy === 'install' ? 'Installing…' : `Install ${update.available_version}`}</button>}<span className={`agentic-super-app-update-status ${update?.status ?? 'idle'}`}>{update?.status === 'not_configured' ? 'Update channel not configured' : update?.status === 'up_to_date' ? 'Up to date' : update?.status === 'available' ? 'Update available' : update ? 'Update check failed' : 'Not checked'}</span></section>
      <section className="agentic-super-app-settings-card"><div className="agentic-super-app-card-heading"><ShieldCheck size={17} aria-hidden="true" /><h2>Privacy boundary</h2></div><ul className="agentic-super-app-settings-list"><li>Agent folders and Code workspaces are explicit grants.</li><li>Chat attachments are imported into the private artifact store.</li><li>Provider keys are never returned to the renderer after entry.</li><li>Native notifications are optional and platform-permissioned.</li></ul><p className="agentic-super-app-settings-build">Agentic Super App {version} · protocol 2 · Tauri local host</p></section>
    </div>
    {message && <div className="agentic-super-app-feedback" role="status">{message}</div>}
  </section>
}

function AgenticSuperAppDiagnostics({ snapshot, events, refresh }: { snapshot: DiagnosticSnapshot; events: SharedEventEnvelope[]; refresh: () => void | Promise<void> }) {
  const provider = snapshot.providers[0]
  const [model, setModel] = useState(provider?.default_model ?? '')
  const [secret, setSecret] = useState('')
  const [prompt, setPrompt] = useState('Reply with a concise confirmation that streaming is working.')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<string | null>(null)
  useEffect(() => { if (provider?.default_model) setModel(provider.default_model) }, [provider?.default_model])
  const run = async (name: string, action: () => Promise<void>) => { setBusy(name); setMessage(null); try { await action(); await refresh(); setMessage('Completed.') } catch (error) { setMessage(error instanceof Error ? error.message : 'The action could not be completed.') } finally { setBusy(null) } }
  const start = async () => run('stream', async () => { if (!provider || !model.trim()) throw new Error('Enter a model ID before starting a billable test.'); const jobId = await agenticSuperAppClient.startDiagnostic({ providerAccountId: provider.id, model: model.trim(), prompt }); setActiveJob(jobId); setMessage('Streaming test started.') })
  const nativePermission = async () => run('permission', async () => { if (!agenticSuperAppClient.isTauri) return; if (!await isPermissionGranted()) await requestPermission() })
  return <section className="agentic-super-app-diagnostics" aria-labelledby="agentic-super-app-diagnostics-title">
    <div className="agentic-super-app-content-header"><Settings2 size={22} aria-hidden="true" /><div><p className="agentic-super-app-eyebrow">Global utility</p><h1 id="agentic-super-app-diagnostics-title">Diagnostics</h1></div></div>
    <p className="agentic-super-app-description">Verify shared services before enabling product workflows. Provider requests are opt-in and use a model you explicitly select.</p>
    {snapshot.recovery_message && <div className="agentic-super-app-recovery" role="status"><RotateCcw size={16} />{snapshot.recovery_message}</div>}
    <div className="agentic-super-app-diagnostic-grid">
      <section className="agentic-super-app-diagnostic-card"><div className="agentic-super-app-card-heading"><KeyRound size={17} /><h2>OpenAI Responses</h2></div><label htmlFor="agentic-super-app-secret">API key</label><input id="agentic-super-app-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={provider?.secret_configured ? 'Stored securely' : 'Paste API key'} autoComplete="off" /><button disabled={busy !== null || !secret} onClick={() => run('secret', async () => { await agenticSuperAppClient.setSecret(secret); setSecret('') })}>{busy === 'secret' ? 'Storing…' : 'Store in credential manager'}</button><label htmlFor="agentic-super-app-model">Model ID</label><input id="agentic-super-app-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Choose a model ID" /><div className="agentic-super-app-inline-actions"><button disabled={busy !== null || !model.trim()} onClick={() => run('model', () => agenticSuperAppClient.configureModel(model.trim()))}>Save model</button><button className="is-secondary" disabled={busy !== null || !provider?.secret_configured} onClick={() => run('validate', () => agenticSuperAppClient.validateProvider())}>{busy === 'validate' ? 'Validating…' : 'Validate key'}</button></div></section>
      <section className="agentic-super-app-diagnostic-card"><div className="agentic-super-app-card-heading"><Wifi size={17} /><h2>Streaming test</h2></div><label htmlFor="agentic-super-app-prompt">Diagnostic prompt</label><textarea id="agentic-super-app-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} /><button disabled={busy !== null || !provider?.secret_configured || !model.trim()} onClick={start}><Play size={15} />{busy === 'stream' ? 'Starting…' : 'Start billable stream'}</button>{activeJob && <button className="is-danger" disabled={busy !== null} onClick={() => run('cancel', async () => { await agenticSuperAppClient.cancelJob(activeJob); setActiveJob(null) })}><Square size={14} />Cancel active stream</button>}<div className="agentic-super-app-live-log" aria-live="polite">{events.length ? events.map((event) => <p key={event.sequence}><span>{event.kind.replaceAll('_', ' ')}</span>{event.text_delta ?? event.message ?? 'Event received'}</p>) : <p>No live events yet.</p>}</div></section>
      <section className="agentic-super-app-diagnostic-card"><div className="agentic-super-app-card-heading"><Bell size={17} /><h2>Notifications and recovery</h2></div><p>Every notification is retained in-app. Native delivery needs your platform permission.</p><button className="is-secondary" disabled={busy !== null} onClick={nativePermission}>{busy === 'permission' ? 'Requesting…' : 'Request native permission'}</button><button disabled={busy !== null} onClick={() => run('notify', () => agenticSuperAppClient.testNotification())}>Send test notification</button><button className="is-secondary" disabled={busy !== null} onClick={() => run('restart', () => agenticSuperAppClient.restartRecovery())}><RotateCcw size={15} />Prepare recovery and restart</button></section>
      <section className="agentic-super-app-diagnostic-card"><div className="agentic-super-app-card-heading"><Activity size={17} /><h2>Durable state</h2></div><div className="agentic-super-app-status-list">{snapshot.recent_jobs.length ? snapshot.recent_jobs.map((job) => <div key={job.id}><span className={`agentic-super-app-state ${job.state}`}>{job.state}</span><code>{job.kind}</code></div>) : <p>No persisted jobs yet.</p>}</div><div className="agentic-super-app-status-list">{snapshot.notifications.length ? snapshot.notifications.slice(0, 3).map((item) => <div key={item.id}><span className="agentic-super-app-state completed">{item.severity}</span><span>{item.title}</span></div>) : <p>No notifications yet.</p>}</div></section>
    </div>
    {message && <div className="agentic-super-app-feedback" role="status">{message}</div>}
  </section>
}
