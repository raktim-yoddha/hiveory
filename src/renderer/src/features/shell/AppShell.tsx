import { lazy, Suspense, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { ResizeHandle } from '../../components/ui/ResizeHandle'
import { Toasts } from '../../components/ui/Toasts'
import { SshPromptDialog } from './SshPromptDialog'
import { cx } from '../../lib/cx'
import { useBots } from '../../stores/bots'
import { useSettings } from '../../stores/data'
import { PANEL_WIDTH, SIDEBAR_WIDTH, useNavigation } from '../../stores/navigation'
import { QueenDock, QueenFloating } from '../queen/Queen'
import { useQueen } from '../queen/useQueen'
import { ProjectSidebar } from '../projects/ProjectSidebar'
import { AddProjectDialog } from '../projects/AddProjectDialog'
import { RoutineEditor } from '../routines/RoutineEditor'
import { useAppShortcuts } from './useAppShortcuts'
import { WelcomeDialog } from './WelcomeDialog'
import { UpdatePrompt } from '../updates/UpdatePrompt'
import { SidePanel } from '../side-panel/SidePanel'
import { WorkspaceScreen } from '../workspace/WorkspaceScreen'
import { HomeScreen } from './HomeScreen'
import { TitleBar } from './TitleBar'
import styles from './AppShell.module.css'

/*
 * Loaded when first needed (ADR 0044): Settings, Bots and Chat are most of the app's code, and a window
 * that starts in Work never parses them until they are opened.
 */
const SettingsScreen = lazy(() => import('../settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))
const BotsScreen = lazy(() => import('../bots/BotsScreen').then((m) => ({ default: m.BotsScreen })))
const BotsSidebar = lazy(() => import('../bots/BotsSidebar').then((m) => ({ default: m.BotsSidebar })))
const BotPanel = lazy(() => import('../bots/BotPanel').then((m) => ({ default: m.BotPanel })))
const ChatScreen = lazy(() => import('../chat/ChatScreen').then((m) => ({ default: m.ChatScreen })))
const ChatSidebar = lazy(() => import('../chat/ChatSidebar').then((m) => ({ default: m.ChatSidebar })))

/**
 * Top-level layout. Work, Bots and Chat stay mounted once opened — switching modes only
 * hides the others — so none ever "sleeps"; Bots and Chat mount on their first visit (ADR 0044).
 * Each region has its own error boundary.
 * Both sidebars are resizable; a maximized side panel overlays the main area
 * (which keeps its size, so agent terminals never reflow).
 */
export function AppShell() {
  const {
    mode,
    view,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebar,
    panelOpen,
    panelWidth,
    setPanelWidth,
    togglePanel,
    panelMaximized,
    workMinWidth
  } = useNavigation()
  useAppShortcuts()
  const hasWallpaper = useSettings((s) => Boolean(s.settings.wallpaper))
  const queenPlacement = useQueen((s) => s.placement)
  const inSettings = view.type === 'settings'
  // Settings is a window over the app (ADR 0039): everything behind it stays laid out, so changes show live.
  const showSidebar = !sidebarCollapsed
  // The right column: a worktree's side panel (never on Home or Settings), or the open bot's panel.
  const botPanelOpen = useBots((s) => s.panelOpen && s.activeBotId !== null && s.page === 'bot')
  const setBotPanelOpen = useBots((s) => s.setPanelOpen)
  const workView = view.type === 'settings' ? view.returnTo : view
  // Modes visited so far: each mounts the first time it is shown and then stays.
  const [visited, setVisited] = useState(() => new Set([mode]))
  if (!visited.has(mode)) setVisited(new Set([...visited, mode]))
  const showBotPanel = botPanelOpen && mode === 'bots'
  const showPanel = showBotPanel || (panelOpen && mode === 'workspace' && workView.type === 'workspace')
  const maximized = panelMaximized && !showBotPanel
  const viewKey = workView.type === 'home' ? 'home' : `w:${workView.workspaceId}`
  // The open Worktree's panes keep their minimum width: the sidebars give way (see .main).
  const workMin = mode === 'workspace' && workView.type === 'workspace' ? workMinWidth : 0
  const widths = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--sidebar-min': `${SIDEBAR_WIDTH.min}px`,
    '--side-panel-width': `${panelWidth}px`,
    '--side-panel-min': `${PANEL_WIDTH.min}px`,
    '--work-min-width': `${workMin}px`
  } as CSSProperties
  // Rendered widths: a sidebar's handle starts from what is shown (the grid may have narrowed it)
  // and stops where the panes would go below their minimum.
  const sidebarRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState({ sidebar: 0, content: 0, panel: 0 })
  useLayoutEffect(() => {
    const measure = (): void =>
      setShown({
        sidebar: sidebarRef.current?.offsetWidth ?? 0,
        content: contentRef.current?.offsetWidth ?? 0,
        panel: panelRef.current?.offsetWidth ?? 0
      })
    measure()
    const observer = new ResizeObserver(measure)
    for (const el of [sidebarRef.current, contentRef.current, panelRef.current]) if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [showSidebar, showPanel])
  const slack = Math.max(0, shown.content - workMin)
  const sidebarMax = Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, shown.sidebar + slack))
  const panelMax = Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, shown.panel + slack))

  return (
    <div className={styles.app}>
      {hasWallpaper && <div className={styles.wallpaper} aria-hidden />}
      <ErrorBoundary region="Title bar" compact>
        <TitleBar />
      </ErrorBoundary>
      <div className={cx(styles.main, showSidebar && styles.withSidebar, showPanel && styles.withPanel, showPanel && maximized && styles.covered)} style={widths}>
        {showSidebar && (
          <aside ref={sidebarRef} className={styles.sidebar}>
            <ErrorBoundary region="Sidebar" compact>
              <Suspense fallback={null}>{mode === 'chatspace' ? <ChatSidebar /> : mode === 'bots' ? <BotsSidebar /> : <ProjectSidebar />}</Suspense>
            </ErrorBoundary>
            <ResizeHandle
              label="Resize sidebar"
              className={styles.sidebarHandle}
              value={shown.sidebar || sidebarWidth}
              min={SIDEBAR_WIDTH.min}
              max={sidebarMax}
              initial={SIDEBAR_WIDTH.initial}
              direction={1}
              onChange={(width) => setSidebarWidth(Math.min(width, sidebarMax))}
              onCollapse={toggleSidebar}
            />
          </aside>
        )}
        <main ref={contentRef} className={styles.content}>
          <div className={styles.stage}>
          <div className={styles.mode} hidden={mode !== 'workspace'}>
            <div key={viewKey} className={styles.view}>
              <ErrorBoundary region="This screen" resetKey={viewKey}>
              {workView.type === 'workspace' ? (
                <WorkspaceScreen
                  key={workView.workspaceId}
                  projectId={workView.projectId}
                  workspaceId={workView.workspaceId}
                  focusPaneId={workView.focusPaneId}
                />
              ) : (
                <HomeScreen />
              )}
              </ErrorBoundary>
            </div>
          </div>
          {visited.has('bots') && (
            <div className={styles.mode} hidden={mode !== 'bots'}>
              <ErrorBoundary region="Bots">
                <Suspense fallback={null}>
                  <BotsScreen />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
          {visited.has('chatspace') && (
            <div className={styles.mode} hidden={mode !== 'chatspace'}>
              <ErrorBoundary region="Chat">
                <Suspense fallback={null}>
                  <ChatScreen />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
          </div>
          <ErrorBoundary region="Queen Bee" compact>
            {queenPlacement === 'docked' ? <QueenDock /> : queenPlacement === 'floating' ? <QueenFloating /> : null}
          </ErrorBoundary>
        </main>
        {showPanel && (
          <div ref={panelRef} className={cx(styles.panel, maximized && styles.panelMaximized)}>
            {!maximized && (
              <ResizeHandle
                label="Resize side panel"
                className={styles.panelHandle}
                value={shown.panel || panelWidth}
                min={PANEL_WIDTH.min}
                max={panelMax}
                initial={PANEL_WIDTH.initial}
                direction={-1}
                onChange={(width) => setPanelWidth(Math.min(width, panelMax))}
                onCollapse={showBotPanel ? () => setBotPanelOpen(false) : togglePanel}
              />
            )}
            <ErrorBoundary key={showBotPanel ? 'bot' : 'side'} region={showBotPanel ? 'Bot panel' : 'Side panel'} compact>
              {showBotPanel ? (
                <Suspense fallback={null}>
                  <BotPanel />
                </Suspense>
              ) : (
                <SidePanel />
              )}
            </ErrorBoundary>
          </div>
        )}
      </div>
      {inSettings && (
        <ErrorBoundary region="Settings">
          <Suspense fallback={null}>
            <SettingsScreen section={view.section} />
          </Suspense>
        </ErrorBoundary>
      )}
      <AddProjectDialog />
      {/* Opened from Bots, Chat and Work (ADR 0040). */}
      <RoutineEditor />
      <SshPromptDialog />
      <UpdatePrompt />
      {/* First run: Tiles or Tabs (ADR 0042). */}
      <WelcomeDialog />
      <Toasts />
    </div>
  )
}
