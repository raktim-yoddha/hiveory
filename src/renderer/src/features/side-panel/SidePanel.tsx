import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { FolderTree, Globe, History, Maximize2, Minimize2, PanelRight, Plus, X } from 'lucide-react'
import { AgentIcon } from '../../components/brand/AgentIcon'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { Menu } from '../../components/ui/Menu'
import { ResizeHandle } from '../../components/ui/ResizeHandle'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useBrowser } from '../../stores/browser'
import {
  PANEL_SPLIT,
  panelGroupKey,
  selectedProjectId,
  selectedWorkspaceId,
  tabGroup,
  useNavigation,
  type PanelGroup,
  type PanelTab
} from '../../stores/navigation'
import { BrowserPane } from '../browser/BrowserPane'
import { Explorer } from '../explorer/Explorer'
import { SessionsPanel } from '../sessions/SessionsPanel'
import { openBrowserTab } from './panel-actions'
import styles from './SidePanel.module.css'
import { pageTitle } from '../browser/page-title'

const EMPTY: PanelTab[] = []
const TAB_ICON = { explorer: FolderTree, browser: Globe, sessions: History }
const TAB_TYPE = 'application/x-hiveory-panel-tab'

/**
 * Right side panel for the workspace in view (never a project page): browser tabs (any number), the folder's
 * Explorer and the agent session history, added from "+". Tabs drag to reorder;
 * dragging one into the lower half splits the panel into a top and a bottom area,
 * each with its own tabs (a divider sets their heights). Browser pages live in
 * main; pages agents open in this workspace appear here as tabs on their own.
 */
