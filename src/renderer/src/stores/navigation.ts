import { create } from 'zustand'

export type AppMode = 'workspace' | 'chatspace'
export type ProjectTab = 'tasks' | 'pull-requests' | 'workspaces' | 'settings'

export type SettingsSection = 'appearance' | 'agents' | 'browser' | 'extensions' | 'queen' | 'updates' | 'guide' | 'about'

export type View =
  | { type: 'home' }
  | { type: 'settings'; section: SettingsSection; returnTo: Exclude<View, { type: 'settings' }> }
  | { type: 'project'; projectId: string; tab: ProjectTab }
  | { type: 'workspace'; projectId: string; workspaceId: string; focusPaneId?: string }

/**
 * One tab of the right side panel: a browser page (main-owned, its id e.g. `b3`) or the
 * folder's Explorer — at most one Explorer per folder (id `explorer`). Terminals open as panes.
 */
export interface PanelTab {
  id: string
  kind: 'browser' | 'explorer'
  title: string
}

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
  /** Side-panel tabs per folder scope (workspace id, or project id on project pages). */
  panelTabs: Record<string, PanelTab[]>
  activePanelTab: Record<string, string>
  setMode(mode: AppMode): void
  openSettings(section?: SettingsSection): void
  closeSettings(): void
  togglePanel(): void
  togglePanelMaximized(): void
  setSidebarWidth(width: number): void
  setPanelWidth(width: number): void
  /** Adds (or, for an existing id, selects) a tab. Browser tabs pass their page id. */
  addPanelTab(scope: string, kind: PanelTab['kind'], id?: string, select?: boolean): PanelTab
  closePanelTab(scope: string, tabId: string): void
  selectPanelTab(scope: string, tabId: string): void
  openProject(projectId: string, tab?: ProjectTab): void
  openWorkspace(projectId: string, workspaceId: string, focusPaneId?: string): void
  goHome(): void
  toggleSidebar(): void
}

const WIDTHS_KEY = 'hiveory.sidebarWidths'

const clamp = (value: number, range: { min: number; max: number }): number =>
  Math.round(Math.min(range.max, Math.max(range.min, value)))

/** Sidebar widths are a per-viewer convenience; storage may be unavailable, so defaults always work. */
const readWidths = (): { sidebar: number; panel: number } => {
  try {
    const raw = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}') as { sidebar?: unknown; panel?: unknown }
    return {
      sidebar: typeof raw.sidebar === 'number' ? clamp(raw.sidebar, SIDEBAR_WIDTH) : SIDEBAR_WIDTH.initial,
      panel: typeof raw.panel === 'number' ? clamp(raw.panel, PANEL_WIDTH) : PANEL_WIDTH.initial
    }
  } catch {
    return { sidebar: SIDEBAR_WIDTH.initial, panel: PANEL_WIDTH.initial }
  }
}

const saveWidths = (sidebar: number, panel: number): void => {
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify({ sidebar, panel }))
  } catch {
    // Widths still apply for this session.
  }
}

const initialWidths = readWidths()
let tabCounter = 0

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
  setMode: (mode) => set((s) => ({ mode, view: s.view.type === 'settings' ? s.view.returnTo : s.view })),
  openSettings: (section = 'appearance') =>
    set((s) => ({ view: { type: 'settings', section, returnTo: s.view.type === 'settings' ? s.view.returnTo : s.view } })),
  closeSettings: () => set((s) => (s.view.type === 'settings' ? { view: s.view.returnTo } : {})),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen, panelMaximized: s.panelOpen ? false : s.panelMaximized })),
  togglePanelMaximized: () => set((s) => ({ panelMaximized: !s.panelMaximized })),
  setSidebarWidth: (width) => {
    const sidebarWidth = clamp(width, SIDEBAR_WIDTH)
    set({ sidebarWidth })
    saveWidths(sidebarWidth, get().panelWidth)
  },
  setPanelWidth: (width) => {
    const panelWidth = clamp(width, PANEL_WIDTH)
    set({ panelWidth })
    saveWidths(get().sidebarWidth, panelWidth)
  },
  addPanelTab: (scope, kind, id, select = true) => {
    const tabs = get().panelTabs[scope] ?? []
    // Only one Explorer per folder: asking again selects it.
    const tabId = kind === 'explorer' ? 'explorer' : id
    const existing = tabId ? tabs.find((t) => t.id === tabId) : undefined
    if (existing) {
      if (select) set((s) => ({ activePanelTab: { ...s.activePanelTab, [scope]: existing.id } }))
      return existing
    }
    const n = tabs.filter((t) => t.kind === kind).length + 1
    const label = kind === 'explorer' ? 'Explorer' : 'Browser'
    const tab: PanelTab = { id: tabId ?? `t${++tabCounter}`, kind, title: n > 1 ? `${label} ${n}` : label }
    set((s) => ({
      panelTabs: { ...s.panelTabs, [scope]: [...tabs, tab] },
      activePanelTab: select || !s.activePanelTab[scope] ? { ...s.activePanelTab, [scope]: tab.id } : s.activePanelTab
    }))
    return tab
  },
  closePanelTab: (scope, tabId) =>
    set((s) => {
      const tabs = s.panelTabs[scope] ?? []
      const index = tabs.findIndex((t) => t.id === tabId)
      const rest = tabs.filter((t) => t.id !== tabId)
      const active = s.activePanelTab[scope] === tabId ? rest[Math.min(index, rest.length - 1)]?.id : s.activePanelTab[scope]
      const activePanelTab = { ...s.activePanelTab }
      if (active) activePanelTab[scope] = active
      else delete activePanelTab[scope]
      return { panelTabs: { ...s.panelTabs, [scope]: rest }, activePanelTab }
    }),
  selectPanelTab: (scope, tabId) => set((s) => ({ activePanelTab: { ...s.activePanelTab, [scope]: tabId } })),
  openProject: (projectId, tab = 'tasks') => set({ mode: 'workspace', view: { type: 'project', projectId, tab } }),
  openWorkspace: (projectId, workspaceId, focusPaneId) =>
    set({ mode: 'workspace', view: { type: 'workspace', projectId, workspaceId, focusPaneId } }),
  goHome: () => set({ view: { type: 'home' } }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
}))

export const selectedProjectId = (view: View): string | undefined =>
  view.type === 'settings' ? selectedProjectId(view.returnTo) : view.type === 'home' ? undefined : view.projectId

/** The Workspace in view, if any (also behind the settings page). */
export const selectedWorkspaceId = (view: View): string | undefined =>
  view.type === 'settings' ? selectedWorkspaceId(view.returnTo) : view.type === 'workspace' ? view.workspaceId : undefined
