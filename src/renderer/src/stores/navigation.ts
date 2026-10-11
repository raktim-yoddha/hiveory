import { create } from 'zustand'
import { mainWorkspaceId } from '@shared/domain'
import { useWorkspaces } from './data'

export type AppMode = 'workspace' | 'bots' | 'chatspace'
/** The Dashboard's sections (ADR 0042: Routines and Settings are side-panel tabs of their own). */
export type ProjectTab = 'tasks' | 'workspaces' | 'issues'
/** Where `openProject` lands: a Dashboard section, or the Routines or Settings tab. */
export type ProjectPlace = ProjectTab | 'routines' | 'settings'

export type SettingsSection = 'appearance' | 'agents' | 'browser' | 'extensions' | 'integrations' | 'queen' | 'remote' | 'updates' | 'guide' | 'about'

export type View =
  | { type: 'home' }
  | { type: 'settings'; section: SettingsSection; returnTo: Exclude<View, { type: 'settings' }> }
  | { type: 'workspace'; projectId: string; workspaceId: string; focusPaneId?: string }

/**
 * One tab of the right side panel, at most one of each kind per worktree (its id is its kind).
 * Terminals, agents, files and browser pages open as panes (ADR 0042).
 */
export interface PanelTab {
  id: string
  kind: 'explorer' | 'sessions' | 'workspace' | 'routines' | 'settings'
  title: string
  /** The side panel splits into a top and a bottom area; tabs sit in the top one unless moved down. */
  group?: PanelGroup
}

export type PanelGroup = 'top' | 'bottom'

/** Key of an area's selected tab in `activePanelTab`: the scope itself for the top area. */
export const panelGroupKey = (scope: string, group: PanelGroup = 'top'): string => (group === 'top' ? scope : `${scope}#bottom`)
export const tabGroup = (tab: PanelTab): PanelGroup => tab.group ?? 'top'

/** Clamp ranges for the resizable sidebars (px). */
export const SIDEBAR_WIDTH = { min: 200, max: 440, initial: 248 }
export const PANEL_WIDTH = { min: 300, max: 900, initial: 420 }

interface NavigationState {
  mode: AppMode
  view: View
  sidebarCollapsed: boolean
  sidebarWidth: number
  panelOpen: boolean
  panelWidth: number
  /** The side panel covers the main area, up to the left sidebar. */
  panelMaximized: boolean
  /** Side-panel tabs per workspace id (the side panel exists only in workspaces). */
  panelTabs: Record<string, PanelTab[]>
  /** Selected tab per area: `panelGroupKey(scope, group)` → tab id. */
  activePanelTab: Record<string, string>
  /** Height share of the top area while the panel is split (0.2–0.8). */
  panelSplit: number
  /** Smallest width the open Worktree's panes fit in (each at its minimum); the sidebars give way first. */
  workMinWidth: number
  /** The Worktree last opened in each Workspace: a folded Workspace opens it when clicked (ADR 0038). */
  lastWorktree: Record<string, string>
  /** The section the side panel's Workspace tab shows (board, pull requests, worktrees, settings). */
  workspaceTab: ProjectTab
  setWorkspaceTab(tab: ProjectTab): void
  setMode(mode: AppMode): void
  openSettings(section?: SettingsSection): void
  closeSettings(): void
  togglePanel(): void
  togglePanelMaximized(): void
  setSidebarWidth(width: number): void
  setPanelWidth(width: number): void
  setWorkMinWidth(width: number): void
  /** Adds (or, for an existing id, selects) a tab. Browser tabs pass their page id. */
  addPanelTab(scope: string, kind: PanelTab['kind'], id?: string, select?: boolean, group?: PanelGroup): PanelTab
  closePanelTab(scope: string, tabId: string): void
  selectPanelTab(scope: string, tabId: string): void
  /** Moves a tab within or between the top and bottom areas, before `beforeId` (or to the end). */
  movePanelTab(scope: string, tabId: string, group: PanelGroup, beforeId?: string | null): void
  setPanelSplit(share: number): void
  /** A Workspace's page lives in the side panel (ADR 0038): opens its last Worktree with that tab on `tab`. */
  openProject(projectId: string, place?: ProjectPlace): void
  /** A worktree's side panel always has Dashboard, Sessions, Explorer, Routines and Settings (ADR 0042). */
  ensurePanelTabs(scope: string): void
  openWorkspace(projectId: string, workspaceId: string, focusPaneId?: string): void
  goHome(): void
  toggleSidebar(): void
}