export function SidePanel() {
  const view = useNavigation((s) => s.view)
  const workspaceId = selectedWorkspaceId(view)
  const projectId = selectedProjectId(view)
  // Workspaces only — a project page has no side panel.
  const scope = workspaceId ?? ''
  const tabs = useNavigation((s) => s.panelTabs[scope] ?? EMPTY)
  const { addPanelTab, closePanelTab, movePanelTab, panelMaximized, togglePanelMaximized, panelSplit, setPanelSplit } = useNavigation()
  const pages = useBrowser((s) => s.pages)
  const bodyRef = useRef<HTMLDivElement>(null)
  /** The tab being dragged, and where the panel shows it would land. */
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropArea, setDropArea] = useState<PanelGroup | null>(null)
  const [height, setHeight] = useState(0)
  const split = tabs.some((t) => tabGroup(t) === 'bottom')
  const groups: PanelGroup[] = split ? ['top', 'bottom'] : ['top']

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setHeight(entry.contentRect.height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [scope])

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

  const tabTitle = (tab: PanelTab): string => {
    if (tab.kind !== 'browser') return tab.title
    const page = pages.find((p) => p.id === tab.id)
    if (!page) return tab.title
    const title = pageTitle(page)
    return page.ownerName ? `${page.ownerName} · ${title}` : title
  }

  const addMenu = (group: PanelGroup) => (
    <Menu
      label="Add to side panel"
      items={[
        { type: 'item', id: 'browser', label: 'Browser', icon: <Globe />, disabled: !scope, onSelect: () => void openBrowserTab(scope, group) },
        {
          type: 'item',
          id: 'explorer',
          label: 'Explorer',
          icon: <FolderTree />,
          disabled: !scope,
          hint: tabs.some((t) => t.kind === 'explorer') ? 'Open' : undefined,
          onSelect: () => addPanelTab(scope, 'explorer', undefined, true, group)
        },
        {
          type: 'item',
          id: 'sessions',
          label: 'Sessions',
          icon: <History />,
          disabled: !scope,
          hint: tabs.some((t) => t.kind === 'sessions') ? 'Open' : 'Agent history',
          onSelect: () => addPanelTab(scope, 'sessions', undefined, true, group)
        }
      ]}
      trigger={(props) => <IconButton {...props} label="Add browser, explorer or sessions" icon={<Plus />} className={styles.add} />}
    />
  )

  /** Dragging over the panel's lower half offers the bottom area (and the upper half the top one). */
  const onBodyDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!dragging) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const box = bodyRef.current!.getBoundingClientRect()
    const below = split ? e.clientY > box.top + box.height * panelSplit : e.clientY > box.top + box.height / 2
    setDropArea(below ? 'bottom' : 'top')
  }
  const onBodyDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const id = e.dataTransfer.getData(TAB_TYPE) || dragging
    if (id && dropArea) movePanelTab(scope, id, dropArea)
    endDrag()
  }
  const endDrag = (): void => {
    setDragging(null)
    setDropArea(null)
  }

  if (!scope) {
    return (
      <aside className={styles.panel} aria-label="Side panel">
        <div className={styles.area}>
          <EmptyState compact icon={<PanelRight />} title="No workspace open" description="Open a workspace to browse, explore its files and see its agent sessions here." />
        </div>
      </aside>
    )
  }

  return (
    <aside className={styles.panel} aria-label="Side panel">
      <div ref={bodyRef} className={styles.areas} style={split ? { gridTemplateRows: `${panelSplit}fr ${1 - panelSplit}fr` } : undefined}>
        {groups.map((group) => (
          <PanelArea
            key={group}
            scope={scope}
            group={group}
            tabs={tabs.filter((t) => tabGroup(t) === group)}
            title={tabTitle}
            isAgentPage={(id) => Boolean(pages.find((p) => p.id === id)?.ownerName)}
            onClose={closeTab}
            dragging={dragging}
            onDragStart={setDragging}
            onDragEnd={endDrag}
            addMenu={addMenu(group)}
            workspaceId={workspaceId}
            projectId={projectId}
            actions={
              group === 'top' ? (
                <IconButton
                  label={panelMaximized ? 'Restore side panel' : 'Maximize side panel'}
                  icon={panelMaximized ? <Minimize2 /> : <Maximize2 />}
                  active={panelMaximized}
                  onClick={togglePanelMaximized}
                />
              ) : null
            }
          />
        ))}
        {split && (
          <ResizeHandle
            label="Resize the side panel's top and bottom areas"
            orientation="horizontal"
            className={styles.splitHandle}
            style={{ '--split': panelSplit } as CSSProperties}
            value={Math.round(height * panelSplit)}
            min={Math.round(height * PANEL_SPLIT.min)}
            max={Math.round(height * PANEL_SPLIT.max)}
            direction={1}
            initial={Math.round(height * PANEL_SPLIT.initial)}
            onChange={(px) => setPanelSplit(px / Math.max(1, height))}
          />
        )}
        {dragging && (
          // While a tab is dragged the browser page steps aside, so this layer can show where it lands.
          <div className={styles.dropLayer} data-steps-aside onDragOver={onBodyDragOver} onDragLeave={() => setDropArea(null)} onDrop={onBodyDrop}>
            {dropArea && (
              <div
                className={cx(styles.dropPreview, dropArea === 'bottom' && styles.dropBottom)}
                style={{ '--split': split ? panelSplit : 0.5 } as CSSProperties}
              >
                <span>{dropArea === 'bottom' ? 'Show below' : 'Show above'}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

interface PanelAreaProps {
  scope: string
  group: PanelGroup
  tabs: PanelTab[]
  title(tab: PanelTab): string
  isAgentPage(id: string): boolean
  onClose(tab: PanelTab): void
  dragging: string | null
  onDragStart(id: string): void
  onDragEnd(): void
  addMenu: ReactNode
  actions: ReactNode
  workspaceId?: string
  projectId?: string
}

/** One area of the side panel: its tab strip (drag to reorder) and its pages, each kept mounted. */
function PanelArea({ scope, group, tabs, title, isAgentPage, onClose, dragging, onDragStart, onDragEnd, addMenu, actions, workspaceId, projectId }: PanelAreaProps) {
  const activeId = useNavigation((s) => s.activePanelTab[panelGroupKey(scope, group)])
  const all = useNavigation((s) => s.panelTabs[scope] ?? EMPTY)
  const { selectPanelTab, movePanelTab } = useNavigation()
  const [before, setBefore] = useState<string | null>(null)
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  /** Ctrl+Shift+← → reorder, Ctrl+Shift+↓ ↑ move between the areas. */
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, tab: PanelTab): void => {
    if (!e.ctrlKey || !e.shiftKey) return
    const index = tabs.indexOf(tab)
    if (e.key === 'ArrowLeft' && index > 0) movePanelTab(scope, tab.id, group, tabs[index - 1]!.id)
    else if (e.key === 'ArrowRight' && index < tabs.length - 1) movePanelTab(scope, tab.id, group, tabs[index + 2]?.id ?? nextOutside(all, tabs.at(-1)!))
    else if (e.key === 'ArrowDown' && group === 'top') movePanelTab(scope, tab.id, 'bottom')
    else if (e.key === 'ArrowUp' && group === 'bottom') movePanelTab(scope, tab.id, 'top')
    else return
    e.preventDefault()
  }

  const onTabDragOver = (e: DragEvent<HTMLDivElement>, tab: PanelTab): void => {
    if (!dragging) return
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > box.left + box.width / 2
    const index = tabs.indexOf(tab)
    setBefore(after ? (tabs[index + 1]?.id ?? '') : tab.id)
  }
  const onStripDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const id = e.dataTransfer.getData(TAB_TYPE) || dragging
    // '' = after the last tab of this area.
    if (id) movePanelTab(scope, id, group, before || nextOutside(all, tabs.at(-1)))
    setBefore(null)
    onDragEnd()
  }

  return (
    <section className={styles.area} aria-label={group === 'top' ? 'Side panel' : 'Side panel, bottom'}>
      <header className={styles.header}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label={group === 'top' ? 'Side panel tabs' : 'Bottom side panel tabs'}
          onDragOver={(e) => {
            if (!dragging) return
            e.preventDefault()
            if (e.target === e.currentTarget) setBefore('')
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setBefore(null)
          }}
          onDrop={onStripDrop}
        >
          {tabs.map((tab) => {
            const Icon = tab.kind === 'browser' && isAgentPage(tab.id) ? AgentIcon : TAB_ICON[tab.kind]
            const selected = tab.id === active?.id
            const name = title(tab)
            return (
              <div
                key={tab.id}
                className={cx(styles.tab, selected && styles.active, dragging === tab.id && styles.lifted, before === tab.id && styles.insertBefore)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TAB_TYPE, tab.id)
                  e.dataTransfer.effectAllowed = 'move'
                  onDragStart(tab.id)
                }}
                onDragEnd={() => {
                  setBefore(null)
                  onDragEnd()
                }}
                onDragOver={(e) => onTabDragOver(e, tab)}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={styles.tabButton}
                  title={`${name}\nDrag to reorder, or into the lower half to show it below (Ctrl+Shift+arrows)`}
                  onClick={() => selectPanelTab(scope, tab.id)}
                  onAuxClick={(e) => e.button === 1 && onClose(tab)}
                  onKeyDown={(e) => onTabKey(e, tab)}
                >
                  <Icon aria-hidden />
                  <span className={styles.tabTitle}>{name}</span>
                </button>
                <button type="button" className={styles.tabClose} aria-label={`Close ${name}`} onClick={() => onClose(tab)}>
                  <X aria-hidden />
                </button>
              </div>
            )
          })}
          {before === '' && dragging && <span className={styles.insertEnd} aria-hidden />}
          {addMenu}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      <div className={styles.body}>
        {tabs.length === 0 ? (
          <EmptyState compact icon={<Plus />} title="Nothing open" description="Add a browser, the Explorer for this folder's files, or the agent session history." actions={addMenu} />
        ) : (
          // Every tab stays mounted so pages and the Explorer keep their state; only the active one is visible.
          tabs.map((tab) => (
            <div key={tab.id} className={styles.page} hidden={tab.id !== active?.id}>
              <ErrorBoundary region={tab.title} compact>
                {tab.kind === 'explorer' ? (
                  <Explorer key={scope} workspaceId={scope} />
                ) : tab.kind === 'browser' ? (
                  <BrowserPane pageId={tab.id} visible={tab.id === active?.id} />
                ) : (
                  <SessionsPanel key={scope} projectId={projectId} workspaceId={workspaceId} />
                )}
              </ErrorBoundary>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/** The id of the first tab after `last` in the whole list (so a move lands right after it), or null for the end. */
const nextOutside = (all: PanelTab[], last: PanelTab | undefined): string | null => {
  if (!last) return null
  return all[all.indexOf(last) + 1]?.id ?? null
}
