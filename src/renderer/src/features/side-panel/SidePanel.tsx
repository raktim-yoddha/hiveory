import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { CalendarClock, FolderTree, History, LayoutDashboard, Maximize2, Minimize2, PanelRight, Plus, Settings2, X } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { Menu } from '../../components/ui/Menu'
import { ResizeHandle } from '../../components/ui/ResizeHandle'
import { cx } from '../../lib/cx'
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
import { Explorer } from '../explorer/Explorer'
import { SessionsPanel } from '../sessions/SessionsPanel'
import { ProjectPanel } from '../project/ProjectPanel'
import { ProjectScreen } from '../project/ProjectScreen'
import styles from './SidePanel.module.css'

const EMPTY: PanelTab[] = []
const TAB_ICON = { explorer: FolderTree, sessions: History, workspace: LayoutDashboard, routines: CalendarClock, settings: Settings2 }
const TAB_TYPE = 'application/x-hiveory-panel-tab'

/**
 * Right side panel for the Worktree in view: the Dashboard (ADR 0038, 0039), the agent session history,
 * the folder's Explorer, and the Workspace's Routines and Settings (ADR 0042), added from "+". Browser
 * pages are panes among the agents (ADR 0042). Tabs drag to reorder; dragging one into the lower half
 * splits the panel into a top and a bottom area, each with its own tabs (a divider sets their heights).
 */
export function SidePanel() {
  const view = useNavigation((s) => s.view)
  const workspaceId = selectedWorkspaceId(view)
  const projectId = selectedProjectId(view)
  // Workspaces only — a project page has no side panel.
  const scope = workspaceId ?? ''
  const tabs = useNavigation((s) => s.panelTabs[scope] ?? EMPTY)
  const { addPanelTab, closePanelTab, movePanelTab, panelMaximized, togglePanelMaximized, panelSplit, setPanelSplit, ensurePanelTabs } = useNavigation()
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

  // A worktree's panel starts with Dashboard, Sessions and Explorer (ADR 0042).
  useEffect(() => {
    if (projectId) ensurePanelTabs(scope)
  }, [scope, projectId, ensurePanelTabs])

  const closeTab = (tab: PanelTab): void => closePanelTab(scope, tab.id)

  // Explorer, Dashboard, Sessions, Routines and Settings open once per worktree: an open one leaves the menu (ADR 0039, 0042).
  const isOpen = (kind: PanelTab['kind']): boolean => tabs.some((t) => t.kind === kind)
  const addMenu = (group: PanelGroup) => (
    <Menu
      label="Add to side panel"
      items={[
        ...(
          [
            ['explorer', 'Explorer', <FolderTree key="e" />],
            ['workspace', 'Dashboard', <LayoutDashboard key="d" />],
            ['sessions', 'Sessions', <History key="s" />],
            ['routines', 'Routines', <CalendarClock key="r" />],
            ['settings', 'Workspace settings', <Settings2 key="w" />]
          ] as const
        )
          .filter(([kind]) => !isOpen(kind))
          .map(([kind, label, icon]) => ({ type: 'item' as const, id: kind, label, icon, disabled: !scope, onSelect: () => void addPanelTab(scope, kind, undefined, true, group) }))
      ]}
      trigger={(props) => <IconButton {...props} label="Add to the side panel" icon={<Plus />} className={styles.add} />}
    />
  )

  /** A tab dropped on an area's pages moves to that area (see PanelArea's drop zone). */
  const dropInArea = (id: string, area: PanelGroup): void => {
    movePanelTab(scope, id, area)
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
          <EmptyState compact icon={<PanelRight />} title="No worktree open" description="Open a worktree to see its Dashboard, explore its files and see its agent sessions here." />
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
            onClose={closeTab}
            dragging={dragging}
            onDragStart={setDragging}
            onDragEnd={endDrag}
            split={split}
            dropArea={dropArea}
            onDropAreaChange={setDropArea}
            onDropInArea={dropInArea}
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
        {dragging && dropArea && (
          // Shows where a dragged tab lands; the drop zones that take it are in each area's pages.
          <div className={styles.dropLayer} aria-hidden>
            <div className={cx(styles.dropPreview, dropArea === 'bottom' && styles.dropBottom)} style={{ '--split': split ? panelSplit : 0.5 } as CSSProperties}>
              <span>{dropArea === 'bottom' ? 'Show below' : 'Show above'}</span>
            </div>
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
  onClose(tab: PanelTab): void
  dragging: string | null
  onDragStart(id: string): void
  onDragEnd(): void
  /** Whether the panel has a bottom area yet (unsplit, the lower half of the pages offers one). */
  split: boolean
  dropArea: PanelGroup | null
  onDropAreaChange(area: PanelGroup | null): void
  onDropInArea(id: string, area: PanelGroup): void
  addMenu: ReactNode
  actions: ReactNode
  workspaceId?: string
  projectId?: string
}

/** One area of the side panel: its tab strip (drag to reorder) and its pages, each kept mounted. */
function PanelArea({
  scope,
  group,
  tabs,
  onClose,
  dragging,
  onDragStart,
  onDragEnd,
  split,
  dropArea,
  onDropAreaChange,
  onDropInArea,
  addMenu,
  actions,
  workspaceId,
  projectId
}: PanelAreaProps) {
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

  /** Over this area's pages: this area, or (unsplit) the lower half offers a new bottom area. */
  const areaAt = (e: DragEvent<HTMLDivElement>): PanelGroup => {
    if (split) return group
    const box = e.currentTarget.getBoundingClientRect()
    return e.clientY > box.top + box.height / 2 ? 'bottom' : 'top'
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
            const Icon = TAB_ICON[tab.kind]
            const selected = tab.id === active?.id
            const name = tab.title
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
        {dragging && (
          // Covers only this area's pages (never a tab strip: a new element under the dragged tab would
          // cancel the drag); browser panes step aside while it is there.
          <div
            className={styles.dropZone}
            data-steps-aside
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const area = areaAt(e)
              if (area !== dropArea) onDropAreaChange(area)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDropAreaChange(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData(TAB_TYPE) || dragging
              if (id) onDropInArea(id, areaAt(e))
              else onDragEnd()
            }}
          />
        )}
        {tabs.length === 0 ? (
          <EmptyState
            compact
            icon={<Plus />}
            title="Nothing open"
            description="Add the Dashboard, the agent session history, the Explorer for this folder's files, Routines or the Workspace's settings."
            actions={addMenu}
          />
        ) : (
          // Every tab stays mounted so pages and the Explorer keep their state; only the active one is visible.
          tabs.map((tab) => (
            <div key={tab.id} className={styles.page} hidden={tab.id !== active?.id}>
              <ErrorBoundary region={tab.title} compact>
                {tab.kind === 'explorer' ? (
                  <Explorer key={scope} workspaceId={scope} />
                ) : tab.kind === 'workspace' ? (
                  projectId && <ProjectScreen key={scope} projectId={projectId} workspaceId={scope} />
                ) : tab.kind === 'routines' || tab.kind === 'settings' ? (
                  projectId && <ProjectPanel key={scope} kind={tab.kind} projectId={projectId} workspaceId={scope} />
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
