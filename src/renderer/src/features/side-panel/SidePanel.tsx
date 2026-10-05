import { useEffect } from 'react'
import { FolderTree, Globe, Maximize2, Minimize2, PanelRight, Plus, X } from 'lucide-react'
import { AgentIcon } from '../../components/brand/AgentIcon'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { Menu } from '../../components/ui/Menu'

import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useBrowser } from '../../stores/browser'
import { selectedProjectId, selectedWorkspaceId, useNavigation, type PanelTab } from '../../stores/navigation'
import { BrowserPane } from '../browser/BrowserPane'
import { Explorer } from '../explorer/Explorer'
import { openBrowserTab } from './panel-actions'
import styles from './SidePanel.module.css'

const EMPTY: PanelTab[] = []
const TAB_ICON = { explorer: FolderTree, browser: Globe }

/**
 * Right side panel for the folder in view: browser tabs (any number) and the
 * folder's Explorer (one), added from "+". Starts empty. Can be maximized over
 * the main area. Browser pages live in main; pages agents open in this
 * workspace appear here as tabs on their own. Terminals open as panes.
 */
export function SidePanel() {
  const view = useNavigation((s) => s.view)
  const workspaceId = selectedWorkspaceId(view)
  const projectId = selectedProjectId(view)
  const scope = workspaceId ?? projectId ?? ''
  const tabs = useNavigation((s) => s.panelTabs[scope] ?? EMPTY)
  const activeId = useNavigation((s) => s.activePanelTab[scope])
  const { addPanelTab, closePanelTab, selectPanelTab, panelMaximized, togglePanelMaximized } = useNavigation()
  const pages = useBrowser((s) => s.pages)
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
    if (tab.kind === 'browser') void api('browser.close', { pageId: tab.id }).catch(() => undefined)
  }

  const openBrowser = (): Promise<boolean> => openBrowserTab(scope)

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
        { type: 'item', id: 'browser', label: 'Browser', icon: <Globe />, disabled: !scope, onSelect: () => void openBrowser() },
        {
          type: 'item',
          id: 'explorer',
          label: 'Explorer',
          icon: <FolderTree />,
          disabled: !scope,
          hint: tabs.some((t) => t.kind === 'explorer') ? 'Open' : undefined,
          onSelect: () => addPanelTab(scope, 'explorer')
        }
      ]}
      trigger={(props) => <IconButton {...props} label="Add browser or explorer" icon={<Plus />} className={styles.add} />}
    />
  )

  return (
    <aside className={styles.panel} aria-label="Side panel">
      <header className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label="Side panel tabs">
          {tabs.map((tab) => {
            const agentPage = tab.kind === 'browser' && Boolean(pages.find((p) => p.id === tab.id)?.ownerName)
            const Icon = agentPage ? AgentIcon : TAB_ICON[tab.kind]
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
        </div>
      </header>
      <div className={styles.body}>
        {!scope ? (
          <EmptyState compact icon={<PanelRight />} title="No folder selected" description="Open a project or workspace to browse and explore its files here." />
        ) : tabs.length === 0 ? (
          <EmptyState
            compact
            icon={<Plus />}
            title="Nothing open"
            description="Add a browser, or the Explorer for this folder's files."
            actions={addMenu}
          />
        ) : (
          // Every tab stays mounted so pages and the Explorer keep their state; only the active one is visible.
          tabs.map((tab) => (
            <div key={tab.id} className={styles.page} hidden={tab.id !== active?.id}>
              <ErrorBoundary region={tab.title} compact>
                {tab.kind === 'explorer' ? (
                  <Explorer key={scope} workspaceId={workspaceId} projectId={workspaceId ? undefined : projectId} />
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
