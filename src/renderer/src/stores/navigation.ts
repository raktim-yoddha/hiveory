import { create } from 'zustand'

export type AppMode = 'workspace' | 'chatspace'
export type ProjectTab = 'tasks' | 'pull-requests' | 'workspaces' | 'settings'

export type View =
  | { type: 'home' }
  | { type: 'project'; projectId: string; tab: ProjectTab }
  | { type: 'workspace'; projectId: string; workspaceId: string; focusPaneId?: string }

interface NavigationState {
  mode: AppMode
  view: View
  sidebarCollapsed: boolean
  setMode(mode: AppMode): void
  openProject(projectId: string, tab?: ProjectTab): void
  openWorkspace(projectId: string, workspaceId: string, focusPaneId?: string): void
  goHome(): void
  toggleSidebar(): void
}

/** Ephemeral UI navigation state. Never persisted to the main process. */
export const useNavigation = create<NavigationState>((set) => ({
  mode: 'workspace',
  view: { type: 'home' },
  sidebarCollapsed: false,
  setMode: (mode) => set({ mode }),
  openProject: (projectId, tab = 'tasks') => set({ mode: 'workspace', view: { type: 'project', projectId, tab } }),
  openWorkspace: (projectId, workspaceId, focusPaneId) =>
    set({ mode: 'workspace', view: { type: 'workspace', projectId, workspaceId, focusPaneId } }),
  goHome: () => set({ view: { type: 'home' } }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
}))

export const selectedProjectId = (view: View): string | undefined => (view.type === 'home' ? undefined : view.projectId)