const WIDTHS_KEY = 'hiveory.sidebarWidths'

const clamp = (value: number, range: { min: number; max: number }): number =>
  Math.round(Math.min(range.max, Math.max(range.min, value)))

/** Sidebar widths are a per-viewer convenience; storage may be unavailable, so defaults always work. */
export const PANEL_SPLIT = { min: 0.2, max: 0.8, initial: 0.5 }

const readWidths = (): { sidebar: number; panel: number; split: number } => {
  try {
    const raw = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}') as { sidebar?: unknown; panel?: unknown; split?: unknown }
    return {
      sidebar: typeof raw.sidebar === 'number' ? clamp(raw.sidebar, SIDEBAR_WIDTH) : SIDEBAR_WIDTH.initial,
      panel: typeof raw.panel === 'number' ? clamp(raw.panel, PANEL_WIDTH) : PANEL_WIDTH.initial,
      split: typeof raw.split === 'number' ? Math.min(PANEL_SPLIT.max, Math.max(PANEL_SPLIT.min, raw.split)) : PANEL_SPLIT.initial
    }
  } catch {
    return { sidebar: SIDEBAR_WIDTH.initial, panel: PANEL_WIDTH.initial, split: PANEL_SPLIT.initial }
  }
}

const saveWidths = (s: { sidebarWidth: number; panelWidth: number; panelSplit: number }): void => {
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify({ sidebar: s.sidebarWidth, panel: s.panelWidth, split: s.panelSplit }))
  } catch {
    // Widths still apply for this session.
  }
}

/** After tabs move or close, every area keeps a valid selection (its first tab when the old one left). */
const fixActive = (scope: string, tabs: PanelTab[], active: Record<string, string>, prefer?: Partial<Record<PanelGroup, string>>): Record<string, string> => {
  const next = { ...active }
  for (const group of ['top', 'bottom'] as const) {
    const key = panelGroupKey(scope, group)
    const here = tabs.filter((t) => tabGroup(t) === group)
    const wanted = prefer?.[group] ?? next[key]
    const pick = here.find((t) => t.id === wanted) ?? here[0]
    if (pick) next[key] = pick.id
    else delete next[key]
  }
  return next
}

const initialWidths = readWidths()

