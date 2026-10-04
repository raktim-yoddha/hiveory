import { useEffect, useState } from 'react'
import { Bot, Globe, Maximize2, Minimize2, Plus, RotateCcw, SquareTerminal, X } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { Menu } from '../../components/ui/Menu'
import { PathTrail } from '../../components/ui/PathTrail'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useBrowser } from '../../stores/browser'
import { useSettings } from '../../stores/data'
import { selectedProjectId, selectedWorkspaceId, useNavigation, type PanelTab } from '../../stores/navigation'
import { reportError, runAction } from '../../stores/notices'
import { BrowserPane } from '../browser/BrowserPane'
import { TerminalView } from '../terminal/TerminalView'
import styles from './SidePanel.module.css'

const EMPTY: PanelTab[] = []
const TAB_ICON = { terminal: SquareTerminal, browser: Globe }

/**
 * Right side panel: any number of terminal and browser tabs for the folder in
 * view, added from "+". Starts empty. Can be maximized over the main area.
 * Browser pages live in main; pages agents open in this workspace appear here
 * as tabs on their own.
 */
export function SidePanel() {
  const view = useNavigation((s) => s.view)
  const workspaceId = selectedWorkspaceId(view)
  const projectId = selectedProjectId(view)
  const scope = workspaceId ?? projectId ?? ''
  const tabs = useNavigation((s) => s.panelTabs[scope] ?? EMPTY)
  const activeId = useNavigation((s) => s.activePanelTab[scope])
  const { addPanelTab, closePanelTab, selectPanelTab, togglePanel, panelMaximized, togglePanelMaximized } = useNavigation()
  const pages = useBrowser((s) => s.pages)
  const homeUrl = useSettings((s) => s.settings.browserHomeUrl)
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  // Browser tabs mirror main's pages for this folder: agent-opened pages appear, closed ones go.
  useEffect(() => {
    if (!scope) return
    const here = pages.filter((p) => p.scope === scope)
    for (const page of here) addPanelTab(scope, 'browser', page.id, false)
    for (const tab of tabs) if (tab.kind === 'browser' && !here.some((p) => p.id === tab.id)) closePanelTab(scope, tab.id)
  }, [pages, scope, tabs, addPanelTab, closePanelTab])

  const closeTab = (tab: PanelTab): void => {
    closePanelTab(scope, tab.id)
    if (tab.kind === 'terminal') void api('shell.close', { id: shellId(scope, tab.id) }).catch(() => undefined)
    else void api('browser.close', { pageId: tab.id }).catch(() => undefined)
  }

  const openBrowser = async (): Promise<void> => {
    const page = await runAction('Open browser', () => api('browser.open', { scope, url: homeUrl || undefined }))
    if (page) addPanelTab(scope, 'browser', page.id)
  }

  const tabTitle = (tab: PanelTab): string => {
    if (tab.kind !== 'browser') return tab.title
    const page = pages.find((p) => p.id === tab.id)
    if (!page) return tab.title
    let title = page.title
    if (!title || title === page.url) {
      try {
        title = page.url && page.url !== 'about:blank' ? new URL(page.url).host : 'New tab'
      } catch {
        title = 'New tab'
      }
    }
    return page.ownerName ? `${page.ownerName} · ${title}` : title
  }

  const addMenu = (
    <Menu
      label="Add to side panel"
      items={[
        { type: 'item', id: 'terminal', label: 'Terminal', icon: <SquareTerminal />, disabled: !scope, onSelect: () => addPanelTab(scope, 'terminal') },
        { type: 'item', id: 'browser', label: 'Browser', icon: <Globe />, disabled: !scope, onSelect: () => void openBrowser() }
      ]}
      trigger={(props) => <IconButton {...props} label="Add terminal or browser" icon={<Plus />} className={styles.add} />}
    />
  )

  return (
    <aside className={styles.panel} aria-label="Side panel">
      <header className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label="Side panel tabs">
          {tabs.map((tab) => {
            const agentPage = tab.kind === 'browser' && Boolean(pages.find((p) => p.id === tab.id)?.ownerName)
            const Icon = agentPage ? Bot : TAB_ICON[tab.kind]
            const selected = tab.id === active?.id
            const title = tabTitle(tab)
            return (
              <div key={tab.id} className={cx(styles.tab, selected && styles.active)}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={styles.tabButton}
                  onClick={() => selectPanelTab(scope, tab.id)}
                  onAuxClick={(e) => e.button === 1 && closeTab(tab)}
                >
                  <Icon aria-hidden />
                  <span className={styles.tabTitle} title={title}>
                    {title}
                  </span>
                </button>
                <button type="button" className={styles.tabClose} aria-label={`Close ${title}`} onClick={() => closeTab(tab)}>
                  <X aria-hidden />
                </button>
              </div>
            )
          })}
          {addMenu}
        </div>
        <div className={styles.actions}>
          <IconButton
            label={panelMaximized ? 'Restore side panel' : 'Maximize side panel'}
            icon={panelMaximized ? <Minimize2 /> : <Maximize2 />}
            active={panelMaximized}
            onClick={togglePanelMaximized}
          />
          <IconButton label="Close side panel" icon={<X />} onClick={togglePanel} />
        </div>
      </header>
      <div className={styles.body}>
        {!scope ? (
          <EmptyState compact icon={<SquareTerminal />} title="No folder selected" description="Open a project or workspace to use terminals here." />
        ) : tabs.length === 0 ? (
          <EmptyState
            compact
            icon={<Plus />}
            title="Nothing open"
            description="Add a terminal for this folder, or a browser."
            actions={addMenu}
          />
        ) : (
          // Every tab stays mounted so terminals keep their state; only the active one is visible.
          tabs.map((tab) => (
            <div key={tab.id} className={styles.page} hidden={tab.id !== active?.id}>
              <ErrorBoundary region={tab.title} compact>
                {tab.kind === 'terminal' ? (
                  <ShellTab scope={scope} tabId={tab.id} workspaceId={workspaceId} projectId={projectId} />
                ) : (
                  <BrowserPane pageId={tab.id} visible={tab.id === active?.id} />
                )}
              </ErrorBoundary>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

/** Mirrors the id main gives a tab's shell (`shell-<scope>-<tab>`). */
const shellId = (scope: string, tabId: string): string => `shell-${scope}-${tabId}`

interface ShellTabProps {
  scope: string
  tabId: string
  workspaceId?: string
  projectId?: string
}

function ShellTab({ scope, tabId, workspaceId, projectId }: ShellTabProps) {
  const [shell, setShell] = useState<{ id: string; cwd: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    api('shell.open', workspaceId ? { workspaceId, tab: tabId } : { projectId, tab: tabId })
      .then((result) => !cancelled && setShell(result))
      .catch((error) => !cancelled && reportError(error, 'Open terminal'))
    return () => {
      cancelled = true
    }
  }, [scope, tabId, workspaceId, projectId])

  return (
    <div className={styles.shell}>
      <div className={styles.shellBar}>
        {shell && <PathTrail path={shell.cwd} reveal={workspaceId ? { workspaceId } : { projectId }} />}
        {shell && (
          <IconButton
            label="Restart terminal"
            icon={<RotateCcw />}
            onClick={() => void api('shell.restart', { id: shell.id }).catch((e) => reportError(e, 'Restart terminal'))}
          />
        )}
      </div>
      <div className={styles.terminal}>{shell && <TerminalView key={shell.id} instanceId={shell.id} />}</div>
    </div>
  )
}
