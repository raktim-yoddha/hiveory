import { create } from 'zustand'

export type AppMode = 'workspace' | 'chatspace'
export type ProjectTab = 'tasks' | 'pull-requests' | 'workspaces' | 'settings'

export type SettingsSection = 'appearance' | 'agents' | 'extensions' | 'updates' | 'guide' | 'about'

export type View =
  | { type: 'home' }
  | { type: 'settings'; section: SettingsSection; returnTo: Exclude<View, { type: 'settings' }> }
  | { type: 'project'; projectId: string; tab: ProjectTab }
  | { type: 'workspace'; projectId: string; workspaceId: string; focusPaneId?: string }

interface NavigationState {
  mode: AppMode
  view: View
  sidebarCollapsed: boolean
  rightPanel: RightPanel | null
  setMode(mode: AppMode): void
  openSettings(section?: SettingsSection): void
  closeSettings(): void
  toggleRightPanel(panel?: RightPanel): void
  openProject(projectId: string, tab?: ProjectTab): void
  openWorkspace(projectId: string, workspaceId: string, focusPaneId?: string): void
  goHome(): void
  toggleSidebar(): void
}

/** Ephemeral UI navigation state. Never persisted to the main process. */
export type RightPanel = 'terminal' | 'browser'

export const useNavigation = create<NavigationState>((set) => ({
  mode: 'workspace',
  view: { type: 'home' },
  sidebarCollapsed: false,
  rightPanel: null,
  setMode: (mode) => set((s) => ({ mode, view: s.view.type === 'settings' ? s.view.returnTo : s.view })),
  openSettings: (section = 'appearance') =>
    set((s) => ({ view: { type: 'settings', section, returnTo: s.view.type === 'settings' ? s.view.returnTo : s.view } })),
  closeSettings: () => set((s) => (s.view.type === 'settings' ? { view: s.view.returnTo } : {})),
  toggleRightPanel: (panel = 'terminal') => set((s) => ({ rightPanel: s.rightPanel === panel ? null : panel })),
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