/** Ephemeral UI navigation state. Never persisted to the main process. */
export const useNavigation = create<NavigationState>((set, get) => ({
  mode: 'workspace',
  view: { type: 'home' },
  sidebarCollapsed: false,
  sidebarWidth: initialWidths.sidebar,
  panelOpen: false,
  panelWidth: initialWidths.panel,
  panelMaximized: false,
  panelTabs: {},
  activePanelTab: {},
  panelSplit: initialWidths.split,
  workMinWidth: 0,
  lastWorktree: {},
  workspaceTab: 'tasks',
  setWorkspaceTab: (workspaceTab) => set({ workspaceTab }),
  setMode: (mode) => set((s) => ({ mode, view: s.view.type === 'settings' ? s.view.returnTo : s.view })),
  openSettings: (section = 'appearance') =>
    set((s) => ({ view: { type: 'settings', section, returnTo: s.view.type === 'settings' ? s.view.returnTo : s.view } })),
  closeSettings: () => set((s) => (s.view.type === 'settings' ? { view: s.view.returnTo } : {})),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen, panelMaximized: s.panelOpen ? false : s.panelMaximized })),
  togglePanelMaximized: () => set((s) => ({ panelMaximized: !s.panelMaximized })),
  setSidebarWidth: (width) => {
    const sidebarWidth = clamp(width, SIDEBAR_WIDTH)
    set({ sidebarWidth })
    saveWidths(get())
  },
  setPanelWidth: (width) => {
    const panelWidth = clamp(width, PANEL_WIDTH)
    set({ panelWidth })
    saveWidths(get())
  },
  setWorkMinWidth: (width) => {
    if (width !== get().workMinWidth) set({ workMinWidth: width })
  },
  setPanelSplit: (share) => {
    set({ panelSplit: Math.min(PANEL_SPLIT.max, Math.max(PANEL_SPLIT.min, share)) })
    saveWidths(get())
  },
  addPanelTab: (scope, kind, id, select = true, group = 'top') => {
    const tabs = get().panelTabs[scope] ?? []
    // One of each per folder: asking again selects it.
    const tabId = id ?? kind
    const existing = tabs.find((t) => t.id === tabId)
    if (existing) {
      if (select) set((s) => ({ activePanelTab: { ...s.activePanelTab, [panelGroupKey(scope, tabGroup(existing))]: existing.id } }))
      return existing
    }
    const n = tabs.filter((t) => t.kind === kind).length + 1
    const label = { explorer: 'Explorer', sessions: 'Sessions', workspace: 'Dashboard', routines: 'Routines', settings: 'Settings' }[kind]
    const tab: PanelTab = { id: tabId, kind, title: n > 1 ? `${label} ${n}` : label, ...(group === 'bottom' ? { group } : {}) }
    const key = panelGroupKey(scope, group)
    set((s) => ({
      panelTabs: { ...s.panelTabs, [scope]: [...tabs, tab] },
      activePanelTab: select || !s.activePanelTab[key] ? { ...s.activePanelTab, [key]: tab.id } : s.activePanelTab
    }))
    return tab
  },
  closePanelTab: (scope, tabId) =>
    set((s) => {
      const tabs = s.panelTabs[scope] ?? []
      const closing = tabs.find((t) => t.id === tabId)
      if (!closing) return {}
      // The neighbour in the same area takes over, as in a browser.
      const same = tabs.filter((t) => tabGroup(t) === tabGroup(closing))
      const index = same.indexOf(closing)
      const rest = tabs.filter((t) => t.id !== tabId)
      const key = panelGroupKey(scope, tabGroup(closing))
      const neighbour = s.activePanelTab[key] === tabId ? (same[index + 1] ?? same[index - 1])?.id : undefined
      return {
        panelTabs: { ...s.panelTabs, [scope]: rest },
        activePanelTab: fixActive(scope, rest, s.activePanelTab, neighbour ? { [tabGroup(closing)]: neighbour } : undefined)
      }
    }),
  selectPanelTab: (scope, tabId) =>
    set((s) => {
      const tab = (s.panelTabs[scope] ?? []).find((t) => t.id === tabId)
      return tab ? { activePanelTab: { ...s.activePanelTab, [panelGroupKey(scope, tabGroup(tab))]: tabId } } : {}
    }),
  movePanelTab: (scope, tabId, group, beforeId) =>
    set((s) => {
      const tabs = s.panelTabs[scope] ?? []
      const moving = tabs.find((t) => t.id === tabId)
      if (!moving || beforeId === tabId) return {}
      const { group: _old, ...plain } = moving
      const moved: PanelTab = group === 'bottom' ? { ...plain, group } : plain
      const rest = tabs.filter((t) => t.id !== tabId)
      const at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1
      const next = at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)]
      return { panelTabs: { ...s.panelTabs, [scope]: next }, activePanelTab: fixActive(scope, next, s.activePanelTab, { [group]: tabId }) }
    }),
  openProject: (projectId, place = 'tasks') => {
    const list = useWorkspaces.getState().byProject[projectId] ?? []
    const remembered = get().lastWorktree[projectId]
    const workspaceId = list.find((w) => w.id === remembered)?.id ?? list.find((w) => w.kind === 'main')?.id ?? list[0]?.id ?? remembered ?? mainWorkspaceId(projectId)
    get().openWorkspace(projectId, workspaceId)
    get().ensurePanelTabs(workspaceId)
    if (place === 'routines' || place === 'settings') {
      get().addPanelTab(workspaceId, place)
      set({ panelOpen: true })
    } else {
      get().addPanelTab(workspaceId, 'workspace')
      set({ panelOpen: true, workspaceTab: place })
    }
  },
  ensurePanelTabs: (scope) => {
    if (!scope) return
    const fresh = !get().panelTabs[scope]
    // Every kind, once: a worktree opened before keeps its order and gets what it lacks.
    for (const kind of ['workspace', 'sessions', 'explorer', 'routines', 'settings'] as const) get().addPanelTab(scope, kind, undefined, fresh && kind === 'workspace')
  },
  openWorkspace: (projectId, workspaceId, focusPaneId) =>
    set((s) => ({
      mode: 'workspace',
      view: { type: 'workspace', projectId, workspaceId, focusPaneId },
      lastWorktree: { ...s.lastWorktree, [projectId]: workspaceId }
    })),
  goHome: () => set({ view: { type: 'home' } }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
}))

export const selectedProjectId = (view: View): string | undefined =>
  view.type === 'settings' ? selectedProjectId(view.returnTo) : view.type === 'home' ? undefined : view.projectId

/** The Workspace in view, if any (also behind the settings page). */
export const selectedWorkspaceId = (view: View): string | undefined =>
  view.type === 'settings' ? selectedWorkspaceId(view.returnTo) : view.type === 'workspace' ? view.workspaceId : undefined
