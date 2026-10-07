import { create } from 'zustand'
import type {
  AgentPreset,
  AppSettings,
  UpdateStatus,
  CliDescriptor,
  CliInstanceView,
  CliRuntimeDetails,
  LayoutNode,
  LayoutOperation,
  Project,
  VsCodeTheme,
  VsCodeThemeExtension,
  WorkspaceView
} from '@shared/domain'
import { DEFAULT_SETTINGS } from '@shared/domain'
import type { AppInfo } from '@shared/ipc/contract'
import { api } from '../lib/api'
import { reportError } from './notices'

/**
 * Renderer caches of main-process state. Main is the source of truth; these
 * stores only load, hold and invalidate. Load failures surface as notices.
 */

const load = async <T>(operation: string, fetch: () => Promise<T>, apply: (value: T) => void): Promise<void> => {
  try {
    apply(await fetch())
  } catch (error) {
    reportError(error, operation)
  }
}

interface AppState {
  info: AppInfo | null
  load(): Promise<void>
}

export const useApp = create<AppState>((set) => ({
  info: null,
  load: () => load('Load app info', () => api('app.info'), (info) => set({ info }))
}))

interface ProjectState {
  projects: Project[]
  loaded: boolean
  load(): Promise<void>
}

export const useProjects = create<ProjectState>((set) => ({
  projects: [],
  loaded: false,
  load: () => load('Load workspaces', () => api('projects.list'), (projects) => set({ projects, loaded: true }))
}))

interface WorkspaceState {
  byProject: Record<string, WorkspaceView[]>
  load(projectId: string): Promise<void>
}

export const useWorkspaces = create<WorkspaceState>((set) => ({
  byProject: {},
  load: (projectId) =>
    load(
      'Load worktrees',
      () => api('workspaces.list', { projectId }),
      (list) => set((s) => ({ byProject: { ...s.byProject, [projectId]: list } }))
    )
}))

interface CliState {
  clis: CliDescriptor[]
  loaded: boolean
  load(refresh?: boolean): Promise<void>
  /** CLIs on each remote project's machine (ADR 0022), by project id. */
  remote: Record<string, CliDescriptor[]>
  loadRemote(projectId: string, refresh?: boolean): Promise<void>
}

export const useClis = create<CliState>((set) => ({
  clis: [],
  loaded: false,
  load: (refresh = false) =>
    load('Detect CLIs', () => api('clis.list', { refresh }), (clis) => set({ clis, loaded: true })),
  remote: {},
  loadRemote: (projectId, refresh = false) =>
    load('Detect CLIs on the remote host', () => api('clis.list', { refresh, projectId }), (clis) => set((s) => ({ remote: { ...s.remote, [projectId]: clis } })))
}))

/**
 * The CLIs on a project's machine: this computer's for local projects, the SSH host's for
 * remote ones (loaded on first use). Agent menus use this so they offer what can run there.
 */
export const useHostClis = (projectId?: string): { clis: CliDescriptor[]; loaded: boolean; load: (refresh?: boolean) => Promise<void> } => {
  const remote = useProjects((s) => Boolean(projectId && s.projects.find((p) => p.id === projectId)?.host))
  const local = useClis((s) => s.clis)
  const localLoaded = useClis((s) => s.loaded)
  const loadLocal = useClis((s) => s.load)
  const remoteList = useClis((s) => (projectId ? s.remote[projectId] : undefined))
  const loadRemote = useClis((s) => s.loadRemote)
  if (!remote || !projectId) return { clis: local, loaded: localLoaded, load: loadLocal }
  return { clis: remoteList ?? [], loaded: Boolean(remoteList), load: (refresh) => loadRemote(projectId, refresh) }
}

interface AgentState {
  byWorkspace: Record<string, CliInstanceView[]>
  /** Live runtime details pushed from main; overrides what the last list returned. */
  runtime: Record<string, CliRuntimeDetails>
  /** When each agent's status last changed (ms epoch), from live events; unknown until the first change. */
  since: Record<string, number>
  load(workspaceId: string): Promise<void>
  setRuntime(instanceId: string, details: CliRuntimeDetails): void
}

export const useAgents = create<AgentState>((set) => ({
  byWorkspace: {},
  runtime: {},
  since: {},
  load: (workspaceId) =>
    load(
      'Load agents',
      () => api('agents.list', { workspaceId }),
      (list) =>
        set((s) => ({
          byWorkspace: { ...s.byWorkspace, [workspaceId]: list },
          runtime: { ...s.runtime, ...Object.fromEntries(list.map((a) => [a.id, a.runtime])) }
        }))
    ),
  setRuntime: (instanceId, details) =>
    set((s) => ({
      runtime: { ...s.runtime, [instanceId]: details },
      since: s.runtime[instanceId]?.status === details.status ? s.since : { ...s.since, [instanceId]: Date.now() }
    }))
}))

interface LayoutState {
  byWorkspace: Record<string, LayoutNode | null>
  load(workspaceId: string): Promise<void>
  apply(workspaceId: string, operation: LayoutOperation): Promise<void>
}

export const useLayouts = create<LayoutState>((set) => ({
  byWorkspace: {},
  load: (workspaceId) =>
    load(
      'Load layout',
      () => api('layout.get', { workspaceId }),
      (tree) => set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: tree } }))
    ),
  apply: (workspaceId, operation) =>
    load(
      'Rearrange panes',
      () => api('layout.apply', { workspaceId, operation }),
      (tree) => set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: tree } }))
    )
}))

interface PresetState {
  presets: AgentPreset[]
  loaded: boolean
  load(): Promise<void>
}

export const usePresets = create<PresetState>((set) => ({
  presets: [],
  loaded: false,
  load: () => load('Load presets', () => api('presets.list'), (presets) => set({ presets, loaded: true }))
}))

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<AppSettings>): Promise<void>
}

export const useSettings = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: () => load('Load settings', () => api('settings.get'), (settings) => set({ settings, loaded: true })),
  update: async (patch) => {
    // Optimistic: themes switch instantly; main confirms (or the reload corrects it).
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    await load('Save settings', () => api('settings.update', patch), (settings) => set({ settings }))
  }
}))

interface ThemesState {
  /** Installed VS Code theme extensions (ADR 0034). */
  installed: VsCodeThemeExtension[]
  load(): Promise<void>
  set(installed: VsCodeThemeExtension[]): void
}

export const useThemes = create<ThemesState>((set) => ({
  installed: [],
  load: () => load('Load themes', () => api('themes.installed'), (installed) => set({ installed })),
  set: (installed) => set({ installed })
}))

/** The installed VS Code theme with this id, or null ('' = the built-in theme). */
export const findTheme = (installed: VsCodeThemeExtension[], id: string): VsCodeTheme | null =>
  id ? (installed.find((e) => id.startsWith(`${e.id}/`))?.themes.find((t) => t.id === id) ?? null) : null

interface UpdatesState {
  status: UpdateStatus
  load(): Promise<void>
  set(status: UpdateStatus): void
}

export const useUpdates = create<UpdatesState>((set) => ({
  status: { state: 'idle' },
  load: () => load('Load update status', () => api('updates.status'), (status) => set({ status })),
  set: (status) => set({ status })
}))
